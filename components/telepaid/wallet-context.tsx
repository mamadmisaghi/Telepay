"use client";
import {Component,createContext,useContext,useEffect,useState,lazy,Suspense,type ReactNode} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {verifyWalletSignature,walletTestMessage} from '@/lib/wallet-signature';

export type TeleWallet={ready:boolean;address:string;error:string;connect:()=>void;disconnect:()=>Promise<void>;signMessage:(message:Uint8Array)=>Promise<Uint8Array>;signTransaction:(transaction:Uint8Array)=>Promise<Uint8Array>};
const unavailable=async():Promise<never>=>{throw new Error('Wallet service is not ready. Please try again.');};
const fallback:TeleWallet={ready:false,address:'',error:'',connect:()=>{},disconnect:unavailable,signMessage:unavailable,signTransaction:unavailable};
export const WalletContext=createContext<TeleWallet>(fallback);
export const useTeleWallet=()=>useContext(WalletContext);
const PrivyWallet=lazy(()=>import('./privy-wallet'));
class WalletErrorBoundary extends Component<{children:ReactNode;page:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<WalletContext.Provider value={{...fallback,error:'Wallet connection could not load. Please reload to retry.'}}>{this.props.page}</WalletContext.Provider>:this.props.children;}
}

export function WalletProvider({children}:{children:ReactNode}){
 const [config,setConfig]=useState<{privyAppId?:string;cluster?:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;
  if(location.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(location.hostname)){setError('Open TelePaid over HTTPS to connect your wallet.');return;}
  fetch('/api/runtime').then(r=>{if(!r.ok)throw new Error();return r.json() as Promise<{privyAppId?:string;cluster?:string}>}).then(c=>{if(active){setConfig(c);if(!c.privyAppId)setError('Wallet connection is awaiting configuration.');}}).catch(()=>{if(active)setError('Wallet service could not be reached. Reload to retry.');});return()=>{active=false}},[]);
 if(!config?.privyAppId)return <WalletContext.Provider value={{...fallback,error}}>{children}</WalletContext.Provider>;
 return <WalletErrorBoundary page={children}><Suspense fallback={<WalletContext.Provider value={fallback}>{children}</WalletContext.Provider>}><PrivyWallet appId={config.privyAppId} cluster={config.cluster||'mainnet-beta'}>{children}</PrivyWallet></Suspense></WalletErrorBoundary>;
}

export function WalletButton({className='btn outline small',onVerify,verified=false}:{className?:string;onVerify?:()=>Promise<void>;verified?:boolean}){
 const wallet=useTeleWallet();const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{setMessage('');setError('');if(!wallet.address)setOpen(false)},[wallet.address]);
 async function testSignature(){setBusy(true);setError('');setMessage('');try{const address=wallet.address,bytes=new TextEncoder().encode(walletTestMessage(location.origin,address));const signature=await wallet.signMessage(bytes);if(!await verifyWalletSignature(address,bytes,signature))throw new Error('Signature did not match this wallet.');setMessage('Signature verified. No transaction sent and no funds moved.');}catch(e){setError(e instanceof Error?e.message:'Signature test was cancelled.')}finally{setBusy(false)}}
 return <><button className={className} onClick={()=>{setError('');setMessage('');if(wallet.address||!wallet.ready)setOpen(true);else wallet.connect()}}>{wallet.address?wallet.address.slice(0,4)+'…'+wallet.address.slice(-4):'Connect wallet'}</button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="neutral-dialog"><DialogTitle>{wallet.address?'Your Solana wallet':'Connect your wallet'}</DialogTitle><DialogDescription>{wallet.address?'Connected with Privy. Telegram verification is separate from wallet connection.':wallet.error||'Loading Privy. Please try again in a moment.'}</DialogDescription>{wallet.address&&<><p className="live-address">{wallet.address}</p>{onVerify&&!verified&&<button className="btn white" disabled={busy} onClick={async()=>{setBusy(true);try{await onVerify();setMessage('Wallet verified for this Telegram session.')}catch(e){setError(e instanceof Error?e.message:'Verification failed.')}finally{setBusy(false)}}}>Verify wallet for Telegram</button>}{verified&&<p className="field-help">Verified for your current Telegram session.</p>}<button className="btn outline" disabled={busy} onClick={()=>void testSignature()}>{busy?'Waiting for wallet…':'Test wallet signature'}</button><p className="field-help">Signs a test message only. This does not approve a transaction or verify a Telegram account.</p><button className="text-link" disabled={busy} onClick={()=>void wallet.disconnect().then(()=>setOpen(false)).catch(()=>setError('Disconnect from your wallet extension, then reload.'))}>Disconnect wallet</button></>}{(error||(wallet.address&&wallet.error))&&<p className="form-error" role="alert">{error||wallet.error}</p>}{message&&<p className="wallet-test-success" role="status">{message}</p>}</DialogContent></Dialog>
 {wallet.error&&!open&&<div className="toast" role="alert">{wallet.error}</div>}</>;
}
