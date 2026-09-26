export type Token = {id:string;name:string;symbol:string;recipient:string|null;source:'platform'|'official';imageUrl:string;marketCap:number|null;fees:number;age:string;hours:number;lastTradeSeconds:number|null;mint:string;signature:string;description?:string;confirmedAt:string;earnedLamports:string;collectedLamports:string};

export type PublicToken = {market_cap_usd?:number|null;last_trade_at?:string|null;launcher_wallet?:string;source?:'platform'|'official';id:string;mint:string;name:string;symbol:string;description?:string;image_uri:string;recipient_handle:string|null;confirmed_at:string;signature:string;earned_lamports:string;collected_lamports:string};

export type RecentCollection = {event_id:string;signature:string;recipient_handle:string;gross:string;recipient:string;project:string;received_at:string;launch_id:string;token_name:string;token_image:string};
export type RecentClaim = {id:string;handle:string;amount:string;signature:string;confirmed_at:string};
export type TopToken = {id:string;name:string;symbol:string;image_uri:string;recipient_handle:string;earned_lamports:string};
export type TopRecipient = {handle:string;earned_lamports:string};
export type PublicAnalytics = {collected:string;recipients:string;project:string;claimed:string;unclaimed:string;pending:string;tokens:number;daily:{day:string;collected:string}[];recent:RecentCollection[];recentClaims:RecentClaim[];topTokens:TopToken[];topRecipients:TopRecipient[]};

export function compactMoney(n:number){return '$'+(n>=1_000_000?(n/1_000_000).toFixed(1)+'M':n>=1_000?(n/1_000).toFixed(1)+'K':n.toLocaleString('en-US',{maximumFractionDigits:2}));}
export function fromPublicToken(row:PublicToken,now=Date.now()):Token {
 const hours=Math.max(0,(now-Date.parse(row.confirmed_at))/3600000);
 const earned=BigInt(row.earned_lamports||'0');
 return {id:row.id,name:row.name,symbol:row.symbol,recipient:row.recipient_handle,source:row.source||'platform',imageUrl:row.image_uri,marketCap:row.market_cap_usd??null,fees:Number(earned)/1e9,age:hours<1?Math.max(1,Math.floor(hours*60))+'m':hours<24?Math.floor(hours)+'h':Math.floor(hours/24)+'d',hours,lastTradeSeconds:row.last_trade_at?Math.max(0,(now-Date.parse(row.last_trade_at))/1000):null,mint:row.mint,signature:row.signature,description:row.description,confirmedAt:row.confirmed_at,earnedLamports:earned.toString(),collectedLamports:row.collected_lamports||'0'};
}
export const sortTokens=(items:Token[],sort:string)=>[...items].sort((a,b)=>(sort==='recent'?a.hours-b.hours:sort==='trade'?(a.lastTradeSeconds??Infinity)-(b.lastTradeSeconds??Infinity):sort==='market'?(b.marketCap??-1)-(a.marketCap??-1):b.fees-a.fees)||a.id.localeCompare(b.id));
