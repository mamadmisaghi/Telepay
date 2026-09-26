import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {testDb} from './d1-adapter.mjs';
import {devnetService} from '../lib/devnet-service.mjs';
import {telegramWebhook,nonceHash} from '../lib/telegram-bot.mjs';
import {digestPayload} from '../lib/devnet-proof.mjs';
const origin='https://example.test';
async function fixture(){
 const DB=testDb(),wallet=Keypair.generate(),other=Keypair.generate(),treasury=Keypair.generate(),id='1234567890abcdef1234';
 const env={DB,BUCKET:{put:async()=>{}},DEVNET_ENABLED:'true',DEVNET_PUBLIC_ORIGIN:origin,DEVNET_TREASURY_KEY:bs58.encode(treasury.secretKey),DEVNET_MINT_KEYS:'[]',TELEGRAM_BOT_TOKEN:'fixture-token',TELEGRAM_BOT_USERNAME:'TestBot',TELEGRAM_WEBHOOK_SECRET:'fixture-webhook-secret'};
 await DB.prepare('INSERT INTO sandbox_launches(id,request_id,wallet,mint,name,symbol,description,handle,image_type,initial_buy,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,crypto.randomUUID(),wallet.publicKey.toBase58(),Keypair.generate().publicKey.toBase58(),'Test','TEST','','hamoon','image/png','0',Date.now()).run();
 await DB.prepare("INSERT INTO sandbox_transactions(id,launch_id,kind,wallet,status,created_at) VALUES(?,?,'create',?,'confirmed',?)").bind(crypto.randomUUID(),id,wallet.publicKey.toBase58(),Date.now()).run();
 let sends=0;
 const chain={connection:{getBalance:async()=>10000000},checkNetwork:async()=>{},status:async()=>({state:'confirmed'}),send:async()=>{sends++},transfer:async(from,to,amount,payer)=>{const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:from.publicKey,toPubkey:new PublicKey(to),lamports:amount})]}).compileToV0Message());tx.sign([from]);return {tx,wire:Buffer.from(tx.serialize()).toString('base64'),message:Buffer.from(tx.message.serialize()).toString('base64'),lastValidHeight:100}},verifyMint:async()=>{}};
 chain.connection.simulateTransaction=async()=>({value:{err:null}});
 const service=devnetService(env,{chain});
 const request=(path,body,requestOrigin=origin)=>service(new Request(origin+'/api/devnet/'+path,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify(body)}));
 async function proofBody(action,payload,signer=wallet){const full={...payload,wallet:signer.publicKey.toBase58()},digest=await digestPayload(full),challenge=await(await request('challenge',{wallet:full.wallet,action,digest})).json();return {payload:full,proof:{id:challenge.id,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message),signer.secretKey))}};}
 const signed=async(action,payload,signer=wallet)=>request(action,await proofBody(action,payload,signer));
 async function verify(signer=wallet,handle='hamoon',idValue='123'){
  const {url}=await(await signed('telegram',{},signer)).json(),nonce=new URL(url).searchParams.get('start'),hash=await nonceHash(nonce),calls=[];
  const hook=update=>telegramWebhook(new Request(origin+'/api/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify(update)}),env,{call:async(method,body)=>{calls.push({method,body});return {}}});
  const update={callback_query:{id:'callback-1',data:'verify:'+nonce,from:{id:Number(idValue),username:handle},message:{message_id:1,chat:{id:Number(idValue),type:'private'}}}};
  await hook(update);return {nonce,hash,hook,update,calls};
 }
 return {DB,env,wallet,other,treasury,id,service,request,proofBody,signed,verify,sends:()=>sends()};
}

test('Devnet mutations reject cross-origin, forged, changed and replayed wallet proofs',async()=>{
 const f=await fixture();try{
  const body=await f.proofBody('credit',{id:f.id});
  assert.equal((await f.request('credit',body,'https://attacker.test')).status,403);
  assert.equal((await f.request('credit',{...body,payload:{...body.payload,id:'bad'}})).status,401);
  const forged=structuredClone(body);forged.proof.signature=bs58.encode(new Uint8Array(64));assert.equal((await f.request('credit',forged)).status,401);
  assert.equal((await f.request('credit',body)).status,200);assert.equal((await f.request('credit',body)).status,401);
  assert.equal((await f.DB.prepare('SELECT credited FROM sandbox_launches').first()).credited,1);
 }finally{f.DB.close()}
});
test('the creator wallet cannot claim until the exact Telegram recipient is freshly verified',async()=>{
 const f=await fixture();try{
  await f.signed('credit',{id:f.id});assert.equal((await f.signed('claim',{id:f.id})).status,403);
  await f.verify(f.wallet,'someone_else');assert.equal((await f.signed('claim',{id:f.id})).status,403);
  const verified=await f.verify();await f.DB.prepare('UPDATE sandbox_telegram SET verified_at=? WHERE nonce_hash=?').bind(Date.now()-130000,verified.hash).run();
  assert.equal((await f.signed('claim',{id:f.id})).status,403);
 }finally{f.DB.close()}
});
test('the current username owner can claim using a different wallet; retries preserve the same payout',async()=>{
 const f=await fixture();try{
  await f.signed('credit',{id:f.id});const proof=await f.verify(f.other,'Hamoon','456');
  const response=await f.signed('claim',{id:f.id},f.other);assert.equal(response.status,200);const a=await response.json();assert.equal(a.transaction.amount,800000);assert.equal(a.transaction.wallet,f.other.publicKey.toBase58());
  assert.equal((await f.DB.prepare('SELECT consumed FROM sandbox_telegram WHERE nonce_hash=?').bind(proof.hash).first()).consumed,1);
  const retry=await(await f.signed('claim',{id:f.id},f.other)).json();assert.equal(retry.transaction.signature,a.transaction.signature);
  assert.equal((await f.DB.prepare("SELECT count(*) AS count FROM sandbox_transactions WHERE kind='claim'").first()).count,1);
  assert.equal((await f.signed('claim',{id:f.id},f.wallet)).status,409);
 }finally{f.DB.close()}
});
test('Telegram webhook requires its secret, matches private sender, and never refreshes a replayed proof',async()=>{
 const f=await fixture();try{
  assert.equal((await telegramWebhook(new Request(origin,{method:'POST',body:'{}'}),f.env)).status,401);
  const proof=await f.verify();const first=await f.DB.prepare('SELECT verified_at FROM sandbox_telegram WHERE nonce_hash=?').bind(proof.hash).first();await proof.hook(proof.update);
  assert.equal((await f.DB.prepare('SELECT verified_at FROM sandbox_telegram WHERE nonce_hash=?').bind(proof.hash).first()).verified_at,first.verified_at);
  const {url}=await(await f.signed('telegram',{})).json(),nonce=new URL(url).searchParams.get('start');
  await proof.hook({callback_query:{id:'bad',data:'verify:'+nonce,from:{id:999,username:'hamoon'},message:{message_id:2,chat:{id:123,type:'private'}}}});
  assert.equal((await f.DB.prepare('SELECT verified_at FROM sandbox_telegram WHERE nonce_hash=?').bind(await nonceHash(nonce)).first()).verified_at,null);
 }finally{f.DB.close()}
});
test('state exposes no mint keys, bot secrets, claim bytes or treasury keys',async()=>{
 const f=await fixture();try{const response=await f.service(new Request(origin+'/api/devnet/state?wallet='+f.wallet.publicKey.toBase58()));assert.equal(response.status,200);const raw=await response.text();for(const secret of [f.env.TELEGRAM_BOT_TOKEN,f.env.TELEGRAM_WEBHOOK_SECRET,f.env.DEVNET_TREASURY_KEY])assert.ok(!raw.includes(secret));}finally{f.DB.close()}
});

test('a fresh Telegram proof cannot reserve two test claims concurrently',async()=>{
 const f=await fixture();try{
  await f.signed('credit',{id:f.id});const second='abcdef12345678901234';
  await f.DB.prepare('INSERT INTO sandbox_launches SELECT ?,?,wallet,?,name,symbol,description,handle,image_type,initial_buy,credited,created_at FROM sandbox_launches WHERE id=?').bind(second,crypto.randomUUID(),Keypair.generate().publicKey.toBase58(),f.id).run();
  await f.verify();const responses=await Promise.all([f.signed('claim',{id:f.id}),f.signed('claim',{id:second})]);
  assert.equal(responses.filter(r=>r.status===200).length,1);
  assert.equal((await f.DB.prepare("SELECT count(*) AS count FROM sandbox_transactions WHERE kind='claim'").first()).count,1);
 }finally{f.DB.close()}
});
