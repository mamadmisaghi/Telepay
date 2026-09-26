'use client';
import {createContext,useContext,useEffect,useRef,useState,useCallback,type ReactNode} from 'react';
import bs58 from 'bs58';
import {fromPublicToken,type Token,type PublicToken} from '@/app/data';
import {useTeleWallet,WalletButton} from './wallet-context';
import {signOutBrowser,walletDisconnectedKey} from './sign-out';

type Runtime={integrated?:boolean;telegram:boolean;telegramBotUsername?:string;launch:boolean;claims:boolean;cluster:string;minimumClaimLamports:string};
type Session={user:{username:string;name:string}|null;csrf?:string;claimVerificationFresh?:boolean;wallets?:string[];claimVerificationExpiresAt?:string;balance?:{earned:string;available:string;reserved:string;settled:string}};
type Claim={id:string;status:string;signature?:string};
export type Launch={id:string;mint:string;name:string;status:string;transaction:string;signature?:string;recipientHandle:string;initialBuyLamports:string;launchFormat?:string;buy?:{status:string;transaction:string;signature?:string}};
export async function request<T=any>(path:string,body?:unknown,headers:Record<string,string>={}){
 const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const data=await r.json() as T&{error?:string};if(!r.ok)throw new Error(data.error||'The request could not be completed');return data;
}
export function asSOL(value='0'){const n=BigInt(value);return `${n/1000000000n}.${(n%1000000000n).toString().padStart(9,'0')}`.replace(/\.?0+$/,'');}
export const freshClaimProof=(session:Session)=>!!session.claimVerificationFresh&&Date.now()<Date.parse(session.claimVerificationExpiresAt||'');
export async function submitAvailableClaim(wallet:string,recipient:string,minimum:string,key:string){
 const session=await request<Session>('/api/session');
 if(session.user?.username?.toLowerCase()!==recipient.toLowerCase())throw new Error(`Verify @${recipient} in Telegram to claim its fees.`);
 if(!wallet||!session.wallets?.includes(wallet))throw new Error('Verify your connected receiving wallet in Telegram first.');
 if(!freshClaimProof(session))throw new Error('Confirm your current Telegram username again before claiming.');
 const amount=session.balance?.available||'0';
 if(BigInt(amount)<BigInt(minimum))throw new Error(`Minimum claim: ${asSOL(minimum)} SOL.`);
 return request<Claim>('/api/claims',{wallet,amount},{'x-csrf-token':session.csrf||'','idempotency-key':key});
}
function lamports(value:string){if(!/^\d+(\.\d{1,9})?$/.test(value||'0'))throw new Error('Use a SOL amount with up to 9 decimal places');const [a,b='']=(value||'0').split('.');return (BigInt(a)*1000000000n+BigInt(b.padEnd(9,'0'))).toString();}
const PlatformContext=createContext<{runtime:Runtime|null;session:Session;refresh:()=>Promise<void>;liveTokens:Token[];tokensError:string;refreshTokens:()=>Promise<void>}>({runtime:null,session:{user:null},refresh:async()=>{},liveTokens:[],tokensError:'',refreshTokens:async()=>{}});
export const usePlatform=()=>useContext(PlatformContext);
export function PlatformProvider({children}:{children:ReactNode}){
 const [runtime,setRuntime]=useState<Runtime|null>(null),[session,setSession]=useState<Session>({user:null});
 const [liveTokens,setLiveTokens]=useState<Token[]>([]),[tokensError,setTokensError]=useState('');
 const sessionEpoch=useRef(0),detachedLogout=useRef(false);
 const refreshTokens=useCallback(async()=>{try{const rows=await request<{tokens:PublicToken[]}>('/api/public/tokens');setLiveTokens(rows.tokens.map(r=>fromPublicToken(r)));setTokensError('');}catch{setTokensError('Live launches could not be loaded. Try again.');}},[]);
 useEffect(()=>{if(!runtime?.integrated)return;void refreshTokens();const timer=setInterval(()=>void refreshTokens(),30000);const focus=()=>void refreshTokens();window.addEventListener('focus',focus);return()=>{clearInterval(timer);window.removeEventListener('focus',focus)}},[runtime?.integrated,refreshTokens]);
 const refresh=useCallback(async()=>{
  const epoch=sessionEpoch.current;
  let disconnected=false;try{disconnected=localStorage.getItem(walletDisconnectedKey)==='1'}catch{}
  if(disconnected){
   setSession({user:null});
   if(!detachedLogout.current){await signOutBrowser();detachedLogout.current=true;}
   return;
  }
  detachedLogout.current=false;
  const next=await request<Session>('/api/session');
  if(epoch===sessionEpoch.current)setSession(next);
 },[]);
 useEffect(()=>{const clear=()=>{sessionEpoch.current++;detachedLogout.current=true;setSession({user:null})};window.addEventListener('telepaid:logged-out',clear);return()=>window.removeEventListener('telepaid:logged-out',clear)},[]);
 useEffect(()=>{void request('/api/runtime').then(setRuntime).catch(()=>{});void refresh().catch(()=>{});
  const sync=()=>{if(document.visibilityState==='visible')void refresh().catch(()=>{})};
  const timer=setInterval(sync,60000);window.addEventListener('focus',sync);
  return()=>{clearInterval(timer);window.removeEventListener('focus',sync)};
 },[refresh]);
 return <PlatformContext.Provider value={{runtime,session,refresh,liveTokens,tokensError,refreshTokens}}>{children}</PlatformContext.Provider>;
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
type BotLogin={id:string;url:string;address:string;expiresAt:number;csrf:string};
export function TelegramAction({onVerified}:{onVerified?:(username:string)=>void}){
 const wallet=useTeleWallet(),{runtime,session,refresh}=usePlatform();
 const [login,setLogin]=useState<BotLogin|null>(null),[notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false),completed=useRef(''),active=useRef(true),latestWallet=useRef(wallet.address),verified=useRef(onVerified);
 latestWallet.current=wallet.address;verified.current=onVerified;
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
 useEffect(()=>{setLogin(null);completed.current='';setError('');try{const saved=JSON.parse(sessionStorage.getItem('telepaid:telegram-verification')||'null');if(saved?.address===wallet.address&&saved.expiresAt>Date.now())setLogin(saved);}catch{}},[wallet.address]);
 function save(value:BotLogin|null){setLogin(value);try{if(value)sessionStorage.setItem('telepaid:telegram-verification',JSON.stringify(value));else sessionStorage.removeItem('telepaid:telegram-verification');}catch{}}
 async function start(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const address=wallet.address;
  try{const s=await ensureLauncher(wallet);const result=await request('/api/auth/bot/start',{}, {'x-launch-csrf':s.csrf});if(!active.current||latestWallet.current!==address)return;completed.current='';save({...result,address,csrf:s.csrf,expiresAt:Date.now()+result.expiresIn*1000});setNotice('Open Telegram, confirm your wallet in the bot, then return. We’ll finish verification automatically.');}
  catch(e){if(active.current)setError(e instanceof Error?e.message:'Could not start verification. Try again.');}finally{lock.current=false;if(active.current)setBusy(false);}
 }
 const finish=useCallback(async()=>{
  if(!login||lock.current||latestWallet.current!==login.address)return;
  if(login.expiresAt<Date.now()&&!completed.current){save(null);setError('This verification expired. Start again below.');return;}
  lock.current=true;setBusy(true);
  try{
   if(!completed.current){const result=await request('/api/auth/bot/finish',{id:login.id},{'x-launch-csrf':login.csrf});if(!active.current||latestWallet.current!==login.address)return;if(result.pending){setNotice('Waiting for your confirmation in Telegram…');return;}completed.current=result.username;}
   await refresh();if(!active.current||latestWallet.current!==login.address)return;
   const username=completed.current;save(null);setError('');setNotice(`@${username} verified successfully.`);verified.current?.(username);
  }catch(e){if(active.current){setError(e instanceof Error?e.message:'Could not check verification. Try again.');}}
  finally{lock.current=false;if(active.current)setBusy(false);}
 },[login,refresh]);
 useEffect(()=>{
  if(!login||error)return;
  const check=()=>{if(document.visibilityState==='visible')void finish();};
  const timer=setInterval(check,8000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  return()=>{clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)};
 },[login,error,finish]);
 return <>{!wallet.address?<WalletButton className="btn white"/>:<p className="field-help">Receiving wallet: {wallet.address.slice(0,6)}…{wallet.address.slice(-6)}</p>}
 {session.user&&<p className="field-help">Signed in as @{session.user.username}</p>}
 {!login?<button className="btn white" disabled={busy||!wallet.address||!runtime?.telegram} onClick={()=>void start()}>{busy?'Waiting for wallet…':`Verify with @${runtime?.telegramBotUsername||'UseTelePay_bot'}`}</button>:<><a className="btn white" href={login.url} target="_blank" rel="noreferrer">Open Telegram bot</a><button className="btn outline" disabled={busy} onClick={()=>{setError('');void finish()}}>{busy?'Checking…':'Check verification'}</button><button className="text-link" disabled={busy} onClick={()=>void start()}>Start a new verification</button></>}
 {!runtime?.telegram&&<p className="field-help">Telegram verification is awaiting configuration.</p>}{notice&&<p className="field-help" role="status">{notice}</p>}{error&&<p className="form-error" role="alert">{error}</p>}</>;
}
export function LaunchAction({form,image,onCreated}:{onCreated:(id:string)=>void;form:{name:string;symbol:string;recipient:string;description:string;website:string;telegram:string;twitter:string;initialBuy:string};image:string}){
 const wallet=useTeleWallet(),{runtime,refreshTokens}=usePlatform(),{busy,error,run}=useOperation();
 const [launch,setLaunch]=useState<Launch|null>(null),[notice,setNotice]=useState('');const key=useRef(crypto.randomUUID());
 const storageKey=`telepaid:launch:${runtime?.cluster}:${wallet.address}`;
 const opened=useRef('');
 useEffect(()=>{if(launch?.status==='confirmed'&&opened.current!==launch.id){opened.current=launch.id;void refreshTokens();onCreated(launch.id)}},[launch?.status,launch?.id,onCreated,refreshTokens]);
 useEffect(()=>{let active=true;if(!runtime?.integrated||!wallet.address)return;const id=localStorage.getItem(storageKey);if(id)void request('/api/auth/wallet/session').then(s=>s.address===wallet.address?request(`/api/launches/${id}`):null).then(l=>{if(active&&l&&!['confirmed','failed','expired'].includes(l.status))setLaunch(l)}).catch(()=>{});return()=>{active=false}},[storageKey,runtime?.integrated,wallet.address]);
 useEffect(()=>{if(!launch||!['submitted','preparing'].includes(launch.status))return;const id=setInterval(()=>{void request(`/api/launches/${launch.id}`).then(setLaunch).catch(()=>{})},5000);return()=>clearInterval(id)},[launch]);
 async function prepare(){const saved=localStorage.getItem(storageKey);if(saved){await ensureLauncher(wallet);const previous=await request<Launch>(`/api/launches/${saved}`);if(!['confirmed','failed','expired'].includes(previous.status)){setLaunch(previous);setNotice('Resuming your saved launch. Its name, recipient and initial buy are shown below.');return;}localStorage.removeItem(storageKey);}if(!image)throw new Error('Upload a token image first');const s=await ensureLauncher(wallet);const row=await request('/api/launches/prepare',{...form,wallet:wallet.address,image,initialBuyLamports:lamports(form.initialBuy)}, {'x-csrf-token':s.csrf,'idempotency-key':key.current});localStorage.setItem(storageKey,row.id);setLaunch(row);setNotice('Transaction prepared. Review the network and recipient before signing.');}
 async function refresh(){const s=await ensureLauncher(wallet);setLaunch(await request(`/api/launches/${launch!.id}/refresh`,{}, {'x-csrf-token':s.csrf}));}
 async function signCreate(){const s=await ensureLauncher(wallet);if(launch!.launchFormat!=='atomic-v1')throw new Error('Refresh this launch transaction before signing.');setNotice('Review token creation and your initial buy in one transaction.');const signed=await wallet.signTransaction(decode(launch!.transaction));setLaunch(await request(`/api/launches/${launch!.id}/submit`,{transaction:encode(signed)}, {'x-csrf-token':s.csrf}));setNotice('Submitted. Waiting for Solana finalization; you can return to this launch.');}
 return <><p className="field-help">{runtime?.cluster==='mainnet-beta'?'Solana Mainnet · Real SOL':'Solana Devnet'} · Recipient @{launch?.recipientHandle||form.recipient}</p>
 <p className="field-help">Initial buy: {launch?asSOL(launch.initialBuyLamports):form.initialBuy||'0'} SOL, included in the same creation transaction (up to 1% slippage). Network fees and account rent are additional.</p>
 {!wallet.address&&<WalletButton className="btn white"/>}
 {!launch&&<button className="btn white" disabled={busy||!wallet.address||!runtime?.launch} onClick={()=>void run(prepare)}>{busy?'Preparing…':'Prepare on-chain launch'}</button>}
 {launch&&<><p className="field-help" role="status">{launch.name} · {launch.status}</p><p className="live-address">{launch.mint}</p><TransactionLink signature={launch.signature} cluster={runtime?.cluster}/>
 {launch.status==='prepared'&&launch.launchFormat==='atomic-v1'&&<button className="btn white" disabled={busy||!runtime?.launch} onClick={()=>void run(signCreate)}>{busy?'Waiting for wallet…':'Sign & create token'}</button>}
 {['expired','failed','prepared'].includes(launch.status)&&<button className="btn outline" disabled={busy||!runtime?.launch} onClick={()=>void run(refresh)}>Refresh this launch transaction</button>}
 {['confirmed','failed','expired'].includes(launch.status)&&<button className="text-link" disabled={busy} onClick={()=>{setLaunch(null);localStorage.removeItem(storageKey);key.current=crypto.randomUUID();setNotice('');}}>Start another launch</button>}</>}
 {!runtime?.launch&&<p className="field-help">On-chain launches are paused while the launch service is prepared.</p>}{notice&&<p className="field-help" role="status">{notice}</p>}{error&&<p className="form-error" role="alert">{error}</p>}</>;
}
export function ClaimAccount({onVerify}:{onVerify:(claimAfterVerification?:boolean)=>void}){
 const {session,runtime,refresh}=usePlatform(),wallet=useTeleWallet(),{busy,error,run}=useOperation();
 const [proofExpired,setProofExpired]=useState(false);
 useEffect(()=>{const until=Date.parse(session.claimVerificationExpiresAt||'');setProofExpired(!until||Date.now()>=until);if(!until)return;const timer=setTimeout(()=>setProofExpired(true),Math.max(0,until-Date.now()));return()=>clearTimeout(timer)},[session.claimVerificationExpiresAt]);
 const [claim,setClaim]=useState<Claim|null>(null),key=useRef(crypto.randomUUID());
 useEffect(()=>{if(!claim||!['queued','submitted'].includes(claim.status))return;const timer=setInterval(()=>{void request('/api/claims').then(r=>{const found=r.claims.find((c:{id:string})=>c.id===claim.id);if(found){setClaim(found);if(['confirmed','failed'].includes(found.status))void refresh();}}).catch(()=>{})},5000);return()=>clearInterval(timer)},[claim]);
 useEffect(()=>{key.current=crypto.randomUUID()},[session.csrf]);
 useEffect(()=>{if(session.user)void request('/api/claims').then(r=>setClaim(r.claims[0]||null)).catch(()=>{});else setClaim(null)},[session.csrf,session.balance?.reserved,session.balance?.settled]);
 if(!runtime?.integrated||!session.user)return null;
 const available=session.balance?.available||'0';
 async function submit(){const result=await submitAvailableClaim(wallet.address,session.user!.username,runtime!.minimumClaimLamports,key.current);setClaim(result);await refresh();}
 function claimNow(){if(!wallet.address){wallet.connect();return;}if(!session.wallets?.includes(wallet.address)||!freshClaimProof(session)||proofExpired){onVerify(true);return;}void run(submit);}
 return <section className="claim-balance" aria-label="Your creator fees"><dl className="claim-balances fee-summary"><div><dt>Available to claim</dt><dd>{asSOL(available)} <span>SOL</span></dd></div><div><dt>Total fees earned</dt><dd>{asSOL(session.balance?.earned)} <span>SOL</span></dd></div><div><dt>Claimed</dt><dd>{asSOL(session.balance?.settled)} <span>SOL</span></dd></div><div><dt>Pending claim</dt><dd>{asSOL(session.balance?.reserved)} <span>SOL</span></dd></div></dl><div className="claim-controls">
 <button className="btn white" disabled={busy||!runtime.claims||BigInt(available)<BigInt(runtime.minimumClaimLamports)||!!claim&&['queued','submitted'].includes(claim.status)} onClick={claimNow}>{busy?'Submitting…':claim&&['queued','submitted'].includes(claim.status)?'Claim submitted':'Claim to connected wallet'}</button>
 </div>{!runtime.claims?<p className="field-help">Payouts are currently paused. Your verified account and assigned tokens are shown below.</p>:BigInt(available)<BigInt(runtime.minimumClaimLamports)&&<p className="field-help">Minimum claim: {asSOL(runtime.minimumClaimLamports)} SOL. Only finalized, collected fees count toward your balance.</p>}{claim&&<p role="status">Claim {claim.status} <TransactionLink signature={claim.signature} cluster={runtime.cluster}/></p>}{error&&<p className="form-error" role="alert">{error}</p>}</section>;
}
export function TokenClaimAction({recipient,onVerify}:{recipient:string;onVerify:(claimAfterVerification?:boolean)=>void}){
 const {session,runtime,refresh}=usePlatform(),wallet=useTeleWallet(),{busy,error,run}=useOperation();
 const [claim,setClaim]=useState<Claim|null>(null),key=useRef(crypto.randomUUID());
 const owner=session.user?.username?.toLowerCase()===recipient.toLowerCase();
 const available=owner?session.balance?.available||'0':'0';
 useEffect(()=>{key.current=crypto.randomUUID();setClaim(null)},[recipient,session.csrf]);
 useEffect(()=>{if(!claim||!['queued','submitted'].includes(claim.status))return;const timer=setInterval(()=>{void request<{claims:Claim[]}>('/api/claims').then(r=>{const found=r.claims.find(c=>c.id===claim.id);if(found){setClaim(found);if(['confirmed','failed'].includes(found.status))void refresh();}}).catch(()=>{})},5000);return()=>clearInterval(timer)},[claim,refresh]);
 async function submit(){const result=await submitAvailableClaim(wallet.address,recipient,runtime!.minimumClaimLamports,key.current);setClaim(result);await refresh();}
 function claimNow(){if(!owner){onVerify(false);return;}if(!wallet.address){wallet.connect();return;}if(!session.wallets?.includes(wallet.address)||!freshClaimProof(session)){onVerify(true);return;}void run(submit);}
 return <><button className="btn white full" disabled={busy||!runtime?.claims||owner&&BigInt(available)<BigInt(runtime.minimumClaimLamports)||!!claim&&['queued','submitted'].includes(claim.status)} onClick={claimNow}>{busy?'Submitting…':owner?'Claim':'Verify & claim'}</button>{claim&&<p role="status">Claim {claim.status} <TransactionLink signature={claim.signature} cluster={runtime?.cluster}/></p>}{error&&<p className="form-error" role="alert">{error}</p>}</>;
}
