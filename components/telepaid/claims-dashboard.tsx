'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,RefreshCw,UserRound} from 'lucide-react';
import type {PublicToken} from '@/app/data';
import {asSOL,ClaimAccount,request,usePlatform} from './platform-actions';
import {CopyAddress} from './copy-address';
import {useTeleWallet,WalletButton} from './wallet-context';

type Profile={tokens:PublicToken[];nextOffset:number|null};
export function ClaimsDashboard({go,onVerify}:{go:(route:string)=>void;onVerify:(claimAfterVerification?:boolean)=>void}){
 const {session,refresh}=usePlatform(),wallet=useTeleWallet();
 const handle=session.user!.username;
 const [tokens,setTokens]=useState<PublicToken[]>([]),[next,setNext]=useState<number|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[photo,setPhoto]=useState<string|null>(null);
 const pending=useRef(false),alive=useRef(true);
 const load=useCallback(async(offset=0)=>{
  if(pending.current)return;pending.current=true;setLoading(true);setError('');
  try{const result=await request<Profile>(`/api/public/profile/${encodeURIComponent(handle)}?offset=${offset}`);if(!alive.current)return;setTokens(old=>offset?[...old,...result.tokens.filter(t=>!old.some(x=>x.id===t.id))]:result.tokens);setNext(result.nextOffset??null);}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not load your tokens. Please retry.');}finally{pending.current=false;if(alive.current)setLoading(false);}
 },[handle]);
 useEffect(()=>{alive.current=true;void load();void request<{results:{handle:string;photo:string|null}[]}>(`/api/public/recipients?q=${encodeURIComponent(handle)}`).then(r=>{if(alive.current)setPhoto(r.results.find(p=>p.handle===handle)?.photo||null)}).catch(()=>{});
  const sync=()=>{if(document.visibilityState==='visible')void refresh().catch(()=>{})};const timer=setInterval(sync,30000);window.addEventListener('focus',sync);
  return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('focus',sync)};
 },[handle,load,refresh]);
 const linked=!!wallet.address&&session.wallets?.includes(wallet.address);
 const destination=linked?wallet.address:session.wallets?.[0];
 return <div className="claims-dashboard">
  <section className="claim-identity" aria-label="Verified Telegram account">
   <div className="claim-person"><div className="claim-avatar">{photo?<img src={photo} alt="Telegram profile" onError={()=>setPhoto(null)}/>:<UserRound size={27}/>}</div><div><h2>{session.user!.name||handle}</h2><p>@{handle} <span className="claim-verified"><Check size={13}/> Verified</span></p></div></div>
   <div className="claim-wallet"><span>{linked?'Connected receiving wallet':'Verified receiving wallet'}</span>{destination?<CopyAddress address={destination} label="wallet address"/>:<span>No wallet linked</span>}{!wallet.address?<WalletButton className="text-link"/>:!linked?<button className="text-link" onClick={()=>onVerify()}>Verify connected wallet</button>:null}</div>
   <button className="text-link" onClick={()=>onVerify()}>Switch account</button>
  </section>
  <ClaimAccount onVerify={onVerify}/>
  <section className="claim-token-section" aria-labelledby="my-token-title">
   <div className="claim-token-heading"><div><h2 id="my-token-title">Tokens created for you</h2><p>Creator fees assigned to @{handle}, whoever launched the token.</p></div><button className="btn outline small" disabled={loading} onClick={()=>{void load();void refresh().catch(()=>{})}} aria-label="Refresh your tokens"><RefreshCw size={15}/><span>Refresh</span></button></div>
   {error&&<div className="claim-message" role="alert"><p>{error}</p><button className="text-link" onClick={()=>void load(next&&tokens.length?next:0)}>Try again</button></div>}
   {loading&&!tokens.length?<p className="claim-message" role="status">Loading your tokens…</p>:!error&&!tokens.length?<div className="claim-message"><h3>No tokens assigned yet</h3><p>Tokens launched for @{handle} will appear here, even before they earn any fees.</p><button className="btn outline" onClick={()=>go('launch')}>Launch a token <ArrowUpRight size={15}/></button></div>:null}
   {!!tokens.length&&<div className="claim-token-list">{tokens.map(token=><button key={token.id} className="claim-token-row" onClick={()=>go('token/'+token.id)} aria-label={`View ${token.name} token`}><div className="claim-token-name"><img src={token.image_uri} alt="" loading="lazy"/><div><strong>{token.name}</strong><span>{token.symbol} · Solana</span></div></div><span className="claim-token-date">Created {new Date(token.confirmed_at).toLocaleDateString()}</span><div className="claim-token-earned"><strong>{asSOL(token.earned_lamports)} <span>SOL</span></strong><small>Your earned share · 80%</small></div><ArrowUpRight size={18}/></button>)}</div>}
   {next!==null&&<button className="btn outline claim-load-more" disabled={loading} onClick={()=>void load(next)}>{loading?'Loading…':'Load more tokens'}</button>}
   <p className="claim-token-note">Earnings reflect finalized fees received by TelePaid. A token can appear here with zero earnings. Withdrawals use your combined account balance.</p>
  </section>
 </div>;
}
