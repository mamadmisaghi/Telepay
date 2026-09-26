'use client';
import {useState} from 'react';
import {ArrowRight,Send} from 'lucide-react';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import type {PublicAnalytics,RecentClaim,RecentCollection,TopRecipient,TopToken} from '@/app/data';
import {asSOL,usePlatform} from './platform-actions';

type Go=(route:string)=>void;
function RecipientAvatar({photo}:{photo:string|null}){const [failed,setFailed]=useState(false);return photo&&!failed?<img className="round-avatar" src={photo} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<span className="activity-avatar round-avatar"><Send size={17}/></span>;}
export function RelativeTime({value}:{value:string}){
 const timestamp=Date.parse(value);if(!Number.isFinite(timestamp))return <span>—</span>;
 const delta=Math.max(0,Date.now()-timestamp);
 const age=delta<60000?'Just now':delta<3600000?Math.floor(delta/60000)+'m ago':delta<86400000?Math.floor(delta/3600000)+'h ago':Math.floor(delta/86400000)+'d ago';
 return <time dateTime={value} title={new Date(value).toLocaleString()}>{age}</time>;
}
export function ClaimRows({claims,go,limit=5}:{claims:RecentClaim[];go:Go;limit?:number}){
 if(!claims.length)return <div className="activity-empty">No claims have settled yet.</div>;
 return <div className="claim-rows">{claims.slice(0,limit).map(c=><button className="claim-row" key={c.id} onClick={()=>go('account/'+c.handle)}><div><strong>{asSOL(c.amount)} <span>SOL</span></strong><small>claimed by <b>@{c.handle}</b></small></div><div className="transfer-icons"><span className="activity-avatar"><Send size={18}/></span><ArrowRight size={13}/><Send size={20}/></div><span className="row-time"><RelativeTime value={c.confirmed_at}/></span></button>)}</div>;
}
export function MostEarned({recipients,profiles,go}:{recipients:TopRecipient[];profiles:{handle:string;name:string;photo:string|null}[];go:Go}){
 if(!recipients.length)return <div className="activity-empty">No Telegram accounts have received a token yet.</div>;
 return <div className="ranking-list">{recipients.slice(0,5).map((r,i)=>{const p=profiles.find(x=>x.handle===r.handle);return <button onClick={()=>go('account/'+r.handle)} key={r.handle}><span>{i+1}</span><RecipientAvatar photo={p?.photo||null}/><div><strong>{p?.name||'@'+r.handle}</strong><small>@{r.handle}</small></div><b>{asSOL(r.earned_lamports)} <small>SOL</small></b></button>})}</div>;
}
export function TopEarningTokens({tokens,go}:{tokens:TopToken[];go:Go}){
 if(!tokens.length)return <div className="activity-empty">No confirmed tokens yet.</div>;
 return <div className="ranking-list">{tokens.slice(0,5).map((t,i)=><button key={t.id} onClick={()=>go('token/'+t.id)}><span>{i+1}</span><img src={t.image_uri} className="round-avatar" alt="" loading="lazy"/><div><strong>{t.name}</strong><small>{t.symbol} · @{t.recipient_handle}</small></div><b>{asSOL(t.earned_lamports)} <small>SOL</small></b></button>)}</div>;
}
export function Ledger({kind='collections',data,go}:{kind?:'collections'|'settlements';data:PublicAnalytics|null;go:Go}){
 const rows=kind==='collections'?data?.recent:data?.recentClaims;
 const {runtime,analyticsError,refreshAnalytics}=usePlatform();
 if(!data)return <div className="activity-empty" role={analyticsError?'alert':'status'}>{analyticsError?<>{analyticsError} <button className="text-link" onClick={()=>void refreshAnalytics()}>Retry</button></>:'Loading live activity…'}</div>;
 if(!rows?.length)return <div className="activity-empty">{kind==='collections'?'No creator fees have been collected yet.':'No claims have settled yet.'}</div>;
 return <Table className="ledger"><TableHeader><TableRow><TableHead>{kind==='collections'?'Token':'Recipient'}</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Record</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0,8).map(row=>{
  const collection=kind==='collections'?row as RecentCollection:null,claim=kind==='settlements'?row as RecentClaim:null;
  const signature=collection?.signature||claim?.signature;
  return <TableRow key={collection?.event_id||claim?.id}><TableCell><button className="ledger-person" onClick={()=>go(collection?'token/'+collection.launch_id:'account/'+claim!.handle)}>{collection?<img className="round-avatar" src={collection.token_image} alt="" loading="lazy"/>:<span className="activity-avatar round-avatar"><Send size={17}/></span>}<span>{collection?.token_name||'@'+claim!.handle}</span></button></TableCell><TableCell>{asSOL(collection?.gross||claim!.amount)} SOL</TableCell><TableCell><span className="status-tag">{collection?'Collected':'Claimed'}</span></TableCell><TableCell>{signature?<a className="text-link" href={`https://solscan.io/tx/${signature}${runtime?.cluster==='devnet'?'?cluster=devnet':''}`} target="_blank" rel="noreferrer" aria-label="View transaction on Solscan">Solscan ↗</a>:<span className="muted">—</span>}</TableCell></TableRow>;
 })}</TableBody></Table>;
}
export function AccumulatedFeeChart({data,period}:{data:PublicAnalytics|null;period:string}){
 const days=period==='7d'?7:30,now=new Date(),today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
 const daily=new Map((data?.daily||[]).map(d=>[new Date(d.day).toISOString().slice(0,10),BigInt(d.collected)]));
 const series=Array.from({length:days},(_,i)=>new Date(today-(days-1-i)*86400000).toISOString().slice(0,10));
 let running=0n;const cumulative=series.map(day=>{running+=daily.get(day)||0n;return running;});
 const peak=cumulative.at(-1)||0n;const points=cumulative.map((amount,i)=>`${(i/(days-1)*360).toFixed(2)},${(145-Number(amount)*130/Number(peak||1n)).toFixed(2)}`).join(' ');
 const dateLabel=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(value+'T00:00:00Z'));
 return <div className="chart large-chart" role="img" aria-label={peak? `Accumulated creator fees in the last ${days} days: ${asSOL(peak.toString())} SOL`:`No creator fees collected in the last ${days} days`}>
  {peak>0n?<svg viewBox="0 0 360 160" preserveAspectRatio="none"><defs><linearGradient id="fee-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity=".16"/><stop offset="100%" stopColor="var(--primary)" stopOpacity="0"/></linearGradient></defs><path d={`M${points.replaceAll(' ',' L')} L360,160 L0,160 Z`} fill="url(#fee-chart-fill)"/><polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/></svg>:<div className="activity-chart-empty">No fees collected in this period yet.</div>}
  <div className="chart-axis"><span>{dateLabel(series[0])}</span><span>{dateLabel(series[Math.floor((days-1)/2)])}</span><span>{dateLabel(series[days-1])}</span></div>
 </div>;
}
