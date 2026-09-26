import {generateKeyPairSync} from 'node:crypto';
import {availableParallelism} from 'node:os';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {assertValidSuffix} from '../../lib/domain/launch-policy.ts';
import {configFromEnv} from './config.mjs';
import {database} from './db.mjs';
import {encrypt} from './crypto.mjs';

// Native Ed25519 CSPRNG. No vanity service ever receives private mint keys.
export function generateCandidate(suffix) {
 assertValidSuffix(suffix);
 const pair=generateKeyPairSync('ed25519');
 const pub=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32);
 const address=bs58.encode(pub);if(!address.endsWith(suffix))return null;
 const seed=pair.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32);
 const keypair=Keypair.fromSeed(seed);if(keypair.publicKey.toBase58()!==address)throw new Error('Generated key did not match');
 return {address,secret:keypair.secretKey};
}
if(!isMainThread&&workerData?.suffix){
 while(true){const result=generateCandidate(workerData.suffix);if(result)parentPort.postMessage(result);}
}else if(import.meta.url===`file://${process.argv[1]}`){
 const config=configFromEnv(),db=database(config.databaseUrl);if(!config.encryptionKey)throw new Error('KEY_ENCRYPTION_KEY is required');
 const count=async()=>Number((await db.query("SELECT count(*)::int AS count FROM mint_pool WHERE status='ready' AND suffix=$1",[config.suffix])).rows[0].count);
 const workers=[];let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;await Promise.all(workers.map(w=>w.terminate()));await db.close();};
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop());
 if(await count()>=config.vanityTarget){await db.close();process.exit(0);}
 const parallel=Math.max(1,Math.min(4,availableParallelism()-1));
 for(let i=0;i<parallel;i++){
  const worker=new Worker(new URL(import.meta.url),{workerData:{suffix:config.suffix}});workers.push(worker);
  worker.on('message',async result=>{
   if(stopping)return;
   try{await db.query('INSERT INTO mint_pool(address,secret_encrypted,suffix) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[result.address,encrypt(result.secret,config.encryptionKey,`mint:${result.address}`),config.suffix]);console.log(JSON.stringify({event:'mint_pool_added',ready:await count()}));if(await count()>=config.vanityTarget)await stop();}catch{console.error('Mint pool persistence failed');await stop();process.exitCode=1;}
  });
 }
}
