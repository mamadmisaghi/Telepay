import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Keypair} from '@solana/web3.js';
import {encrypt} from './crypto.mjs';
import {assertLaunchMint} from '../../lib/domain/launch-policy.ts';

export async function storeGeneratedMint({db,chain,config,secret}){
 const key=Keypair.fromSecretKey(secret),address=key.publicKey.toBase58();assertLaunchMint(address,config.suffix);
 if(await chain.connection.getAccountInfo(key.publicKey,'finalized'))throw new Error('Generated mint already exists');
 const result=await db.query('INSERT INTO mint_pool(address,secret_encrypted,suffix) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING address',[address,encrypt(secret,config.encryptionKey,`mint:${address}`),config.suffix]);
 return result.rowCount>0;
}
export function mintRefill({db,chain,config,log=console.log}){
 let job=null,child=null,stopping=false,nextAt=0;
 async function refill(){
  let dir;
  try{await db.transaction(async tx=>{
   const {rows:[lock]}=await tx.query('SELECT pg_try_advisory_xact_lock(78219343) AS locked');if(!lock.locked||stopping)return;
   const {rows:[pool]}=await tx.query("SELECT count(*)::int AS count FROM mint_pool WHERE status='ready' AND suffix=$1",[config.suffix]);if(pool.count>=config.vanityTarget)return;
   await chain.checkNetwork();dir=await mkdtemp(join(tmpdir(),'telepaid-mints-'));const path=join(dir,'candidate.hex');
   await new Promise((resolve,reject)=>{
    child=spawn(config.vanityBinary,[path,'1',String(config.vanityBudgetSeconds),'1'],{stdio:'ignore',env:{PATH:'/usr/bin:/bin'}});
    const timer=setTimeout(()=>child?.kill('SIGKILL'),(config.vanityBudgetSeconds+5)*1000);
    child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('close',code=>{clearTimeout(timer);child=null;if(code===0||code===1||stopping)resolve();else reject(new Error('Vanity process failed'))});
   });
   if(stopping)return;
   const bytes=await readFile(path);try{
    for(const line of bytes.toString('ascii').trim().split('\n').filter(Boolean)){
     if(!/^[0-9a-f]{128}$/.test(line))throw new Error('Invalid private candidate');
     const secret=Buffer.from(line,'hex');try{if(await storeGeneratedMint({db:tx,chain,config,secret}))log(JSON.stringify({event:'mint_pool_refilled',added:1}));}finally{secret.fill(0)}
    }
   }finally{bytes.fill(0)}
  });}finally{if(dir)await rm(dir,{recursive:true,force:true})}
 }
 return {
  kick(){if(!config.vanityAuto||job||stopping||Date.now()<nextAt)return;nextAt=Date.now()+config.vanityIntervalMs;job=refill().catch(()=>log(JSON.stringify({event:'mint_refill_retry'}))).finally(()=>{job=null});},
  async stop(){stopping=true;child?.kill('SIGTERM');await job;},
 };
}
