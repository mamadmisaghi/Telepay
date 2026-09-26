'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import bs58 from 'bs58';
import {useTeleWallet,WalletButton} from './wallet-context';

type Runtime={integrated?:boolean;telegram:boolean;launch:boolean;claims:boolean;cluster:string;minimumClaimLamports:string};
type Session={user:{username:string;name:string}|null;csrf?:string;claimVerificationFresh?:boolean;wallets?:string[];balance?:{available:string;reserved:string;settled:string}};
type Launch={id:string;mint:string;name:string;status:string;transaction:string;signature?:string;recipientHandle:string;initialBuyLamports:string;buy?:{status:string;transaction:string;signature?:string}};
export async function request<T=any>(path:string,body?:unknown,headers:Record<string,string>={}){
 const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const data=await r.json() as T&{error?:string};if(!r.ok)throw new Error(data.error||'The request could not be completed');return data;
}
export function asSOL(value='0'){const n=BigInt(value);return `${n/1000000000n}.${(n%1000000000n).toString().padStart(9,'0')}`.replace(/\.?0+$/,'');}
function lamports(value:string){if(!/^\d+(\.\d{1,9})?$/.test(value||'0'))throw new Error('Use a SOL amount with up to 9 decimal places');const [a,b='']=(value||'0').split('.');return (BigInt(a)*1000000000n+BigInt(b.padEnd(9,'0'))).toString();}
const PlatformContext=createContext<{runtime:Runtime|null;session:Session;refresh:()=>Promise<void>}>({runtime:null,session:{user:null},refresh:async()=>{}});
export const usePlatform=()=>useContext(PlatformContext);
export function PlatformProvider({children}:{children:ReactNode}){
 const [runtime,setRuntime]=useState<Runtime|null>(null),[session,setSession]=useState<Session>({user:null});
 async function refresh(){setSession(await request('/api/session'));}
 useEffect(()=>{void request('/api/runtime').then(setRuntime).catch(()=>{});void refresh().catch(()=>{});},[]);
 return <PlatformContext.Provider value={{runtime,session,refresh}}>{children}</PlatformContext.Provider>;
}
function useOperation(){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Please try again');}finally{lock.current=false;setBusy(false);}}
 return {busy,error,run};
}
async function ensureLauncher(wallet:ReturnType<typeof useTeleWallet>){
 if(!wallet.address)throw new Error('Connect your wallet first');
 const existing=await request('/api/auth/wallet/session');if(existing.address===wallet.address)return existing as {address:string;csrf:string};
 const challenge=await request('/api/auth/wallet/start',{address:wallet.address});
 const signature=bs58.encode(await wallet.signMessage(new TextEncoder().encode(challenge.message)));
 return await request('/api/auth/wallet/finish',{id:challenge.id,signature}) as {address:string;csrf:string};
}
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export function TransactionLink({signature,cluster}:{signature?:string;cluster?:string}){return signature?<a className="text-link" href={`https://solscan.io/tx/${signature}${cluster==='devnet'?'?cluster=devnet':''}`} target="_blank" rel="noreferrer">View transaction ↗</a>:null;}
export function TelegramAction(){
 const wallet=useTeleWallet(),{runtime,session,refresh}=usePlatform(),{busy,error,run}=useOperation();
 const [login,setLogin]=useState<{id:string;url:string}|null>(null),[notice,setNotice]=useState('');
 async function start(){const s=await ensureLauncher(wallet);setLogin(await request('/api/auth/bot/start',{}, {'x-launch-csrf':s.csrf}));setNotice('Open the bot, confirm the wallet shown there, then return here.');}
 async function finish(){const s=await ensureLauncher(wallet),result=await request('/api/auth/bot/finish',{id:login?.id},{'x-launch-csrf':s.csrf});if(result.pending){setNotice('Waiting for your confirmation in Telegram.');return;}setLogin(null);await refresh();setNotice(`@${result.username} verified. Your wallet is ready for fee claims.`);}
 return <>{!wallet.address?<WalletButton className="btn white"/>:<p className="field-help">Wallet: {wallet.address.slice(0,6)}…{wallet.address.slice(-6)}</p>}
 {session.user&&<p className="field-help">Signed in as @{session.user.username}</p>}
 {!login?<button className="btn white" disabled={busy||!wallet.address||!runtime?.telegram} onClick={()=>void run(start)}>{busy?'Waiting for wallet…':'Verify with TelePayFunBot'}</button>:<><a className="btn white" href={login.url} target="_blank" rel="noreferrer">Open Telegram bot</a><button className="btn outline" disabled={busy} onClick={()=>void run(finish)}>{busy?'Checking…':'I confirmed in Telegram'}</button><button className="text-link" disabled={busy} onClick={()=>void run(start)}>Start a new verification</button></>}
 {!runtime?.telegram&&<p className="field-help">Telegram verification is awaiting configuration.</p>}{notice&&<p className="field-help" role="status">{notice}</p>}{error&&<p className="form-error" role="alert">{error}</p>}</>;
}
export function LaunchAction({form,image}:{form:{name:string;symbol:string;recipient:string;description:string;website:string;telegram:string;twitter:string;initialBuy:string};image:string}){
 const wallet=useTeleWallet(),{runtime}=usePlatform(),{busy,error,run}=useOperation();
 const [launch,setLaunch]=useState<Launch|null>(null),[notice,setNotice]=useState('');const key=useRef(crypto.randomUUID());
 const storageKey=`telepaid:launch:${runtime?.cluster}:${wallet.address}`;
 useEffect(()=>{let active=true;if(!runtime?.integrated||!wallet.address)return;const id=localStorage.getItem(storageKey);if(id)void request('/api/auth/wallet/session').then(s=>s.address===wallet.address?request(`/api/launches/${id}`):null).then(l=>{if(active&&l)setLaunch(l)}).catch(()=>{});return()=>{active=false}},[storageKey,runtime?.integrated,wallet.address]);
 useEffect(()=>{if(!launch||!['submitted','preparing'].includes(launch.status)&&launch.buy?.status!=='submitted')return;const id=setInterval(()=>{void request(`/api/launches/${launch.id}`).then(setLaunch).catch(()=>{})},5000);return()=>clearInterval(id)},[launch]);
 async function prepare(){const saved=localStorage.getItem(storageKey);if(saved){await ensureLauncher(wallet);setLaunch(await request(`/api/launches/${saved}`));return;}if(!image)throw new Error('Upload a token image first');const s=await ensureLauncher(wallet);const row=await request('/api/launches/prepare',{...form,wallet:wallet.address,image,initialBuyLamports:lamports(form.initialBuy)}, {'x-csrf-token':s.csrf,'idempotency-key':key.current});localStorage.setItem(storageKey,row.id);setLaunch(row);setNotice('Transaction prepared. Review the network and recipient before signing.');}
 async function refresh(){const s=await ensureLauncher(wallet);setLaunch(await request(`/api/launches/${launch!.id}/refresh`,{}, {'x-csrf-token':s.csrf}));}
 async function signCreate(){const s=await ensureLauncher(wallet);setNotice('Review token creation in your wallet.');const signed=await wallet.signTransaction(decode(launch!.transaction));setLaunch(await request(`/api/launches/${launch!.id}/submit`,{transaction:encode(signed)}, {'x-csrf-token':s.csrf}));setNotice('Submitted. Waiting for Solana finalization; you can return to this launch.');}
 async function buy(){const s=await ensureLauncher(wallet);const headers={'x-csrf-token':s.csrf};const quote=await request(`/api/launches/${launch!.id}/buy/prepare`,{},headers);if(quote.status==='prepared'){setNotice('Review the separate initial buy in your wallet (1% slippage).');const signed=await wallet.signTransaction(decode(quote.transaction));await request(`/api/launches/${launch!.id}/buy/submit`,{transaction:encode(signed)},headers);}setLaunch(await request(`/api/launches/${launch!.id}`));}
 return <><p className="field-help">{runtime?.cluster==='mainnet-beta'?'Solana Mainnet · Real SOL':'Solana Devnet'} · Recipient @{launch?.recipientHandle||form.recipient}</p>
 <p className="field-help">Initial buy: {launch?asSOL(launch.initialBuyLamports):form.initialBuy||'0'} SOL, approved separately after creation. Network fees and account rent are additional.</p>
 {!wallet.address&&<WalletButton className="btn white"/>}
 {!launch&&<button className="btn white" disabled={busy||!wallet.address||!runtime?.launch} onClick={()=>void run(prepare)}>{busy?'Preparing…':'Prepare on-chain launch'}</button>}
 {launch&&<><p className="field-help" role="status">{launch.name} · {launch.status}</p><p className="live-address">{launch.mint}</p><TransactionLink signature={launch.signature} cluster={runtime?.cluster}/>
 {launch.status==='prepared'&&<button className="btn white" disabled={busy||!runtime?.launch} onClick={()=>void run(signCreate)}>{busy?'Waiting for wallet…':'Sign & create token'}</button>}
 {['expired','failed','prepared'].includes(launch.status)&&<button className="btn outline" disabled={busy||!runtime?.launch} onClick={()=>void run(refresh)}>Refresh this launch transaction</button>}
 {launch.status==='confirmed'&&BigInt(launch.initialBuyLamports)>0n&&<><p className="field-help">Initial buy: {launch.buy?.status||'Awaiting your approval'}</p><TransactionLink signature={launch.buy?.signature} cluster={runtime?.cluster}/>{!['submitted','confirmed'].includes(launch.buy?.status||'')&&<button className="btn white" disabled={busy||!runtime?.launch} onClick={()=>void run(buy)}>{busy?'Preparing buy…':'Approve initial buy'}</button>}</>}
 {['confirmed','failed','expired'].includes(launch.status)&&<button className="text-link" disabled={busy} onClick={()=>{setLaunch(null);localStorage.removeItem(storageKey);key.current=crypto.randomUUID();setNotice('');}}>Start another launch</button>}</>}
 {!runtime?.launch&&<p className="field-help">On-chain launches are paused while the launch service is prepared.</p>}{notice&&<p className="field-help" role="status">{notice}</p>}{error&&<p className="form-error" role="alert">{error}</p>}</>;
}
export function ClaimAccount({onVerify}:{onVerify:()=>void}){
 const {session,runtime,refresh}=usePlatform(),wallet=useTeleWallet(),{busy,error,run}=useOperation();
 const [claim,setClaim]=useState<{id:string;status:string;signature?:string}|null>(null),key=useRef(crypto.randomUUID());
 useEffect(()=>{if(!claim||!['queued','submitted'].includes(claim.status))return;const timer=setInterval(()=>{void request('/api/claims').then(r=>{const found=r.claims.find((c:{id:string})=>c.id===claim.id);if(found){setClaim(found);if(['confirmed','failed'].includes(found.status))void refresh();}}).catch(()=>{})},5000);return()=>clearInterval(timer)},[claim]);
 useEffect(()=>{key.current=crypto.randomUUID();if(session.user)void request('/api/claims').then(r=>setClaim(r.claims[0]||null)).catch(()=>{})},[session.csrf]);
 if(!runtime?.integrated||!session.user)return null;
 const available=session.balance?.available||'0';
 async function submit(){const result=await request('/api/claims',{wallet:wallet.address,amount:available},{'x-csrf-token':session.csrf||'','idempotency-key':key.current});setClaim(result);await refresh();}
 return <div className="lookup-result"><h3>@{session.user.username}</h3><div className="lookup-amount">{asSOL(available)} <span>SOL</span></div><p>Available creator fees · {asSOL(session.balance?.reserved)} SOL pending</p>
 {!session.claimVerificationFresh||!session.wallets?.includes(wallet.address)?<button className="btn white" onClick={onVerify}>Verify Telegram & wallet</button>:<button className="btn white" disabled={busy||!runtime.claims||BigInt(available)<BigInt(runtime.minimumClaimLamports)||!!claim&&['queued','submitted'].includes(claim.status)} onClick={()=>void run(submit)}>{busy?'Submitting…':'Claim to connected wallet'}</button>}
 {!runtime.claims&&<p className="field-help">Payouts are paused until the settlement service is funded.</p>}{claim&&<p role="status">Claim {claim.status} <TransactionLink signature={claim.signature} cluster={runtime.cluster}/></p>}{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
export function RealLaunches(){
 const {runtime}=usePlatform();const [rows,setRows]=useState<Array<{id:string;mint:string;name:string;symbol:string;image_uri:string;recipient_handle:string;earned_lamports:string}>>([]);
 useEffect(()=>{if(!runtime?.integrated)return;void request('/api/public/tokens').then(r=>setRows(r.tokens)).catch(()=>{})},[runtime?.integrated]);
 if(!rows.length)return null;
 return <section><div className="section-head"><h2>On-chain launches</h2><span>Verified on Solana</span></div><div className="token-grid explore-grid">{rows.map(t=><a className="token-card" key={t.id} href={`https://pump.fun/coin/${t.mint}`} target="_blank" rel="noreferrer"><div className="token-picture"><img src={t.image_uri} alt={t.name} style={{width:'100%',height:'100%',objectFit:'cover'}}/></div><div className="token-caption"><div><span>{t.name}</span><small>{t.symbol}</small></div><div className="card-earned"><span>{asSOL(t.earned_lamports)} SOL</span><small>@{t.recipient_handle}</small></div></div></a>)}</div></section>;
}
