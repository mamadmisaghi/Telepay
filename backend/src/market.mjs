import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {PUMP_SDK,PUMP_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,bondingCurvePda,canonicalPumpPoolPda} from '@pump-fun/pump-sdk';
import {need} from './errors.mjs';
const discriminator=name=>createHash('sha256').update(`event:${name}`).digest().subarray(0,8);
const tradeDisc=discriminator('TradeEvent'),buyDisc=discriminator('BuyEvent'),sellDisc=discriminator('SellEvent');
const pump=PUMP_PROGRAM_ID.toBase58(),amm=PUMP_AMM_PROGRAM_ID.toBase58();
const ratio=(sol,tokens)=>Number(sol.toString())/Number(tokens.toString())/1000;

// Attribute logs to their invoking program. A foreign program cannot spoof a Pump trade.
export function parseTrades(tx,mint,signature,decode=PUMP_SDK){
 if(!tx?.meta||tx.meta.err)return [];
 const pool=canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),stack=[],out=[];
 for(const [eventIndex,line] of (tx.meta.logMessages||[]).entries()){
  const invoke=/^Program (\w+) invoke \[(\d+)\]$/.exec(line);
  if(invoke){stack.length=Number(invoke[2])-1;stack.push(invoke[1]);continue;}
  if(/^Program \w+ (?:success|failed:)/.test(line)){stack.pop();continue;}
  if(!line.startsWith('Program data: '))continue;
  const owner=stack.at(-1),bytes=Buffer.from(line.slice(14),'base64'),disc=bytes.subarray(0,8);
  let event,side,sol,tokens;
  if(owner===pump&&disc.equals(tradeDisc)){
   event=decode.decodeTradeEventBc(bytes.subarray(8));
   if(event.mint.toBase58()!==mint)continue;
   side=event.isBuy?'buy':'sell';sol=event.solAmount;tokens=event.tokenAmount;
  }else if(owner===amm&&(disc.equals(buyDisc)||disc.equals(sellDisc))){
   const buy=disc.equals(buyDisc);event=buy?decode.decodeBuyEventAmm(bytes.subarray(8)):decode.decodeSellEventAmm(bytes.subarray(8));
   if(event.pool.toBase58()!==pool)continue;
   side=buy?'buy':'sell';sol=buy?event.quoteAmountIn:event.quoteAmountOut;tokens=buy?event.baseAmountOut:event.baseAmountIn;
  }else continue;
  if(!sol||!tokens||BigInt(tokens.toString())<=0n||BigInt(sol.toString())<=0n)continue;
  const price=ratio(sol,tokens);if(!Number.isFinite(price)||price<=0)continue;
  out.push({signature,eventIndex,slot:tx.slot,time:tx.blockTime??Number(event.timestamp.toString()),side,wallet:event.user.toBase58(),solLamports:sol.toString(),tokenRaw:tokens.toString(),priceSol:price});
 }
 return out;
}
export function candleSeries(trades,seconds=60){
 const buckets=new Map();
 for(const t of [...trades].sort((a,b)=>a.time-b.time||a.slot-b.slot||a.eventIndex-b.eventIndex||a.signature.localeCompare(b.signature))){
  const time=Math.floor(t.time/seconds)*seconds,p=t.priceSol;
  let c=buckets.get(time);if(!c){c={time,open:p,high:p,low:p,close:p,volumeSol:0,trades:0};buckets.set(time,c);}
  c.high=Math.max(c.high,p);c.low=Math.min(c.low,p);c.close=p;c.volumeSol+=Number(t.solLamports)/1e9;c.trades++;
 }
 return [...buckets.values()];
}
export function marketService({db,chain}){
 const pending=new Map(),checked=new Map();
 async function sync(token){
  await chain.checkNetwork();
  const mint=new PublicKey(token.mint),curve=await chain.sdk.fetchBondingCurve(mint);
  const addresses=[bondingCurvePda(mint),...(curve.complete?[canonicalPumpPoolPda(mint)]:[])];
  let signatures=[];
  for(const address of addresses)signatures.push(...await chain.connection.getSignaturesForAddress(address,{limit:60},'finalized'));
  signatures=[...new Map(signatures.map(s=>[s.signature,s])).values()];
  const {rows:seen}=await db.query('SELECT signature FROM market_scans WHERE launch_id=$1 AND signature=ANY($2::text[])',[token.id,signatures.map(s=>s.signature)]);
  const known=new Set(seen.map(s=>s.signature)),todo=signatures.filter(s=>!known.has(s.signature)).slice(0,12);
  // Bound RPC work and isolate market indexing from financial settlement.
  let next=0;await Promise.all(Array.from({length:3},async()=>{while(next<todo.length){
   const s=todo[next++];
   const tx=s.err?null:await chain.connection.getTransaction(s.signature,{commitment:'finalized',maxSupportedTransactionVersion:1});
   if(!s.err&&!tx)throw new Error('Finalized transaction is not available yet');
   const trades=parseTrades(tx,token.mint,s.signature);
   await db.transaction(async client=>{
    for(const t of trades)await client.query('INSERT INTO market_trades(launch_id,signature,event_index,slot,traded_at,side,wallet,sol_lamports,token_raw,price_sol) VALUES($1,$2,$3,$4,to_timestamp($5),$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',[token.id,t.signature,t.eventIndex,t.slot,t.time,t.side,t.wallet,t.solLamports,t.tokenRaw,t.priceSol]);
    await client.query('INSERT INTO market_scans(launch_id,signature) VALUES($1,$2) ON CONFLICT DO NOTHING',[token.id,s.signature]);
   });
  }}));
  const quote=curve.virtualQuoteReserves??curve.virtualSolReserves;
  const spot=!curve.complete&&quote?ratio(quote,curve.virtualTokenReserves):null;
  await db.query('INSERT INTO market_state(launch_id,spot_price_sol,graduated,updated_at,backlog) VALUES($1,$2,$3,now(),$4) ON CONFLICT(launch_id) DO UPDATE SET spot_price_sol=EXCLUDED.spot_price_sol,graduated=EXCLUDED.graduated,updated_at=now(),backlog=EXCLUDED.backlog',[token.id,Number.isFinite(spot)?spot:null,!!curve.complete,signatures.filter(s=>!known.has(s.signature)).length>todo.length]);
 }
 async function load(token,interval){
  let stale=false;
  if(!checked.has(token.id)||Date.now()-checked.get(token.id)>15000){
   if(!pending.has(token.id)){checked.set(token.id,Date.now());const job=sync(token).finally(()=>pending.delete(token.id));pending.set(token.id,job);}
   try{await pending.get(token.id);}catch{stale=true;}
  }else if(pending.has(token.id)){try{await pending.get(token.id);}catch{stale=true;}}
  const {rows:[state]}=await db.query('SELECT * FROM market_state WHERE launch_id=$1',[token.id]);
  need(state,503,'Market data is temporarily unavailable');
  const {rows}=await db.query('SELECT * FROM market_trades WHERE launch_id=$1 ORDER BY traded_at DESC,slot DESC,event_index DESC LIMIT 5000',[token.id]);
  const trades=rows.map(r=>({signature:r.signature,eventIndex:r.event_index,slot:Number(r.slot),time:Math.floor(new Date(r.traded_at).getTime()/1000),side:r.side,wallet:r.wallet,solLamports:r.sol_lamports,tokenRaw:r.token_raw,priceSol:Number(r.price_sol)}));
  return {updatedAt:state.updated_at,stale:stale||Date.now()-new Date(state.updated_at).getTime()>45000,indexing:state.backlog,historyScope:'recent',spotPriceSol:state.spot_price_sol===null?null:Number(state.spot_price_sol),lastTradePriceSol:trades[0]?.priceSol??null,graduated:state.graduated,candles:candleSeries(trades,interval),trades:trades.slice(0,100)};
 }
 return {load,sync};
}
export function marketRoutes(app,dependencies){
 const service=marketService(dependencies);
 app.get('/api/public/token/:id/market',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async req=>{
  const {rows:[token]}=await dependencies.db.query("SELECT id,mint FROM launches WHERE id=$1 AND status='confirmed'",[req.params.id]);need(token,404,'Token not found');
  const interval=Number(req.query.interval||60);need([60,300,3600].includes(interval),400,'Choose a supported chart interval');
  return service.load(token,interval);
 });
}
