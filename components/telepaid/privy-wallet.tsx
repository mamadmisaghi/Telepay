"use client";
import {useState,type ReactNode} from 'react';
import {PrivyProvider,usePrivy,useConnectWallet} from '@privy-io/react-auth';
import {toSolanaWalletConnectors,useWallets,useSignMessage,useSignTransaction} from '@privy-io/react-auth/solana';
import {WalletContext} from './wallet-context';
import {walletDisconnectedKey} from './sign-out';

const connectors=toSolanaWalletConnectors({shouldAutoConnect:true});
function Bridge({children,cluster}:{children:ReactNode;cluster:string}){
 const {ready}=usePrivy(),{wallets,ready:walletsReady}=useWallets();
 const [error,setError]=useState(''),[selected,setSelected]=useState('');
 const [disconnected,setDisconnected]=useState(()=>{try{return localStorage.getItem(walletDisconnectedKey)==='1'}catch{return false}});
 const {connectWallet}=useConnectWallet({onSuccess:({wallet})=>{try{localStorage.removeItem(walletDisconnectedKey)}catch{}setDisconnected(false);setSelected(wallet.address);setError('')},onError:()=>setError('Wallet connection was cancelled or could not complete. Please try again.')});
 const {signMessage}=useSignMessage(),{signTransaction}=useSignTransaction();
 // Some external wallets cannot be disconnected programmatically. Keep an explicit
 // app-level disconnect across reloads instead of picking wallets[0] again.
 const wallet=disconnected?undefined:wallets.find(w=>w.address===selected)||(!disconnected?wallets[0]:undefined);
 return <WalletContext.Provider value={{ready:ready&&walletsReady,address:wallet?.address||'',error,
  connect:()=>{setError('');connectWallet({walletChainType:'solana-only'})},
  disconnect:async()=>{setDisconnected(true);try{localStorage.setItem(walletDisconnectedKey,'1')}catch{}setSelected('');setError('');try{await wallet?.disconnect()}catch{/* The app is already disconnected even if the wallet provider cannot disconnect. */}},
  signMessage:async message=>{if(!wallet)throw new Error('Connect a Solana wallet first.');return (await signMessage({wallet,message})).signature},
  signTransaction:async transaction=>{if(!wallet)throw new Error('Connect a Solana wallet first.');return (await signTransaction({wallet,transaction,chain:cluster==='devnet'?'solana:devnet':'solana:mainnet'})).signedTransaction}
 }}>{children}</WalletContext.Provider>;
}
export default function PrivyWallet({appId,cluster,children}:{appId:string;cluster:string;children:ReactNode}){
 return <PrivyProvider appId={appId} config={{appearance:{theme:'#111316',accentColor:'#1598f5',logo:'/telepaid-mark.png',walletChainType:'solana-only',walletList:['phantom','solflare','detected_solana_wallets']},externalWallets:{solana:{connectors}},loginMethods:['wallet'],embeddedWallets:{solana:{createOnLogin:'off'}}}}><Bridge cluster={cluster}>{children}</Bridge></PrivyProvider>;
}
