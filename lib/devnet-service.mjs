import {Keypair,PublicKey,TransactionMessage,VersionedTransaction,ComputeBudgetProgram} from '@solana/web3.js';
import {PUMP_SDK,getBuyTokenAmountFromSolAmount} from '@pump-fun/pump-sdk';
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import BN from 'bn.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {z} from 'zod';
import {chainService,readKey,signedMatches} from '../backend/src/chain.mjs';
import {digestPayload} from './devnet-proof.mjs';
import {nonceHash} from './telegram-bot.mjs';

const RPC='https://api.devnet.solana.com';
export const TEST_GROSS=1000000,TEST_RECIPIENT=800000,TEST_PROJECT=200000;
const walletSchema=z.string().refine(value=>{try{return PublicKey.isOnCurve(new PublicKey(value).toBytes())}catch{return false}},'Invalid Solana wallet');
const formSchema=z.object({wallet:walletSchema,requestId:z.string().uuid(),name:z.string().trim().min(2).max(32),symbol:z.string().regex(/^[A-Z0-9]{2,10}$/),description:z.string().max(1000).default(''),handle:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/).transform(v=>v.toLowerCase()),image:z.string().max(2800000),initialBuy:z.string().regex(/^\d+$/).refine(v=>BigInt(v)<=1000000000n,'Dev buy is limited to 1 Devnet SOL')});
const fail=(status,message)=>{throw Object.assign(new Error(message),{statusCode:status})};
const need=(condition,status,message)=>{if(!condition)fail(status,message)};
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const row=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const visibleTx=t=>t?{id:t.id,kind:t.kind,wallet:t.wallet,status:t.status,transaction:t.status==='prepared'?t.wire:undefined,signature:t.signature,amount:t.amount,error:t.error}:null;
function keys(env){
 const list=JSON.parse(env.DEVNET_MINT_KEYS||'[]').map(readKey);
 for(const key of list)need(key.publicKey.toBase58().endsWith('TeLe'),503,'Invalid test mint pool configuration');
 return list;
}
function imageBytes(data){
 const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data);
 need(match,400,'Upload a PNG, JPEG or WebP image');const bytes=Buffer.from(match[2],'base64');
 need(bytes.length>12&&bytes.length<=2*1024*1024,400,'Choose an image under 2 MB');
 const type=match[1],valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 need(valid,400,'Image content does not match its file type');return {bytes,type};
}
async function proof(db,body,action,origin){
 const payload=body.payload;need(payload&&typeof payload==='object',400,'Missing request details');
 const wallet=walletSchema.parse(payload.wallet),auth=body.proof||{};
 const challenge=await row(db,'SELECT * FROM sandbox_challenges WHERE id=?',String(auth.id||''));
 need(challenge&&challenge.wallet===wallet&&challenge.action===action&&challenge.digest===await digestPayload(payload)&&challenge.message.startsWith(origin+'\n')&&challenge.expires>Date.now()&&!challenge.used,401,'Request a fresh wallet signature and retry');
 let valid=false;try{valid=nacl.sign.detached.verify(new TextEncoder().encode(challenge.message),bs58.decode(auth.signature),new PublicKey(wallet).toBytes())}catch{}
 need(valid,401,'Wallet signature did not match');
 const used=await row(db,'UPDATE sandbox_challenges SET used=1 WHERE id=? AND used=0 AND expires>? RETURNING id',challenge.id,Date.now());
 need(used,409,'This wallet signature has already been used');return payload;
}
async function ownerLaunch(db,id,wallet){const item=await row(db,'SELECT * FROM sandbox_launches WHERE id=? AND wallet=?',id,wallet);need(item,404,'This test token belongs to another wallet or was not found');return item;}
async function transactionFor(db,id,kind){return row(db,'SELECT * FROM sandbox_transactions WHERE launch_id=? AND kind=?',id,kind)}

