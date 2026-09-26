// Historical USD is an indicative conversion using the matching SOL/USD 5m candle.
export function usdReference(db,fetcher=fetch){
 let last=0,spot=null,pending;
 async function refresh(){
  if(Date.now()-last<60000)return spot;
  if(pending)return pending;
  pending=(async()=>{
   const r=await fetcher('https://api.kraken.com/0/public/OHLC?pair=SOLUSD&interval=5',{signal:AbortSignal.timeout(8000)});
   if(!r.ok)throw new Error('SOL USD reference unavailable');const data=await r.json();
   const candles=data.result&&Object.entries(data.result).find(([key,value])=>key!=='last'&&Array.isArray(value))?.[1];
   if(data.error?.length||!candles?.length)throw new Error('Invalid USD reference');
   await db.transaction(async tx=>{for(const [time,,,,close] of candles)if(Number.isInteger(time)&&Number.isFinite(Number(close))&&Number(close)>0)await tx.query('INSERT INTO sol_usd_rates(minute,price) VALUES($1,$2) ON CONFLICT(minute) DO UPDATE SET price=EXCLUDED.price',[time,Number(close)]);});
   const current=candles.at(-1);if(Math.abs(Date.now()/1000-Number(current[0]))<600)spot={price:Number(current[4]),at:Date.now()};
   last=Date.now();return spot;
  })().finally(()=>{pending=null});return pending;
 }
 return {refresh,get:()=>spot&&Date.now()-spot.at<180000?spot.price:null};
}
export async function holderCount(chain,mint){
 // Complete, paginated DAS token accounts; count owners, not the top-20 list.
 const owners=new Set();let cursor;
 for(let page=0;page<200;page++){
  const r=await chain.connection._rpcRequest('getTokenAccounts',{mint,limit:1000,...(cursor?{cursor}:{}),options:{showZeroBalance:false}});
  if(r.error||!Array.isArray(r.result?.token_accounts))throw new Error('Holder index unavailable');
  for(const a of r.result.token_accounts){if(Number(a.amount)>0&&a.owner)owners.add(a.owner);}
  const next=r.result.cursor;if(!next||r.result.token_accounts.length<1000)return owners;
  if(next===cursor)throw new Error('Holder cursor did not advance');cursor=next;
 }
 throw new Error('Holder index incomplete');
}
