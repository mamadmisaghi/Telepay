import {randomUUID} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {configFromEnv} from './config.mjs';
import {database} from './db.mjs';
import {chainService,readKey} from './chain.mjs';
import {decrypt} from './crypto.mjs';
import {recordCollection,finishClaim} from './ledger.mjs';

export async function workerTick({db,config,chain}) {
 const {rows:launches}=await db.query("SELECT * FROM launches WHERE status='submitted' ORDER BY created_at LIMIT 50");
 for(const launch of launches){
  const state=await chain.status(launch.signature,launch.last_valid_height);
  if(state.state==='confirmed'){
   await chain.verifyMint(launch.mint,launch.creator);
   await db.transaction(async tx=>{await tx.query("UPDATE launches SET status='confirmed',confirmed_at=now() WHERE id=$1",[launch.id]);await tx.query("UPDATE mint_pool SET status='consumed' WHERE address=$1",[launch.mint]);});
  }else if(['failed','expired'].includes(state.state)){
   await db.transaction(async tx=>{await tx.query('UPDATE launches SET status=$2,error=$3 WHERE id=$1',[launch.id,state.state,'Transaction failed or expired']);await tx.query("UPDATE mint_pool SET status='quarantined' WHERE address=$1",[launch.mint]);});
  }else{try{await chain.send(launch.transaction_base64);}catch{}}
 }
 // An unsigned expired preparation is quarantined, never handed to another launch.
 if(config.rpcUrl){const height=await chain.connection.getBlockHeight('finalized');await db.query("UPDATE launches SET status='expired' WHERE status='prepared' AND last_valid_height<$1",[height]);}
 if(!config.operatorSecret||!config.treasurySecret)return;
 const operator=readKey(config.operatorSecret),treasury=readKey(config.treasurySecret);
 if(operator.publicKey.equals(treasury.publicKey))throw new Error('Use a separate gas payer so user liabilities never pay gas');
 const {rows:jobs}=await db.query("SELECT * FROM jobs WHERE status IN ('queued','submitted') ORDER BY created_at LIMIT 50");
 for(const job of jobs){
  if(job.status==='queued'&&job.kind==='claim'&&!config.payoutsEnabled)continue;
  if(job.status==='queued'&&job.kind!=='claim'&&!config.collectionsEnabled)continue;
  let current=job;
  const launch=job.launch_id?(await db.query('SELECT * FROM launches WHERE id=$1',[job.launch_id])).rows[0]:null;
  if(job.status==='queued'){
   let prepared;
   if(job.kind==='claim'){
    const claim=(await db.query('SELECT * FROM claims WHERE id=$1',[job.claim_id])).rows[0];
    const {rows:[liability]}=await db.query('SELECT COALESCE(sum(earned-settled),0)::text AS total FROM balances');
    await chain.liabilityCoverage(treasury.publicKey.toBase58(),BigInt(liability.total));
    prepared=await chain.transfer(treasury,claim.wallet,BigInt(claim.amount),operator);
   }else{
    const creator=Keypair.fromSecretKey(decrypt(launch.creator_secret,config.encryptionKey,`creator:${launch.id}`));
    prepared=job.kind==='collect'?await chain.collection(creator,operator):await chain.transfer(creator,treasury.publicKey.toBase58(),BigInt(job.amount),operator);
   }
   const signature=bs58.encode(prepared.tx.signatures[0]);
   await db.transaction(async tx=>{
    await tx.query("UPDATE jobs SET status='submitted',transaction_base64=$2,signature=$3,last_valid_height=$4 WHERE id=$1",[job.id,prepared.wire,signature,prepared.lastValidHeight]);
    if(job.claim_id)await tx.query("UPDATE claims SET status='submitted',signature=$2 WHERE id=$1",[job.claim_id,signature]);
   });current={...job,status:'submitted',transaction_base64:prepared.wire,signature,last_valid_height:prepared.lastValidHeight};
  }
  const state=await chain.status(current.signature,current.last_valid_height);
  if(state.state==='pending'){try{await chain.send(current.transaction_base64);}catch{}continue;}
  if(['failed','expired'].includes(state.state)){
   if(job.kind==='claim')await finishClaim(db,job.claim_id,{success:false,signature:current.signature});
   await db.query("UPDATE jobs SET status='failed',error=$2,completed_at=now() WHERE id=$1",[job.id,state.error||'Expired blockhash']);continue;
  }
  if(job.kind==='claim')await finishClaim(db,job.claim_id,{success:true,signature:current.signature});
  if(job.kind==='collect'){
   const collection=await chain.collectedFees(current.signature,launch.creator);
   await db.transaction(async tx=>{
    await tx.query("UPDATE jobs SET status='confirmed',amount=$2,completed_at=now() WHERE id=$1",[job.id,collection.lamports.toString()]);
    if(collection.lamports>0n)await tx.query("INSERT INTO jobs(id,kind,launch_id,amount) VALUES($1,'sweep',$2,$3) ON CONFLICT DO NOTHING",[`sweep:${job.id}`,launch.id,collection.lamports.toString()]);
   });continue;
  }
  if(job.kind==='sweep'){
   const receipt=await chain.receivedBy(current.signature,treasury.publicKey.toBase58());
   if(receipt.lamports!==BigInt(job.amount))throw new Error('Collection receipt does not match planned amount');
   await recordCollection(db,{eventId:job.id,launchId:launch.id,recipientHandle:launch.recipient_handle,signature:current.signature,lamports:receipt.lamports,slot:receipt.slot});
  }
  await db.query("UPDATE jobs SET status='confirmed',completed_at=now() WHERE id=$1",[job.id]);
 }
 if(config.collectionsEnabled){
  const {rows:eligible}=await db.query("SELECT l.* FROM launches l WHERE l.status='confirmed' AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.launch_id=l.id AND (j.status IN ('queued','submitted') OR j.kind='sweep' AND j.status='failed')) ORDER BY l.created_at LIMIT 100");
  for(const launch of eligible){const amount=await chain.sdk.getCreatorVaultBalanceBothPrograms(new (await import('@solana/web3.js')).PublicKey(launch.creator));if(BigInt(amount.toString())>=config.collectionThreshold)await db.query("INSERT INTO jobs(id,kind,launch_id) VALUES($1,'collect',$2) ON CONFLICT DO NOTHING",[randomUUID(),launch.id]);}
 }
 await db.query('DELETE FROM oauth_states WHERE expires_at<now()');await db.query('DELETE FROM wallet_challenges WHERE expires_at<now()');await db.query('DELETE FROM sessions WHERE expires_at<now()');
}
if(import.meta.url===`file://${process.argv[1]}`){
 const config=configFromEnv(),db=database(config.databaseUrl),chain=chainService(config);let stop=false;for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>{stop=true;});
 while(!stop){try{await db.workerLock(()=>workerTick({db,config,chain}));}catch(e){console.error(JSON.stringify({event:'worker_error',code:e.code||e.name}));}if(!stop)await new Promise(r=>setTimeout(r,10000));}await db.close();
}
