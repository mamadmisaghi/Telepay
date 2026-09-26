import { splitCreatorFees, RECIPIENT_BPS, PROJECT_BPS } from "../lib/domain/fees";
export type Token = { id: string; name: string; symbol: string; recipient: string; image: number; marketCap: number | null; fees: number; collected: number; platformFees: number; claimed: number; age: string; hours: number; lastTradeSeconds: number | null; live?: boolean; imageUrl?: string; mint?: string; signature?: string; description?: string; confirmedAt?: string; earnedLamports?: string; collectedLamports?: string };
export type Profile = { id: string; name: string; handle: string; image: number; bio: string; verified: boolean };
export const profiles: Profile[] = [
  { id:"greyroom", name:"Grey Room", handle:"greyroom", image:0, bio:"Independent ideas. Shared with the internet.", verified:true },
  { id:"doghouse", name:"The Doghouse", handle:"doghouse", image:1, bio:"Good dogs. Great company. A corner of Telegram.", verified:true },
  { id:"nightshift", name:"Night Shift", handle:"nightshift", image:2, bio:"For everyone still online after midnight.", verified:true },
  { id:"orbitroom", name:"Orbit", handle:"orbitroom", image:3, bio:"Looking a little further out.", verified:false },
  { id:"ghostclub", name:"Ghost Club", handle:"ghostclub", image:4, bio:"Quietly building something interesting.", verified:false },
  { id:"frenhouse", name:"Fren House", handle:"frenhouse", image:5, bio:"A place for frens and internet culture.", verified:true }
];
const sampleReceipts = [
  {id:"grey-matter",name:"Grey Matter",symbol:"GREY",recipient:"greyroom",image:0,marketCap:1420000,fees:24.86,claimed:18.4,age:"6h",hours:6},
  {id:"telegram-dog",name:"Telegram Dog",symbol:"TDOG",recipient:"doghouse",image:1,marketCap:986000,fees:18.72,claimed:12.6,age:"2d",hours:48},
  {id:"night-cat",name:"Night Cat",symbol:"NCAT",recipient:"nightshift",image:2,marketCap:642000,fees:14.24,claimed:9.1,age:"18h",hours:18},
  {id:"orbit",name:"Orbit",symbol:"ORBIT",recipient:"orbitroom",image:3,marketCap:428000,fees:10.18,claimed:0,age:"3h",hours:3},
  {id:"ghost-protocol",name:"Ghost Protocol",symbol:"GHOST",recipient:"ghostclub",image:4,marketCap:317000,fees:8.46,claimed:0,age:"8h",hours:8},
  {id:"fren",name:"Fren",symbol:"FREN",recipient:"frenhouse",image:5,marketCap:284000,fees:6.92,claimed:4.2,age:"1d",hours:24},
  {id:"good-morning",name:"Good Morning",symbol:"GM",recipient:"greyroom",image:6,marketCap:192000,fees:5.38,claimed:3.1,age:"12h",hours:12},
  {id:"crystal",name:"Crystal",symbol:"CRYSTAL",recipient:"orbitroom",image:7,marketCap:164000,fees:4.67,claimed:0,age:"42m",hours:.7},
  {id:"goose",name:"The Goose",symbol:"GOOSE",recipient:"doghouse",image:8,marketCap:126000,fees:3.44,claimed:1.5,age:"5h",hours:5},
  {id:"bot-father",name:"Bot Father",symbol:"BOT",recipient:"greyroom",image:9,marketCap:98400,fees:2.86,claimed:1.2,age:"2h",hours:2},
  {id:"orange-cat",name:"Orange Cat",symbol:"OCAT",recipient:"nightshift",image:10,marketCap:76400,fees:2.19,claimed:1.1,age:"29m",hours:.48},
  {id:"lone-wolf",name:"Lone Wolf",symbol:"WOLF",recipient:"nightshift",image:11,marketCap:52800,fees:1.76,claimed:0,age:"16m",hours:.26}
];
export const RECIPIENT_SHARE = Number(RECIPIENT_BPS) / 10_000;
export const PROJECT_SHARE = Number(PROJECT_BPS) / 10_000;
const precise = (n: number) => Math.round(n * 1_000_000_000) / 1_000_000_000;
export const tokens: Token[] = sampleReceipts.map((t, index) => {
  // These numeric samples are display fixtures; real collection inputs must arrive as bigint.
  const allocation = splitCreatorFees(BigInt(Math.round(t.fees * 1_000_000_000)));
  return { ...t, lastTradeSeconds: [42, 185, 12, 78, 420, 95, 300, 24, 640, 58, 120, null][index], collected: t.fees, fees: Number(allocation.recipientLamports) / 1_000_000_000, platformFees: Number(allocation.projectLamports) / 1_000_000_000 };
});
export const totalCollected = precise(tokens.reduce((sum,t)=>sum+t.collected,0));
export const totalPlatformFees = precise(tokens.reduce((sum,t)=>sum+t.platformFees,0));
export const compactMoney = (n: number) => "$" + (n >= 1000000 ? (n / 1000000).toFixed(1) + "M" : (n / 1000).toFixed(1) + "K");
export const sol = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
export const totalFees = tokens.reduce((s,t)=>s+t.fees,0);
export const totalClaimed = tokens.reduce((s,t)=>s+t.claimed,0);
export const profileTokens = (id: string) => tokens.filter(t=>t.recipient===id);
export const profileFees = (id: string) => profileTokens(id).reduce((s,t)=>s+t.fees,0);
export const profileClaimed = (id: string) => profileTokens(id).reduce((s,t)=>s+t.claimed,0);

export const sortTokens = (items: Token[], sort: string) => [...items].sort((a,b) => (sort === "recent" ? a.hours-b.hours : sort === "trade" ? (a.lastTradeSeconds ?? Infinity)-(b.lastTradeSeconds ?? Infinity) : sort === "market" ? (b.marketCap ?? -1)-(a.marketCap ?? -1) : b.fees-a.fees) || a.id.localeCompare(b.id));

export type PublicToken = {launcher_wallet?:string;id:string;mint:string;name:string;symbol:string;description?:string;image_uri:string;recipient_handle:string;confirmed_at:string;signature:string;earned_lamports:string;collected_lamports:string};
export function fromPublicToken(row:PublicToken,now=Date.now()):Token {
 const hours=Math.max(0,(now-Date.parse(row.confirmed_at))/3600000);
 const earned=BigInt(row.earned_lamports||'0'),collected=BigInt(row.collected_lamports||'0');
 return {id:row.id,name:row.name,symbol:row.symbol,recipient:row.recipient_handle,image:0,imageUrl:row.image_uri,marketCap:null,fees:Number(earned)/1e9,collected:Number(collected)/1e9,platformFees:Number(collected-earned)/1e9,claimed:0,age:hours<1?Math.max(1,Math.floor(hours*60))+'m':hours<24?Math.floor(hours)+'h':Math.floor(hours/24)+'d',hours,lastTradeSeconds:null,live:true,mint:row.mint,signature:row.signature,description:row.description,confirmedAt:row.confirmed_at,earnedLamports:earned.toString(),collectedLamports:collected.toString()};
}