export function devnetService(env,{chain=chainService({rpcUrl:RPC,cluster:'devnet'})}={}){
 const db=env.DB,bucket=env.BUCKET;
 async function reconcile(tx){
  if(!tx||!tx.signature||!['submitted'].includes(tx.status))return tx;
  const result=await chain.status(tx.signature,tx.last_valid_height);
  if(result.state==='confirmed'){
   if(tx.kind==='create'){
    const launch=await row(db,'SELECT * FROM sandbox_launches WHERE id=?',tx.launch_id);
    await chain.verifyMint(new PublicKey(launch.mint),readKey(env.DEVNET_TREASURY_KEY).publicKey.toBase58());
   }
   await run(db,"UPDATE sandbox_transactions SET status='confirmed',error=NULL WHERE id=? AND status='submitted'",tx.id);
  }else if(result.state==='failed'||result.state==='expired'){
   await run(db,"UPDATE sandbox_transactions SET status='failed',error=? WHERE id=? AND status='submitted'",result.state==='expired'?'Transaction expired. Retry to prepare a fresh transaction.':'The Devnet transaction failed. Retry after checking your Devnet balance.',tx.id);
  }else if(tx.wire){try{await chain.send(tx.wire)}catch{/* Retry only the same persisted bytes. */}}
  return row(db,'SELECT * FROM sandbox_transactions WHERE id=?',tx.id);
 }
 async function prepareCreation(launch){
  let tx=await transactionFor(db,launch.id,'create');
  if(tx?.status==='submitted')return reconcile(tx);
  if(tx?.status==='confirmed')return tx;
  if(tx?.status==='prepared'&&await chain.connection.getBlockHeight('confirmed')<=tx.last_valid_height)return tx;
  const mint=keys(env).find(k=>k.publicKey.toBase58()===launch.mint);need(mint,503,'The test mint signer is unavailable');
  const prepared=await chain.prepareLaunch({mint:launch.mint,creator:readKey(env.DEVNET_TREASURY_KEY).publicKey.toBase58(),wallet:launch.wallet,name:launch.name,symbol:launch.symbol,uri:env.DEVNET_PUBLIC_ORIGIN+'/api/devnet/m/'+launch.id,initialBuy:0n});
  prepared.tx.sign([mint]);const wire=Buffer.from(prepared.tx.serialize()).toString('base64');
  await run(db,"UPDATE sandbox_transactions SET status='prepared',message=?,wire=?,last_valid_height=?,signature=NULL,error=NULL WHERE id=? AND status IN ('preparing','prepared','failed')",prepared.message,wire,prepared.lastValidHeight,tx.id);
  return row(db,'SELECT * FROM sandbox_transactions WHERE id=?',tx.id);
 }
 async function prepareBuy(launch){
  need(BigInt(launch.initial_buy)>0n,400,'No dev buy was requested');
  const created=await reconcile(await transactionFor(db,launch.id,'create'));need(created?.status==='confirmed',409,'Wait for token creation to finalize');
  let tx=await transactionFor(db,launch.id,'buy');if(tx?.status==='submitted')return reconcile(tx);if(tx?.status==='confirmed')return tx;
  if(tx?.status==='prepared'&&await chain.connection.getBlockHeight('confirmed')<=tx.last_valid_height)return tx;
  const mint=new PublicKey(launch.mint),user=new PublicKey(launch.wallet);
  await chain.checkNetwork();const [global,feeConfig,state,latest]=await Promise.all([chain.sdk.fetchGlobal(),chain.sdk.fetchFeeConfig(),chain.sdk.fetchBuyState(mint,user,TOKEN_2022_PROGRAM_ID),chain.connection.getLatestBlockhash('confirmed')]);
  const solAmount=new BN(launch.initial_buy),amount=getBuyTokenAmountFromSolAmount({global,feeConfig,mintSupply:global.tokenTotalSupply,bondingCurve:state.bondingCurve,amount:solAmount,quoteMint:PublicKey.default});
  const instructions=await PUMP_SDK.buyInstructions({global,...state,mint,user,amount,solAmount,slippage:1,tokenProgram:TOKEN_2022_PROGRAM_ID});
  const signed=new VersionedTransaction(new TransactionMessage({payerKey:user,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...instructions]}).compileToV0Message());
  const sim=await chain.connection.simulateTransaction(signed,{sigVerify:false,commitment:'confirmed'});need(!sim.value.err,422,'Dev buy simulation failed. Check your Devnet SOL balance');
  await run(db,"INSERT OR IGNORE INTO sandbox_transactions(id,launch_id,kind,wallet,status,created_at) VALUES(?,?,'buy',?,'preparing',?)",crypto.randomUUID(),launch.id,launch.wallet,Date.now());
  await run(db,"UPDATE sandbox_transactions SET status='prepared',message=?,wire=?,last_valid_height=?,signature=NULL,error=NULL WHERE launch_id=? AND kind='buy' AND status IN ('preparing','prepared','failed')",Buffer.from(signed.message.serialize()).toString('base64'),Buffer.from(signed.serialize()).toString('base64'),latest.lastValidBlockHeight,launch.id);
  return transactionFor(db,launch.id,'buy');
 }
 async function claim(launch,destination){
  need(launch.credited===1,409,'Add a test fee before claiming');
  let tx=await transactionFor(db,launch.id,'claim');
  if(tx&&['submitted','confirmed','preparing'].includes(tx.status)){
   need(tx.wallet===destination,409,'This allocation has already been claimed or reserved');
   if(tx.status==='submitted')return reconcile(tx);if(tx.status==='confirmed')return tx;
  }else{
   const verification=await row(db,'SELECT * FROM sandbox_telegram WHERE wallet=? AND handle=? AND verified_at>? AND consumed=0 ORDER BY verified_at DESC LIMIT 1',destination,launch.handle,Date.now()-120000);
   need(verification,403,'Verify the recipient Telegram username again before claiming');
   const id=crypto.randomUUID();
   const result=await db.batch([
    db.prepare("INSERT INTO sandbox_transactions(id,launch_id,kind,wallet,status,amount,created_at) SELECT ?,?,'claim',?,'preparing',?,? FROM sandbox_telegram WHERE nonce_hash=? AND consumed=0 AND verified_at>? ON CONFLICT(launch_id,kind) DO UPDATE SET id=excluded.id,wallet=excluded.wallet,status='preparing',wire=NULL,signature=NULL,message=NULL,error=NULL,created_at=excluded.created_at WHERE sandbox_transactions.status='failed' RETURNING id").bind(id,launch.id,destination,TEST_RECIPIENT,Date.now(),verification.nonce_hash,Date.now()-120000),
    db.prepare('UPDATE sandbox_telegram SET consumed=1 WHERE nonce_hash=? AND EXISTS(SELECT 1 FROM sandbox_transactions WHERE id=?)').bind(verification.nonce_hash,id)
   ]);
   need(result[0].results?.length,409,'This Telegram proof was already used. Verify again');
   tx=await transactionFor(db,launch.id,'claim');
  }
  if(!tx.wire){
   const treasury=readKey(env.DEVNET_TREASURY_KEY);
   const prepared=await chain.transfer(treasury,tx.wallet,BigInt(TEST_RECIPIENT),treasury);
   const simulation=await chain.connection.simulateTransaction(prepared.tx,{sigVerify:true,commitment:'confirmed'});need(!simulation.value.err,503,'Test payout funding is temporarily unavailable');
   const signature=bs58.encode(prepared.tx.signatures[0]);
   await run(db,"UPDATE sandbox_transactions SET status='submitted',message=?,wire=?,signature=?,last_valid_height=?,error=NULL WHERE id=? AND status='preparing' AND wire IS NULL",prepared.message,prepared.wire,signature,prepared.lastValidHeight,tx.id);
  }
  tx=await transactionFor(db,launch.id,'claim');
  if(tx.status==='submitted'){try{await chain.send(tx.wire)}catch{/* State already persisted. */}}
  return tx;
 }
 return async function handle(request){
  try{
   need(env.DEVNET_ENABLED==='true'&&db&&bucket&&env.DEVNET_TREASURY_KEY,503,'Devnet testing is not configured yet');
   need(env.DEVNET_PUBLIC_ORIGIN?.startsWith('https://'),503,'Test origin is not configured');
   const url=new URL(request.url),path=url.pathname.replace(/^\/api\/devnet\/?/,'');
   if(request.method==='GET'&&(path.startsWith('m/')||path.startsWith('image/'))){
    const id=path.split('/')[1];need(/^[a-f0-9]{20}$/.test(id),404,'Not found');
    const metadata=path.startsWith('m/'),object=await bucket.get('devnet/'+id+(metadata?'/metadata.json':'/image'));
    need(object,404,'Not found');return new Response(object.body,{headers:{'Content-Type':metadata?'application/json':object.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
   }
   if(request.method==='GET'&&path==='state'){
    const wallet=url.searchParams.get('wallet')||'';if(wallet)walletSchema.parse(wallet);
    const pending=await rows(db,"SELECT * FROM sandbox_transactions WHERE status='submitted' ORDER BY created_at LIMIT 16");
    let networkWarning='';
    for(const tx of pending){try{await reconcile(tx)}catch{networkWarning='Devnet is slow. Pending transactions will be checked again.'}}
    const launches=await rows(db,'SELECT * FROM sandbox_launches ORDER BY created_at DESC LIMIT 32');
    const txs=await rows(db,'SELECT * FROM sandbox_transactions');
    const tokens=launches.map(l=>({...l,transactions:txs.filter(t=>t.launch_id===l.id).map(visibleTx),image:env.DEVNET_PUBLIC_ORIGIN+'/api/devnet/image/'+l.id}));
    let balance=null;if(wallet)try{balance=await chain.connection.getBalance(new PublicKey(wallet),'confirmed')}catch{networkWarning='Devnet balance is temporarily unavailable.'}
    const available=keys(env).length-(await row(db,'SELECT count(*) AS count FROM sandbox_mints WHERE launch_id IS NOT NULL')).count;
    const verification=wallet?await row(db,'SELECT handle,verified_at,consumed FROM sandbox_telegram WHERE wallet=? AND verified_at IS NOT NULL ORDER BY verified_at DESC LIMIT 1',wallet):null;
    return json({network:'devnet',tokens,balance,readyMints:Math.max(0,available),networkWarning,testGross:TEST_GROSS,testRecipient:TEST_RECIPIENT,testProject:TEST_PROJECT,telegram:verification?{handle:verification.handle,expiresAt:verification.verified_at+120000,fresh:!verification.consumed&&verification.verified_at>Date.now()-120000}:null});
   }
   need(request.method==='POST',405,'Method not allowed');
   need(request.headers.get('origin')===url.origin,403,'Request origin did not match');
   const raw=await request.text();need(raw.length<=2900000,413,'Request is too large');let body;try{body=JSON.parse(raw)}catch{fail(400,'Invalid request')}
   if(path==='challenge'){
    const input=z.object({wallet:walletSchema,action:z.enum(['prepare','resume','buy','credit','claim','telegram']),digest:z.string().regex(/^[a-f0-9]{64}$/)}).parse(body);
    const recent=await row(db,'SELECT count(*) AS count FROM sandbox_challenges WHERE wallet=? AND expires>?',input.wallet,Date.now()-60000);need(recent.count<30,429,'Too many wallet requests. Wait a few minutes');
    const id=crypto.randomUUID(),expires=Date.now()+180000;
    const message=`${url.origin}\nTelePaid Devnet sandbox\nWallet: ${input.wallet}\nAction: ${input.action}\nRequest: ${input.digest}\nNonce: ${id}\nExpires: ${expires}\nTest network only. This does not verify Telegram ownership or authorize mainnet spending.`;
    await run(db,'INSERT INTO sandbox_challenges(id,wallet,action,digest,message,expires) VALUES(?,?,?,?,?,?)',id,input.wallet,input.action,input.digest,message,expires);
    await run(db,'DELETE FROM sandbox_challenges WHERE expires<?',Date.now()-3600000);
    return json({id,message});
   }
   if(path==='submit'){
    const input=z.object({id:z.string().uuid(),transaction:z.string().max(6000)}).parse(body);
    let tx=await row(db,'SELECT * FROM sandbox_transactions WHERE id=?',input.id);need(tx&&tx.kind!=='claim',404,'Launch transaction not found');
    if(['submitted','confirmed'].includes(tx.status))return json({transaction:visibleTx(await reconcile(tx))});
    need(tx.status==='prepared',409,'Prepare the transaction again');
    need(await chain.connection.getBlockHeight('confirmed')<=tx.last_valid_height,409,'The transaction expired. Prepare it again');
    const signed=signedMatches(input.transaction,tx.message,tx.wallet);
    if(tx.kind==='create'){
     const launch=await row(db,'SELECT * FROM sandbox_launches WHERE id=?',tx.launch_id),mint=keys(env).find(k=>k.publicKey.toBase58()===launch.mint);need(mint,503,'Mint signer unavailable');signed.sign([mint]);
    }
    const wire=Buffer.from(signed.serialize()).toString('base64'),signature=bs58.encode(signed.signatures[0]);
    await run(db,"UPDATE sandbox_transactions SET status='submitted',wire=?,signature=? WHERE id=? AND status='prepared'",wire,signature,tx.id);
    tx=await row(db,'SELECT * FROM sandbox_transactions WHERE id=?',tx.id);
    try{await chain.send(tx.wire)}catch{/* A lost send response is not a failed transaction. */}
    return json({transaction:visibleTx(tx)});
   }
   need(['prepare','resume','buy','credit','claim','telegram'].includes(path),404,'Not found');
   const payload=await proof(db,body,path,url.origin);
   if(path==='telegram'){
    need(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_BOT_USERNAME,503,'Telegram verification is awaiting configuration');
    const nonce=Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
    await run(db,'DELETE FROM sandbox_telegram WHERE wallet=? AND verified_at IS NULL',payload.wallet);
    await run(db,'INSERT INTO sandbox_telegram(nonce_hash,wallet,expires) VALUES(?,?,?)',await nonceHash(nonce),payload.wallet,Date.now()+600000);
    return json({url:'https://t.me/'+env.TELEGRAM_BOT_USERNAME+'?start='+nonce,expiresAt:Date.now()+600000});
   }
   if(path==='prepare'){
    const input=formSchema.parse(payload),image=imageBytes(input.image);
    let launch=await row(db,'SELECT * FROM sandbox_launches WHERE wallet=? AND request_id=?',input.wallet,input.requestId);
    if(!launch){
     const pool=keys(env);need(pool.length,503,'Test launch addresses are still being prepared');
     await db.batch(pool.map(key=>db.prepare('INSERT OR IGNORE INTO sandbox_mints(address) VALUES(?)').bind(key.publicKey.toBase58())));
     const id=crypto.randomUUID().replaceAll('-','').slice(0,20);
     await bucket.put('devnet/'+id+'/image',image.bytes,{httpMetadata:{contentType:image.type}});
     await bucket.put('devnet/'+id+'/metadata.json',JSON.stringify({name:input.name,symbol:input.symbol,description:input.description,image:env.DEVNET_PUBLIC_ORIGIN+'/api/devnet/image/'+id,external_url:env.DEVNET_PUBLIC_ORIGIN,properties:{network:'devnet',telegram_username:input.handle,telegram_verified:false}}),{httpMetadata:{contentType:'application/json'}});
     // D1 batch is transactional; a UNIQUE request failure rolls mint reservation back.
     try{await db.batch([
      db.prepare('UPDATE sandbox_mints SET launch_id=? WHERE address=(SELECT address FROM sandbox_mints WHERE launch_id IS NULL ORDER BY address LIMIT 1)').bind(id),
      db.prepare('INSERT INTO sandbox_launches(id,request_id,wallet,mint,name,symbol,description,handle,image_type,initial_buy,created_at) VALUES(?,?,?,(SELECT address FROM sandbox_mints WHERE launch_id=?),?,?,?,?,?,?,?)').bind(id,input.requestId,input.wallet,id,input.name,input.symbol,input.description,input.handle,image.type,input.initialBuy,Date.now()),
      db.prepare("INSERT INTO sandbox_transactions(id,launch_id,kind,wallet,status,created_at) VALUES(?,?,'create',?,'preparing',?)").bind(crypto.randomUUID(),id,input.wallet,Date.now())
     ])}catch{
      launch=await row(db,'SELECT * FROM sandbox_launches WHERE wallet=? AND request_id=?',input.wallet,input.requestId);
      if(!launch)fail(503,'The test mint pool is full. Please try again after it is refilled');
     }
     launch=launch||await row(db,'SELECT * FROM sandbox_launches WHERE id=?',id);
    }
    need(launch.name===input.name&&launch.symbol===input.symbol&&launch.handle===input.handle&&launch.initial_buy===input.initialBuy,409,'Use a new request for changed token details');
    return json({launch,transaction:visibleTx(await prepareCreation(launch))});
   }
   const input=z.object({wallet:walletSchema,id:z.string().regex(/^[a-f0-9]{20}$/)}).parse(payload);
   if(path==='claim'){
    const launch=await row(db,'SELECT * FROM sandbox_launches WHERE id=?',input.id);need(launch,404,'Token not found');
    return json({transaction:visibleTx(await claim(launch,input.wallet))});
   }
   const launch=await ownerLaunch(db,input.id,input.wallet);
   if(path==='resume')return json({transaction:visibleTx(await prepareCreation(launch))});
   if(path==='buy')return json({transaction:visibleTx(await prepareBuy(launch))});
   if(path==='credit'){
    const creation=await reconcile(await transactionFor(db,launch.id,'create'));need(creation?.status==='confirmed',409,'Wait for token creation to finalize');
    await run(db,'UPDATE sandbox_launches SET credited=1 WHERE id=? AND wallet=? AND credited=0',launch.id,input.wallet);
    return json({gross:TEST_GROSS,recipient:TEST_RECIPIENT,project:TEST_PROJECT,simulated:true});
   }
   fail(404,'Not found');
  }catch(error){
   const status=error.statusCode||(error.name==='ZodError'?400:503);
   if(status>=500)console.error('Devnet request failed',{type:error.name,code:error.code||'unavailable'});
   return json({error:error.name==='ZodError'?'Check the token details, image and wallet, then try again.':error.statusCode?error.message:'Solana Devnet is temporarily unavailable. Your saved test can be resumed.'},status);
  }
 };
}
