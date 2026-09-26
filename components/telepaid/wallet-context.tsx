"use client";
import {Component,createContext,useContext,useEffect,useState,lazy,Suspense,type ReactNode} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {LogOut} from 'lucide-react';

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

export function WalletButton({className='btn outline small'}:{className?:string;onVerify?:()=>Promise<void>;verified?:boolean}){
 const wallet=useTeleWallet();const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setOpen(false);setError('');},[wallet.address]);
 async function disconnect(){setBusy(true);setError('');try{await wallet.disconnect();setOpen(false);}catch{setError('Could not disconnect. Please try again.');}finally{setBusy(false)}}
 if(wallet.address)return <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
  <DropdownMenuTrigger asChild><button type="button" className={className} aria-label={`Wallet ${wallet.address}. Open wallet menu`}>{wallet.address.slice(0,4)+'…'+wallet.address.slice(-4)}</button></DropdownMenuTrigger>
  <DropdownMenuContent align="end" sideOffset={8} className="wallet-menu" aria-label="Wallet options">
   <DropdownMenuItem disabled={busy} onSelect={e=>{e.preventDefault();void disconnect()}}><LogOut size={16}/>{busy?'Disconnecting…':'Disconnect'}</DropdownMenuItem>
   {error&&<p className="wallet-menu-error" role="alert">{error}</p>}
  </DropdownMenuContent>
 </DropdownMenu>;
 return <><button className={className} onClick={()=>{setError('');if(wallet.ready)wallet.connect();else setOpen(true)}}>Connect wallet</button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="neutral-dialog"><DialogTitle>Connect your wallet</DialogTitle><DialogDescription>{wallet.error||'Loading Privy. Please try again in a moment.'}</DialogDescription></DialogContent></Dialog>
 {wallet.error&&!open&&<div className="toast" role="alert">{wallet.error}</div>}</>;
}
