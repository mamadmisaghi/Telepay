import {completeEventLogs} from './program-events.mjs';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {PUMP_SDK,PUMP_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,bondingCurvePda,canonicalPumpPoolPda} from '@pump-fun/pump-sdk';
import {indexAddress} from './indexer.mjs';
import {usdReference,holderCount} from './market-usd.mjs';
import {need} from './errors.mjs';
const discriminator=name=>createHash('sha256').update(`event:${name}`).digest().subarray(0,8);
const tradeDisc=discriminator('TradeEvent'),buyDisc=discriminator('BuyEvent'),sellDisc=discriminator('SellEvent');
const pump=PUMP_PROGRAM_ID.toBase58(),amm=PUMP_AMM_PROGRAM_ID.toBase58();
const ratio=(sol,tokens)=>Number(sol.toString())/Number(tokens.toString())/1000;

// Attribute logs to their invoking program. A foreign program cannot spoof a Pump trade.
export function parseTrades(tx,mint,signature,decode=PUMP_SDK){
 if(!tx?.meta||tx.meta.err)return [];
 const pool=canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),stack=[],out=[];
 for(const [eventIndex,line] of completeEventLogs(tx).entries()){
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
  const time=Math.floor(t.time/seconds)*seconds,p=t.priceUsd??t.priceSol;
  let c=buckets.get(time);if(!c){c={time,open:p,high:p,low:p,close:p,volumeSol:0,volumeUsd:0,trades:0};buckets.set(time,c);}
  c.high=Math.max(c.high,p);c.low=Math.min(c.low,p);c.close=p;c.volumeSol+=Number(t.solLamports)/1e9;c.volumeUsd+=t.volumeUsd||0;c.trades++;
 }
 return [...buckets.values()];
}
export function marketService({db,chain,config={}}){
 const pending=new Map(),checked=new Map(),fx=usdReference(db);
 async function sync(token){
  await chain.checkNetwork();
  const mint=new PublicKey(token.mint),curve=await chain.sdk.fetchBondingCurve(mint);
  const addresses=[bondingCurvePda(mint),...(curve.complete?[canonicalPumpPoolPda(mint)]:[])];
  let complete=true;
  for(const address of addresses){const progress=await indexAddress({db,connection:chain.connection,launchId:token.id,address,kind:'market',process:async s=>{
   if((await db.query('SELECT 1 FROM market_scans WHERE launch_id=$1 AND signature=$2',[token.id,s.signature])).rowCount)return;
   const tx=s.err?null:await chain.connection.getTransaction(s.signature,{commitment:'finalized',maxSupportedTransactionVersion:1});
   if(!s.err&&!tx)throw new Error('Finalized transaction is not available yet');
   const trades=parseTrades(tx,token.mint,s.signature);
   await db.transaction(async client=>{
    for(const t of trades)await client.query('INSERT INTO market_trades(launch_id,signature,event_index,slot,traded_at,side,wallet,sol_lamports,token_raw,price_sol) VALUES($1,$2,$3,$4,to_timestamp($5),$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',[token.id,t.signature,t.eventIndex,t.slot,t.time,t.side,t.wallet,t.solLamports,t.tokenRaw,t.priceSol]);
    await client.query('INSERT INTO market_scans(launch_id,signature) VALUES($1,$2) ON CONFLICT DO NOTHING',[token.id,s.signature]);
   });
  }});complete=complete&&progress.complete;}
  const quote=curve.virtualQuoteReserves??curve.virtualSolReserves;
  const spot=!curve.complete&&quote?ratio(quote,curve.virtualTokenReserves):null;
  await db.query('INSERT INTO market_state(launch_id,spot_price_sol,graduated,updated_at,backlog) VALUES($1,$2,$3,now(),$4) ON CONFLICT(launch_id) DO UPDATE SET spot_price_sol=EXCLUDED.spot_price_sol,graduated=EXCLUDED.graduated,updated_at=now(),backlog=EXCLUDED.backlog',[token.id,Number.isFinite(spot)?spot:null,!!curve.complete,!complete]);
  if(config.rpcUrl){
   try{await fx.refresh();}catch{}
   const rate=fx.get();await db.query('UPDATE market_state SET sol_usd=$2,sol_usd_at=CASE WHEN $2::double precision IS NULL THEN sol_usd_at ELSE now() END WHERE launch_id=$1',[token.id,rate]);
   const {rows:[state]}=await db.query('SELECT holders_updated_at FROM market_state WHERE launch_id=$1',[token.id]);
   if(!state.holders_updated_at||Date.now()-new Date(state.holders_updated_at).getTime()>300000){try{
    const owners=await holderCount(chain,token.mint);let count=0;for(const owner of owners)if(PublicKey.isOnCurve(new PublicKey(owner).toBytes()))count++;
    await db.query('UPDATE market_state SET holders=$2,holders_updated_at=now() WHERE launch_id=$1',[token.id,count]);
   }catch{}}
   try{const supply=await chain.connection.getTokenSupply(mint,'finalized');await db.query('UPDATE market_state SET supply=$2 WHERE launch_id=$1',[token.id,Number(supply.value.amount)/10**supply.value.decimals]);}catch{}
  }

 }
 async function load(token,interval){
  let stale=false;
  if(!config.production&&(!checked.has(token.id)||Date.now()-checked.get(token.id)>15000)){
   if(!pending.has(token.id)){checked.set(token.id,Date.now());const job=sync(token).finally(()=>pending.delete(token.id));pending.set(token.id,job);}
   try{await pending.get(token.id);}catch{stale=true;}
  }else if(pending.has(token.id)){try{await pending.get(token.id);}catch{stale=true;}}
  const {rows:[state]}=await db.query('SELECT * FROM market_state WHERE launch_id=$1',[token.id]);
  need(state,503,'Market data is temporarily unavailable');
  const {rows}=await db.query("SELECT * FROM market_trades WHERE launch_id=$1 AND traded_at>now()-interval '25 hours' ORDER BY traded_at DESC,slot DESC,event_index DESC",[token.id]);
  const trades=rows.map(r=>({signature:r.signature,eventIndex:r.event_index,slot:Number(r.slot),time:Math.floor(new Date(r.traded_at).getTime()/1000),side:r.side,wallet:r.wallet,solLamports:r.sol_lamports,tokenRaw:r.token_raw,priceSol:Number(r.price_sol)}));
  const {rows:rates}=await db.query('SELECT minute,price FROM sol_usd_rates WHERE minute>=$1',[Math.floor(Date.now()/1000)-90120]);
  const byMinute=new Map(rates.map(r=>[Number(r.minute),Number(r.price)]));
  const converted=trades.map(t=>{const rate=byMinute.get(Math.floor(t.time/300)*300);return {...t,priceUsd:rate?t.priceSol*rate:null,volumeUsd:rate?Number(t.solLamports)/1e9*rate:null};});
  const recent=converted.filter(t=>t.time>=Math.floor(Date.now()/1000)-86400),usdComplete=recent.every(t=>t.priceUsd!==null);
  const solUsd=state.sol_usd&&Date.now()-new Date(state.sol_usd_at).getTime()<180000?Number(state.sol_usd):null;
  const spotSol=state.spot_price_sol===null?trades[0]?.priceSol??null:Number(state.spot_price_sol),spotUsd=solUsd&&spotSol?solUsd*spotSol:null;
  const baseline=(await db.query("SELECT price_sol,traded_at FROM market_trades WHERE launch_id=$1 AND traded_at<=now()-interval '24 hours' ORDER BY traded_at DESC,slot DESC,event_index DESC LIMIT 1",[token.id])).rows[0];
  const baselineRate=baseline?(await db.query('SELECT price FROM sol_usd_rates WHERE minute=$1',[Math.floor(new Date(baseline.traded_at).getTime()/300000)*300])).rows[0]?.price:null;
  const baselineUsd=baselineRate?Number(baselineRate)*Number(baseline.price_sol):null;
  const created=(await db.query('SELECT confirmed_at FROM launches WHERE id=$1',[token.id])).rows[0]?.confirmed_at;
  const fullDay=created&&Date.now()-new Date(created).getTime()>=86400000;
  return {updatedAt:state.updated_at,stale:stale||Date.now()-new Date(state.updated_at).getTime()>90000,indexing:state.backlog,historyScope:'24h',spotPriceSol:spotSol,spotPriceUsd:spotUsd,solUsd,lastTradePriceSol:trades[0]?.priceSol??null,graduated:state.graduated,
   candles:candleSeries(converted.filter(t=>t.priceUsd!==null),interval),trades:converted.slice(0,100),usdHistoryComplete:usdComplete,
   stats:{marketCapUsd:spotUsd&&state.supply?spotUsd*Number(state.supply):null,volume24hUsd:!state.backlog&&usdComplete?recent.reduce((v,t)=>v+t.volumeUsd,0):null,change24h:!state.backlog&&fullDay&&baselineUsd&&spotUsd?(spotUsd/baselineUsd-1)*100:null,holders:state.holders,holdersAt:state.holders_updated_at,holderDefinition:'Unique on-curve owners with positive balances; excludes program vaults'},usdSource:'Kraken SOL-USD 5-minute candle close; indicative conversion'};

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
