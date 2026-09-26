import {randomUUID} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {z} from 'zod';
import {assertLaunchMint} from '../../lib/domain/launch-policy.ts';
import {encrypt,decrypt} from './crypto.mjs';
import {feeSharingConfigPda} from '@pump-fun/pump-sdk';
import {PublicKey} from '@solana/web3.js';
import {readKey,signedMatches} from './chain.mjs';
import {saveMetadata,compactMetadata} from './metadata.mjs';
import {need} from './errors.mjs';
const url=z.string().max(200).refine(v=>!v||/^https:\/\/[^\s]+$/.test(v),'Use an HTTPS URL').default('');
const schema=z.object({name:z.string().trim().min(2).max(32),symbol:z.string().regex(/^[A-Z0-9]{2,10}$/),description:z.string().max(1000).default(''),recipient:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/),wallet:z.string().min(32).max(44),image:z.string().max(2800000),initialBuyLamports:z.string().regex(/^\d{1,12}$/).default('0'),website:url,telegram:url,twitter:url});
const publicLaunch=r=>({id:r.id,mint:r.mint,name:r.name,symbol:r.symbol,status:r.status,recipientHandle:r.recipient_handle,signature:r.signature,transaction:r.transaction_base64,lastValidHeight:r.last_valid_height,initialBuyLamports:r.initial_buy,launchFormat:r.launch_format,image:r.image_uri});
export function launchRoutes(app,{db,config,chain,resolveRecipient}){
 const prepareCreation=async(row,client=db)=>{
  const {rows:[mint]}=await client.query('SELECT secret_encrypted FROM mint_pool WHERE address=$1',[row.mint]);
  need(mint?.secret_encrypted,503,'Mint signer is unavailable');
  const uri=await compactMetadata(config,row.metadata_uri);
  await client.query('UPDATE launches SET metadata_uri=$2 WHERE id=$1',[row.id,uri]);
  return chain.prepareLaunch({mint:row.mint,creator:row.creator,wallet:row.wallet,name:row.name,symbol:row.symbol,uri,initialBuy:BigInt(row.initial_buy),encryptedMintSecret:mint.secret_encrypted,feeTreasury:row.fee_treasury});
 };
 app.post('/api/launches/prepare',async req=>{
  need(config.launchesEnabled,503,'Token launches are not enabled yet');need(config.encryptionKey&&config.rpcUrl,503,'Launch service is awaiting server configuration');
  const input=schema.parse(req.body),key=req.headers['idempotency-key'];need(typeof key==='string'&&key.length>=16&&key.length<=100,400,'A unique request key is required');
  const existing=await db.query('SELECT * FROM launches WHERE owner_id=$1 AND idempotency_key=$2',[req.session.user_id,key]);if(existing.rowCount)return publicLaunch(existing.rows[0]);
  if(req.launcher){need(req.launcher.address===input.wallet,403,'Connected wallet does not match');}else {const wallet=await db.query('SELECT address FROM wallets WHERE user_id=$1 AND address=$2 AND verification_session_hash=$3',[req.session.user_id,input.wallet,req.session.token_hash]);need(wallet.rowCount,403,'Verify your wallet first');}
  const open=await db.query("SELECT count(*)::int AS total FROM launches WHERE owner_id=$1 AND status IN ('preparing','prepared','submitted')",[req.session.user_id]);need(open.rows[0].total<3,429,'Finish an existing launch before preparing another');
  need(Buffer.byteLength(input.name,'utf8')<=32,400,'Token name must fit within 32 UTF-8 bytes');
  const recipient=await resolveRecipient(input.recipient.toLowerCase());
  need(recipient?.status==='found',422,'Telegram profile could not be confirmed. Select a confirmed profile before launching');
  const metadata=await saveMetadata(config,input);const id=randomUUID(),creator=Keypair.generate();
  const treasury=config.feeSharingEnabled?readKey(config.treasurySecret).publicKey.toBase58():null;
  const launch=await db.transaction(async tx=>{
   const {rows:[mint]}=await tx.query("SELECT * FROM mint_pool WHERE status='ready' AND suffix=$1 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",[config.suffix]);need(mint,503,'New launch addresses are being prepared. Please try again shortly');assertLaunchMint(mint.address,config.suffix);
   await tx.query("UPDATE mint_pool SET status='reserved' WHERE address=$1",[mint.address]);
   const {rows:[row]}=await tx.query('INSERT INTO launches(id,idempotency_key,owner_id,recipient_handle,wallet,mint,creator,creator_secret,name,symbol,description,metadata_uri,image_uri,initial_buy,fee_mode,fee_treasury) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',[id,key,req.session.user_id,input.recipient.toLowerCase(),input.wallet,mint.address,treasury?feeSharingConfigPda(new PublicKey(mint.address)).toBase58():creator.publicKey.toBase58(),treasury?'':encrypt(creator.secretKey,config.encryptionKey,`creator:${id}`),input.name,input.symbol,input.description,metadata.uri,metadata.image,input.initialBuyLamports,treasury?'sharing-v1':'legacy',treasury]);return row;
  });
  try{
   const prepared=await prepareCreation(launch);
   const {rows:[row]}=await db.query("UPDATE launches SET status='prepared',launch_format='atomic-v1',message_base64=$2,transaction_base64=$3,last_valid_height=$4 WHERE id=$1 RETURNING *",[id,prepared.message,prepared.wire,prepared.lastValidHeight]);
   return {...publicLaunch(row),networkFeeLamports:prepared.networkFeeLamports};
  }catch(error){await db.query("UPDATE launches SET status='failed',error='Preparation failed; mint quarantined' WHERE id=$1",[id]);await db.query("UPDATE mint_pool SET status='quarantined' WHERE address=$1",[launch.mint]);throw error;}
 });
 app.post('/api/launches/:id/submit',async req=>{
  need(config.launchesEnabled,503,'Token launches are paused');need(typeof req.body?.transaction==='string'&&req.body.transaction.length<5000,400,'Invalid signed transaction');
  const launch=await db.transaction(async tx=>{
   const {rows:[row]}=await tx.query('SELECT * FROM launches WHERE id=$1 AND owner_id=$2 FOR UPDATE',[req.params.id,req.session.user_id]);need(row,404,'Launch not found');
   if(row.status==='submitted'||row.status==='confirmed')return row;
   need(row.status==='prepared',409,'Prepare a new launch');
   need(row.launch_format==='atomic-v1',409,'Refresh this launch transaction before signing. Old launch quotes are no longer accepted');
   need(await chain.connection.getBlockHeight('confirmed')<=Number(row.last_valid_height),409,'Launch quote expired. Prepare a new launch');
   assertLaunchMint(row.mint,config.suffix);const transaction=signedMatches(req.body.transaction,row.message_base64,row.wallet);
   const {rows:[mint]}=await tx.query('SELECT secret_encrypted FROM mint_pool WHERE address=$1',[row.mint]);const signer=Keypair.fromSecretKey(decrypt(mint.secret_encrypted,config.encryptionKey,`mint:${row.mint}`));
   need(signer.publicKey.toBase58()===row.mint,500,'Mint signer mismatch');transaction.sign([signer]);
   const wire=Buffer.from(transaction.serialize()).toString('base64'),signature=bs58.encode(transaction.signatures[0]);
   const {rows:[updated]}=await tx.query("UPDATE launches SET status='submitted',transaction_base64=$2,signature=$3 WHERE id=$1 RETURNING *",[row.id,wire,signature]);return updated;
  });
  // Signed bytes and signature are durable before RPC. A timeout cannot produce a new mint.
  if(launch.status==='submitted'){try{await chain.send(launch.transaction_base64);}catch{/* worker reconciles this exact signature */}}
  return publicLaunch(launch);
 });
 app.post('/api/launches/:id/refresh',async req=>{
  need(config.launchesEnabled,503,'Token launches are paused');
  return db.transaction(async tx=>{
   const {rows:[row]}=await tx.query('SELECT * FROM launches WHERE id=$1 AND owner_id=$2 FOR UPDATE',[req.params.id,req.session.user_id]);need(row,404,'Launch not found');
   // A submitted signature must be reconciled before any new transaction is prepared.
   need(['prepared','expired','failed'].includes(row.status),409,'Wait for the existing transaction to finish');
   if(row.signature){const status=await chain.status(row.signature,row.last_valid_height);need(['failed','expired'].includes(status.state),409,'Existing launch is still pending');}
   need((await resolveRecipient(row.recipient_handle))?.status==='found',422,'Telegram profile could not be confirmed. Retry the profile lookup before refreshing');
   const p=await prepareCreation(row,tx);
   const {rows:[updated]}=await tx.query("UPDATE launches SET status='prepared',launch_format='atomic-v1',message_base64=$2,transaction_base64=$3,last_valid_height=$4,signature=NULL,error=NULL WHERE id=$1 RETURNING *",[row.id,p.message,p.wire,p.lastValidHeight]);
   await tx.query("UPDATE mint_pool SET status='reserved' WHERE address=$1",[row.mint]);return publicLaunch(updated);
  });
 });
 // Reconcile previously submitted buys in the worker, but never create new split launches.
 for(const action of ['prepare','submit'])app.post(`/api/launches/:id/buy/${action}`,async()=>{need(false,410,'Initial buy is now included in the launch transaction. Separate initial buys are no longer supported');});
 app.get('/api/launches',async req=>{const {rows}=await db.query('SELECT * FROM launches WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 20',[req.session.user_id]);return {launches:rows.map(publicLaunch)};});
 app.get('/api/launches/:id',async req=>{const {rows:[row]}=await db.query('SELECT * FROM launches WHERE id=$1 AND owner_id=$2',[req.params.id,req.session.user_id]);need(row,404,'Launch not found');const buy=(await db.query('SELECT * FROM launch_buys WHERE launch_id=$1',[row.id])).rows[0];return {...publicLaunch(row),buy:buy?buyView(buy):null};});
}
const buyView=r=>({status:r.status,transaction:r.transaction_base64,signature:r.signature,lastValidHeight:r.last_valid_height});
