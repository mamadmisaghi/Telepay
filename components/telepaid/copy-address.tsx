'use client';
import {useEffect,useRef,useState} from 'react';
import {Check,Copy} from 'lucide-react';
export function CopyAddress({address,full=false}:{address:string;full?:boolean}){
 const [status,setStatus]=useState(''),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 async function copy(){try{await navigator.clipboard.writeText(address);setStatus('Copied');}catch{setStatus('Select and copy the address');}if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setStatus(''),2500);}
 return <span className="copy-address"><button type="button" onClick={copy} title={address} aria-label={`Copy contract address ${address}`}><span>{full?address:`${address.slice(0,6)}…${address.slice(-6)}`}</span>{status==='Copied'?<Check size={13}/>:<Copy size={13}/>}</button><span className="copy-status" role="status">{status}</span></span>;
}
