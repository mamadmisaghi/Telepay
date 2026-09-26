import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {Keypair,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {buildApp} from '../src/app.mjs';
import {configFromEnv} from '../src/config.mjs';
import {hash,encrypt,decrypt} from '../src/crypto.mjs';
import {reserveClaim,recordCollection,finishClaim} from '../src/ledger.mjs';
import {signedMatches} from '../src/chain.mjs';
import {workerTick} from '../src/worker.mjs';

async function fixture(){
 const pg=new PGlite();await pg.exec(await readFile(new URL('../migrations/001_core.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../migrations/002_bot_and_buys.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../migrations/003_atomic_market.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../migrations/004_sharing_analytics.sql',import.meta.url),'utf8'));
 const adapt=client=>({query:async(sql,args)=>{if(sql.startsWith('SELECT pg_'))return {rows:[],rowCount:1};const r=await client.query(sql,args);return {...r,rowCount:Math.max(r.affectedRows||0,r.rows.length)};}});
 const db={...adapt(pg),transaction:fn=>pg.transaction(tx=>fn(adapt(tx))),close:()=>pg.close()};
 const config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8080',TELEGRAM_CLIENT_ID:'123',TELEGRAM_CLIENT_SECRET:'test-secret',PAYOUTS_ENABLED:'true',KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')});
 const wallet=Keypair.generate();
 await db.query("INSERT INTO users(id,username,display_name) VALUES('1','hamoon','Original owner'),('2','hamoon','New owner')");
 for(const id of ['1','2'])await db.query('INSERT INTO sessions(token_hash,user_id,csrf,verified_handle,expires_at) VALUES($1,$2,$3,$4,now()+interval \'1 hour\')',[hash('session'+id),id,'csrf'+id,'hamoon']);
 await db.query('INSERT INTO wallets(address,user_id,verification_session_hash) VALUES($1,$2,$3)',[wallet.publicKey.toBase58(),'2',hash('session2')]);
 const mint=Keypair.generate().publicKey.toBase58();await db.query('INSERT INTO mint_pool(address,secret_encrypted,suffix,status) VALUES($1,$2,$3,$4)',[mint,'test','TeLe','consumed']);
 await db.query("INSERT INTO launches(id,idempotency_key,owner_id,recipient_handle,wallet,mint,creator,creator_secret,name,symbol,description,metadata_uri,image_uri,status,confirmed_at) VALUES('launch1','launch-key','1','hamoon',$1,$2,$3,'encrypted','Token','TOK','description','https://example.test/token.json','https://example.test/token.png','confirmed',now())",[wallet.publicKey.toBase58(),mint,Keypair.generate().publicKey.toBase58()]);
 return {pg,db,config,wallet};
}

test('fee events are idempotent; exact 80/20 is credited to the handle, not the creator or original account ID',async()=>{
 const f=await fixture();try{
  const event={eventId:'event1',launchId:'launch1',recipientHandle:'Hamoon',signature:'sig1',lamports:10000000001n,slot:1};
  assert.equal(await recordCollection(f.db,event),true);assert.equal(await recordCollection(f.db,event),false);
  const {rows:[b]}=await f.db.query('SELECT * FROM balances');assert.equal(b.handle,'hamoon');assert.equal(b.earned,'8000000000');
  const {rows:[e]}=await f.db.query('SELECT * FROM fee_events');assert.equal(e.project,'2000000001');
 }finally{await f.db.close();}
});
test('new current username owner can claim old funds; stale proof, duplicate withdrawal and insufficient balance are blocked',async()=>{
 const f=await fixture();try{
  await f.db.query("INSERT INTO balances(handle,earned) VALUES('hamoon',8000000)");
  await f.db.query("UPDATE sessions SET created_at=now()-interval '3 minutes' WHERE user_id='1'");
  await assert.rejects(reserveClaim(f.db,{userId:'1',handle:'hamoon',wallet:f.wallet.publicKey.toBase58(),amount:1000000n,idempotencyKey:'old-key',minimum:1n,sessionHash:hash('session1')}),/Verify your current/);
  const args={userId:'2',handle:'hamoon',wallet:f.wallet.publicKey.toBase58(),amount:5000000n,idempotencyKey:'same-key',minimum:1n,sessionHash:hash('session2')};
  const result=await reserveClaim(f.db,args);assert.equal(result.handle,'hamoon');assert.equal((await reserveClaim(f.db,args)).id,result.id);
  await assert.rejects(reserveClaim(f.db,{...args,idempotencyKey:'second'}),/Verify your current/);
  await finishClaim(f.db,result.id,{success:true,signature:'payment1'});await finishClaim(f.db,result.id,{success:true,signature:'payment1'});
  const {rows:[b]}=await f.db.query('SELECT * FROM balances');assert.equal(b.settled,'5000000');assert.equal(b.reserved,'0');
 }finally{await f.db.close();}
});
test('concurrent claims cannot reserve the same balance; failure releases it once',async()=>{
 const f=await fixture();try{
  await f.db.query("INSERT INTO balances(handle,earned) VALUES('hamoon',8000000)");
  const args={userId:'2',handle:'hamoon',wallet:f.wallet.publicKey.toBase58(),amount:7000000n,minimum:1n,sessionHash:hash('session2')};
  const results=await Promise.allSettled(['key-a','key-b'].map(idempotencyKey=>reserveClaim(f.db,{...args,idempotencyKey})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const claim=results.find(r=>r.status==='fulfilled').value;
  await finishClaim(f.db,claim.id,{success:false,signature:'failed1'});await finishClaim(f.db,claim.id,{success:false,signature:'failed1'});
  const {rows:[b]}=await f.db.query('SELECT * FROM balances');assert.equal(b.reserved,'0');assert.equal(b.settled,'0');
 }finally{await f.db.close();}
});
test('API rejects anonymous writes, wrong origin and CSRF; wallet signatures are single-use',async()=>{
 const f=await fixture();const app=await buildApp({...f,chain:{}});try{
  assert.equal((await app.inject({method:'POST',url:'/api/wallet/challenge',payload:{}})).statusCode,401);
  const headers={cookie:'tp_session=session2',origin:f.config.origin,'x-csrf-token':'csrf2'};
  assert.equal((await app.inject({method:'POST',url:'/api/wallet/challenge',headers:{...headers,origin:'https://evil.test'},payload:{}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/wallet/challenge',headers:{...headers,'x-csrf-token':'wrong'},payload:{}})).statusCode,403);
  const challenge=await app.inject({method:'POST',url:'/api/wallet/challenge',headers,payload:{address:f.wallet.publicKey.toBase58()}});assert.equal(challenge.statusCode,200,challenge.body);
  const body=challenge.json(),signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(body.message),f.wallet.secretKey));
  const request={method:'POST',url:'/api/wallet/verify',headers,payload:{id:body.id,signature}};
  assert.equal((await app.inject(request)).statusCode,200);assert.equal((await app.inject(request)).statusCode,401);
  const session=(await app.inject({url:'/api/session',headers})).json();assert.equal(session.user.username,'hamoon');
 }finally{await app.close();await f.db.close();}
});
test('Telegram callback requires browser-bound state, consumes it once and stores a verified handle',async()=>{
 const f=await fixture();const app=await buildApp({...f,chain:{},fetcher:async()=>({ok:true,json:async()=>({id_token:'provider-signed-token'})}),verifyIdentity:async(token,c,nonce)=>{assert.ok(nonce);return {id:'3',sub:'oidc-3',username:'HaMoon',name:'Current owner'};}});
 try{
  const start=await app.inject('/api/auth/telegram');assert.equal(start.statusCode,302);const auth=new URL(start.headers.location);assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('scope'),'openid profile');
  const state=auth.searchParams.get('state'),binding=start.cookies.find(c=>c.name==='tp_login').value;
  const url='/api/auth/telegram/callback?state='+state+'&code=code';
  assert.equal((await app.inject(url)).statusCode,400);
  const completed=await app.inject({url,headers:{cookie:'tp_login='+binding}});assert.equal(completed.statusCode,302,completed.body);
  assert.equal((await app.inject({url,headers:{cookie:'tp_login='+binding}})).statusCode,401);
  const cookie=completed.cookies.find(c=>c.name==='tp_session');const session=(await app.inject({url:'/api/session',headers:{cookie:'tp_session='+cookie.value}})).json();assert.equal(session.user.username,'hamoon');assert.equal(session.claimVerificationFresh,true);
 }finally{await app.close();await f.db.close();}
});
test('mint signing accepts only the exact prepared message and authenticated wallet signature',()=>{
 const payer=Keypair.generate(),other=Keypair.generate(),blockhash=Keypair.generate().publicKey.toBase58();
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,instructions:[SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:other.publicKey,lamports:1})]}).compileToV0Message());
 const message=Buffer.from(tx.message.serialize()).toString('base64');
 assert.throws(()=>signedMatches(Buffer.from(tx.serialize()).toString('base64'),message,payer.publicKey.toBase58()),/invalid/);
 tx.sign([payer]);assert.ok(signedMatches(Buffer.from(tx.serialize()).toString('base64'),message,payer.publicKey.toBase58()));
 assert.throws(()=>signedMatches(Buffer.from(tx.serialize()).toString('base64'),'different',payer.publicKey.toBase58()),/changed/);
});
test('mint secrets authenticate their context and exact TeLe policy cannot be disabled',()=>{
 const key=Buffer.alloc(32,9).toString('base64'),sealed=encrypt(Buffer.from('secret'),key,'mint:A');
 assert.equal(decrypt(sealed,key,'mint:A').toString(),'secret');assert.throws(()=>decrypt(sealed,key,'mint:B'));
 assert.equal(configFromEnv({}).suffix,'TeLe');assert.throws(()=>configFromEnv({MINT_SUFFIX:'Tele'}));assert.throws(()=>configFromEnv({MINT_SUFFIX:'pump'}));
});
test('worker reconciles a persisted transaction after timeout without creating a second payment',async()=>{
 const f=await fixture();try{
  const treasury=Keypair.generate(),operator=Keypair.generate();f.config.treasurySecret=bs58.encode(treasury.secretKey);f.config.operatorSecret=bs58.encode(operator.secretKey);
  await f.db.query("INSERT INTO balances(handle,earned) VALUES('hamoon',9000000)");
  const claim=await reserveClaim(f.db,{userId:'2',handle:'hamoon',wallet:f.wallet.publicKey.toBase58(),amount:3000000n,idempotencyKey:'worker-key',minimum:1n,sessionHash:hash('session2')});
  let finalized=false,builds=0,sends=0;const chain={liabilityCoverage:async()=>{},transfer:async()=>{builds++;return {tx:{signatures:[new Uint8Array(64).fill(2)]},wire:'stored-wire',lastValidHeight:100};},status:async()=>({state:finalized?'confirmed':'pending'}),send:async wire=>{assert.equal(wire,'stored-wire');sends++;throw new Error('timeout');}};
  await workerTick({db:f.db,config:f.config,chain});await workerTick({db:f.db,config:f.config,chain});assert.equal(builds,1);assert.equal(sends,2);
  finalized=true;await workerTick({db:f.db,config:f.config,chain});const {rows:[result]}=await f.db.query('SELECT status FROM claims WHERE id=$1',[claim.id]);assert.equal(result.status,'confirmed');
  const {rows:[b]}=await f.db.query('SELECT * FROM balances');assert.equal(b.settled,'3000000');assert.equal(b.reserved,'0');
 }finally{await f.db.close();}
});

test('Telegram JWT verifier rejects forged signature, wrong audience, expired tokens and wrong nonce',async()=>{
 const {generateKeyPair,SignJWT}=await import('jose');const {verifyTelegram}=await import('../src/auth.mjs');
 const {publicKey,privateKey}=await generateKeyPair('RS256');const wrong=await generateKeyPair('RS256');
 const sign=(audience='123',expires='2m',signer=privateKey)=>new SignJWT({id:12345,preferred_username:'hamoon',name:'Hamoon',nonce:'expected'}).setProtectedHeader({alg:'RS256'}).setIssuer('https://oauth.telegram.org').setAudience(audience).setSubject('sub-12345').setIssuedAt().setExpirationTime(expires).sign(signer);
 assert.equal((await verifyTelegram(await sign(),{telegramClientId:'123'},'expected',publicKey)).username,'hamoon');
 await assert.rejects(verifyTelegram(await sign('wrong'),{telegramClientId:'123'},'expected',publicKey));
 await assert.rejects(verifyTelegram(await sign('123','-1m'),{telegramClientId:'123'},'expected',publicKey));
 await assert.rejects(verifyTelegram(await sign('123','2m',wrong.privateKey),{telegramClientId:'123'},'expected',publicKey));
 await assert.rejects(verifyTelegram(await sign(),{telegramClientId:'123'},'different',publicKey));
});
test('official Pump create instruction builds with the intended mint, payer and dedicated creator',async()=>{
 const {PUMP_SDK,PUMP_PROGRAM_ID}=await import('@pump-fun/pump-sdk');
 const mint=Keypair.generate().publicKey,creator=Keypair.generate().publicKey,user=Keypair.generate().publicKey;
 const ix=await PUMP_SDK.createV2Instruction({mint,creator,user,name:'Test',symbol:'TEST',uri:'https://example.test/meta.json',mayhemMode:false,holderReward:false});
 assert.equal(ix.programId.toBase58(),PUMP_PROGRAM_ID.toBase58());assert.ok(ix.keys.some(k=>k.pubkey.equals(mint)&&k.isSigner));assert.ok(ix.keys.some(k=>k.pubkey.equals(user)&&k.isSigner));assert.ok(Buffer.from(ix.data).includes(Buffer.from(creator.toBytes())));
});
test('launch preparation uses the selected handle, compact metadata and requested atomic buy amount',async()=>{
 const f=await fixture();const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'telepaid-meta-'));f.config.metadataDir=dir;f.config.launchesEnabled=true;f.config.rpcUrl='http://test.invalid';
 const address='A'.repeat(40)+'TeLe';await f.db.query('INSERT INTO mint_pool(address,secret_encrypted,suffix) VALUES($1,$2,$3)',[address,'encrypted-test-only','TeLe']);
 let calls=0;const chain={prepareLaunch:async args=>{calls++;assert.equal(args.mint,address);assert.equal(args.encryptedMintSecret,'encrypted-test-only');assert.equal(args.initialBuy,1000000n);assert.match(args.uri,/\/api\/m\/[\w-]{22}$/);return {message:'message',wire:'wire',lastValidHeight:100,networkFeeLamports:'5000'};}};
 const app=await buildApp({...f,chain,fetcher:async()=>({ok:true,text:async()=>'<div class="tgme_page_title">Someone</div><div class="tgme_page_extra">@someoneelse</div><a>Send Message</a>'})});try{
  const request={method:'POST',url:'/api/launches/prepare',headers:{cookie:'tp_session=session2',origin:f.config.origin,'x-csrf-token':'csrf2','idempotency-key':'launch-replay-test-1'},payload:{name:'Hamoon coin',symbol:'HAM',recipient:'SomeoneElse',wallet:f.wallet.publicKey.toBase58(),image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEZkAAAAASUVORK5CYII=',initialBuyLamports:'1000000'}};
  const rejected=await app.inject({...request,payload:{...request.payload,recipient:'unknownuser'}});assert.equal(rejected.statusCode,422);assert.equal(calls,0);
  const result=await app.inject(request);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().recipientHandle,'someoneelse');assert.equal(result.json().mint,address);
  assert.equal((await app.inject(request)).json().id,result.json().id);assert.equal(calls,1);assert.equal(result.json().launchFormat,'atomic-v1');
  const row=(await f.db.query('SELECT * FROM launches WHERE id=$1',[result.json().id])).rows[0];
  const metadata=await app.inject(new URL(row.metadata_uri).pathname);assert.equal(metadata.statusCode,200);assert.equal(metadata.json().extensions.telepaid.recipient,'someoneelse');
  assert.match(metadata.headers['cache-control'],/immutable/);
  await f.db.query("UPDATE launches SET launch_format='legacy' WHERE id=$1",[row.id]);
  const outdated=await app.inject({method:'POST',url:`/api/launches/${row.id}/submit`,headers:request.headers,payload:{transaction:'invalid'}});assert.equal(outdated.statusCode,409);assert.match(outdated.json().error,/Refresh/);
  const refresh=await app.inject({method:'POST',url:`/api/launches/${result.json().id}/refresh`,headers:request.headers,payload:{}});assert.equal(refresh.statusCode,200,refresh.body);assert.equal(refresh.json().mint,address);assert.equal(calls,2);
  const {rows:[pool]}=await f.db.query('SELECT status FROM mint_pool WHERE address=$1',[address]);assert.equal(pool.status,'reserved');
  const users=await f.db.query("SELECT id FROM users WHERE username='someoneelse'");assert.equal(users.rowCount,0);
 }finally{await app.close();await f.db.close();await rm(dir,{recursive:true,force:true});}
});

test('collection accounting excludes rent refunds and counts both native and wrapped SOL vault outflows',async()=>{
 const {chainService}=await import('../src/chain.mjs');const {creatorVaultPda}=await import('@pump-fun/pump-sdk');const {coinCreatorVaultAtaPda,coinCreatorVaultAuthorityPda}=await import('@pump-fun/pump-swap-sdk');const {NATIVE_MINT,TOKEN_PROGRAM_ID}=await import('@solana/spl-token');
 const creator=Keypair.generate().publicKey,service=chainService(configFromEnv({}));
 const keys=[creatorVaultPda(creator),coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(creator),NATIVE_MINT,TOKEN_PROGRAM_ID),creator];
 service.connection.getTransaction=async()=>({slot:50,transaction:{message:{getAccountKeys:()=>({length:keys.length,get:i=>keys[i]})}},meta:{err:null,loadedAddresses:{writable:[],readonly:[]},preBalances:[1001000,3000000,0],postBalances:[1000,3000000,6000000],preTokenBalances:[{accountIndex:1,uiTokenAmount:{amount:'2000000'}}],postTokenBalances:[{accountIndex:1,uiTokenAmount:{amount:'0'}}]}});
 const receipt=await service.collectedFees('signature',creator.toBase58());assert.equal(receipt.lamports,3000000n);assert.equal(receipt.slot,50);
});

test('nonfinal transaction errors stay pending; only finalized failure releases funds',async()=>{
 const {chainService}=await import('../src/chain.mjs');const service=chainService(configFromEnv({SOLANA_RPC_URL:'https://rpc.example',SOLANA_CLUSTER:'mainnet-beta'}));
 service.connection.getGenesisHash=async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
 let result={confirmationStatus:'confirmed',err:{InstructionError:[0,'Custom']}};
 service.connection.getSignatureStatuses=async()=>({value:[result]});
 assert.equal((await service.status('sig',10)).state,'pending');
 result={...result,confirmationStatus:'finalized'};assert.equal((await service.status('sig',10)).state,'failed');
 result={confirmationStatus:'finalized',err:null,slot:100};assert.equal((await service.status('sig',10)).state,'confirmed');
});

test('pausing payouts blocks queued jobs but still reconciles a previously submitted claim',async()=>{
 const f=await fixture();try{
  f.config.payoutsEnabled=false;f.config.treasurySecret=bs58.encode(Keypair.generate().secretKey);f.config.operatorSecret=bs58.encode(Keypair.generate().secretKey);
  await f.db.query("INSERT INTO balances(handle,earned) VALUES('hamoon',9000000)");
  const claim=await reserveClaim(f.db,{userId:'2',handle:'hamoon',wallet:f.wallet.publicKey.toBase58(),amount:3000000n,idempotencyKey:'paused-key',minimum:1n,sessionHash:hash('session2')});
  let checks=0;const chain={status:async()=>{checks++;return {state:'confirmed'}}};
  await workerTick({db:f.db,config:f.config,chain});assert.equal(checks,0);
  await f.db.query("UPDATE jobs SET status='submitted',signature='pending-signature',last_valid_height=100 WHERE claim_id=$1",[claim.id]);
  await workerTick({db:f.db,config:f.config,chain});assert.equal(checks,1);
  assert.equal((await f.db.query('SELECT status FROM claims WHERE id=$1',[claim.id])).rows[0].status,'confirmed');
  assert.equal((await f.db.query('SELECT settled FROM balances')).rows[0].settled,'3000000');
 }finally{await f.db.close()}
});

test('wrong handle, unverified destination and insufficient funds roll back without consuming fresh proof',async()=>{
 const f=await fixture();try{
  await f.db.query("INSERT INTO balances(handle,earned) VALUES('hamoon',8000000),('another',9000000)");
  const args={userId:'2',handle:'hamoon',wallet:f.wallet.publicKey.toBase58(),amount:1000000n,idempotencyKey:'proof-key',minimum:1n,sessionHash:hash('session2')};
  await assert.rejects(reserveClaim(f.db,{...args,handle:'another'}),/Verify your current/);
  await assert.rejects(reserveClaim(f.db,{...args,wallet:Keypair.generate().publicKey.toBase58()}),/Verify this wallet/);
  await assert.rejects(reserveClaim(f.db,{...args,amount:9000000n}),/Insufficient/);
  const claim=await reserveClaim(f.db,args);assert.equal(claim.amount,'1000000');
  await assert.rejects(reserveClaim(f.db,{...args,amount:2000000n}),/different claim/);
 }finally{await f.db.close()}
});

test('public endpoints hide secrets; launch and claim switches fail closed; logout invalidates the session',async()=>{
 const f=await fixture();f.config.launchesEnabled=false;f.config.payoutsEnabled=false;f.config.privyAppId='public-app-id';
 const app=await buildApp({...f,chain:{}});try{
  const runtime=(await app.inject('/api/runtime')).json();assert.equal(runtime.privyAppId,'public-app-id');assert.equal(runtime.launch,false);assert.equal(runtime.claims,false);
  assert.ok(!JSON.stringify(runtime).includes('test-secret'));assert.equal(runtime.telegramClientSecret,undefined);
  const headers={cookie:'tp_session=session2',origin:f.config.origin,'x-csrf-token':'csrf2','idempotency-key':'request-key-12345'};
  assert.equal((await app.inject({method:'POST',url:'/api/launches/prepare',headers,payload:{}})).statusCode,503);
  assert.equal((await app.inject({method:'POST',url:'/api/claims',headers,payload:{amount:'1000000',wallet:f.wallet.publicKey.toBase58()}})).statusCode,503);
  const tokens=(await app.inject('/api/public/tokens')).json().tokens;assert.equal(tokens.length,1);assert.equal(tokens[0].creator_secret,undefined);assert.equal(tokens[0].transaction_base64,undefined);
  assert.equal(tokens[0].market_cap_usd,null);assert.equal(tokens[0].last_trade_at,null);
  await f.db.query("INSERT INTO market_state(launch_id,spot_price_sol,updated_at,sol_usd,sol_usd_at,supply) VALUES('launch1',0.001,now(),100,now(),1000000)");
  await f.db.query("INSERT INTO market_trades VALUES('launch1','listing-trade',0,1,now(),'buy','wallet',1000000,1000000,0.001)");
  const listed=(await app.inject('/api/public/tokens')).json().tokens[0];assert.equal(listed.market_cap_usd,100000);assert.ok(listed.last_trade_at);
  await f.db.query("UPDATE market_state SET updated_at=now()-interval '2 minutes'");
  assert.equal((await app.inject('/api/public/tokens')).json().tokens[0].market_cap_usd,null);
  const detail=(await app.inject('/api/public/token/launch1')).json();assert.equal(detail.mint,tokens[0].mint);assert.equal(detail.recipient_handle,'hamoon');assert.equal(detail.creator_secret,undefined);
  assert.equal((await app.inject('/api/public/token/missing')).statusCode,404);
  const profile=(await app.inject('/api/public/profile/hamoon')).json();assert.equal(profile.tokens[0].id,'launch1');assert.equal(profile.tokens[0].collected_lamports,'0');
  assert.equal((await app.inject({method:'POST',url:'/api/auth/logout',headers})).statusCode,200);
  assert.equal((await app.inject({url:'/api/session',headers})).json().user,null);
 }finally{await app.close();await f.db.close()}
});

test('collection and sweep finalize before the 80/20 credit; retries never duplicate the receipt',async()=>{
 const f=await fixture();try{
  f.config.collectionsEnabled=true;f.config.treasurySecret=bs58.encode(Keypair.generate().secretKey);f.config.operatorSecret=bs58.encode(Keypair.generate().secretKey);
  const creator=Keypair.generate();await f.db.query('UPDATE launches SET creator=$1,creator_secret=$2 WHERE id=$3',[creator.publicKey.toBase58(),encrypt(creator.secretKey,f.config.encryptionKey,'creator:launch1'),'launch1']);
  await f.db.query("INSERT INTO jobs(id,kind,launch_id) VALUES('collect-test','collect','launch1')");
  let collectFinal=false,sweepFinal=false,sweeps=0;
  const chain={collection:async()=>({tx:{signatures:[new Uint8Array(64).fill(3)]},wire:'collect-wire',lastValidHeight:100}),transfer:async()=>{sweeps++;return {tx:{signatures:[new Uint8Array(64).fill(4)]},wire:'sweep-wire',lastValidHeight:100}},status:async sig=>({state:(sig===bs58.encode(new Uint8Array(64).fill(3))?collectFinal:sweepFinal)?'confirmed':'pending'}),send:async()=>{},collectedFees:async()=>({lamports:10000001n,slot:1}),receivedBy:async()=>({lamports:10000001n,slot:2}),sdk:{getCreatorVaultBalanceBothPrograms:async()=>({toString:()=> '0'})}};
  await workerTick({db:f.db,config:f.config,chain});assert.equal((await f.db.query('SELECT * FROM fee_events')).rowCount,0);
  collectFinal=true;await workerTick({db:f.db,config:f.config,chain});assert.equal((await f.db.query('SELECT * FROM fee_events')).rowCount,0);
  await workerTick({db:f.db,config:f.config,chain});assert.equal(sweeps,1);assert.equal((await f.db.query('SELECT * FROM fee_events')).rowCount,0);
  sweepFinal=true;await workerTick({db:f.db,config:f.config,chain});await workerTick({db:f.db,config:f.config,chain});
  const events=await f.db.query('SELECT * FROM fee_events');assert.equal(events.rowCount,1);assert.equal(events.rows[0].recipient,'8000000');assert.equal(events.rows[0].project,'2000001');assert.equal(sweeps,1);
 }finally{await f.db.close()}
});

test('RPC network guard accepts full genesis hashes and rejects mismatched or shortened identities',async()=>{
 const {chainService}=await import('../src/chain.mjs');
 const hashes={'mainnet-beta':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',devnet:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'};
 for(const [cluster,hashValue] of Object.entries(hashes)){
  const good=chainService({cluster,rpcUrl:'http://localhost:8899'});good.connection.getGenesisHash=async()=>hashValue;await good.checkNetwork();
  for(const incorrect of [hashValue.slice(0,32),hashes[cluster==='devnet'?'mainnet-beta':'devnet']]){
   const bad=chainService({cluster,rpcUrl:'http://localhost:8899'});bad.connection.getGenesisHash=async()=>incorrect;await assert.rejects(bad.checkNetwork(),/network does not match/);
  }
 }
});

test('bot login binds wallet signature, browser and fresh Telegram callback; replay cannot refresh claim proof',async()=>{
 const f=await fixture();Object.assign(f.config,{telegramBotToken:'test-bot',telegramWebhookSecret:'test-webhook'});
 const calls=[];const app=await buildApp({...f,chain:{},fetcher:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({ok:true,result:{}})};}});
 try{
  const address=f.wallet.publicKey.toBase58(),origin=f.config.origin;
  const start=await app.inject({method:'POST',url:'/api/auth/wallet/start',headers:{origin},payload:{address}});assert.equal(start.statusCode,200,start.body);
  const proof=start.json(),signature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(proof.message),f.wallet.secretKey));
  const walletCookie='tp_wallet_login='+start.cookies[0].value;
  assert.equal((await app.inject({method:'POST',url:'/api/auth/wallet/finish',headers:{origin},payload:{id:proof.id,signature}})).statusCode,400);
  const finished=await app.inject({method:'POST',url:'/api/auth/wallet/finish',headers:{origin,cookie:walletCookie},payload:{id:proof.id,signature}});assert.equal(finished.statusCode,200,finished.body);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/wallet/finish',headers:{origin,cookie:walletCookie},payload:{id:proof.id,signature}})).statusCode,401);
  const launcherCookie='tp_launch='+finished.cookies.find(c=>c.name==='tp_launch').value;
  const headers={origin,cookie:launcherCookie,'x-launch-csrf':finished.json().csrf};
  const botStart=await app.inject({method:'POST',url:'/api/auth/bot/start',headers,payload:{}});assert.equal(botStart.statusCode,200,botStart.body);
  const id=botStart.json().id,botCookie='tp_bot_login='+botStart.cookies[0].value;
  const callback={callback_query:{id:'callback1',data:'verify:'+id,from:{id:33,username:'HaMoon',first_name:'Owner'},message:{message_id:1,chat:{id:33,type:'private'}}}};
  assert.equal((await app.inject({method:'POST',url:'/api/telegram/webhook',payload:callback})).statusCode,401);
  const verified=await app.inject({method:'POST',url:'/api/telegram/webhook',headers:{'x-telegram-bot-api-secret-token':'test-webhook'},payload:callback});assert.equal(verified.statusCode,200,verified.body);
  const first=(await f.db.query('SELECT verified_at FROM login_requests WHERE id=$1',[id])).rows[0].verified_at;
  await app.inject({method:'POST',url:'/api/telegram/webhook',headers:{'x-telegram-bot-api-secret-token':'test-webhook'},payload:callback});
  assert.equal(String((await f.db.query('SELECT verified_at FROM login_requests WHERE id=$1',[id])).rows[0].verified_at),String(first));
  assert.equal((await app.inject({method:'POST',url:'/api/auth/bot/finish',headers,payload:{id}})).statusCode,400);
  const done=await app.inject({method:'POST',url:'/api/auth/bot/finish',headers:{...headers,cookie:launcherCookie+'; '+botCookie},payload:{id}});assert.equal(done.statusCode,200,done.body);assert.equal(done.json().username,'hamoon');
  const cookie='tp_session='+done.cookies.find(c=>c.name==='tp_session').value;
  const session=(await app.inject({url:'/api/session',headers:{cookie}})).json();assert.equal(session.user.username,'hamoon');assert.equal(session.claimVerificationFresh,true);assert.deepEqual(session.wallets,[address]);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/bot/finish',headers:{...headers,cookie:launcherCookie+'; '+botCookie},payload:{id}})).statusCode,401);
  assert.ok(calls.some(c=>c.url.endsWith('/answerCallbackQuery')));
 }finally{await app.close();await f.db.close();}
});

test('split initial buy endpoints are retired while submitted legacy buys still reconcile',async()=>{
 const f=await fixture();f.config.launchesEnabled=true;
 await f.db.query("UPDATE launches SET owner_id='2' WHERE id='launch1'");
 const chain={status:async()=>({state:'confirmed'})};const app=await buildApp({...f,chain});
 const headers={cookie:'tp_session=session2',origin:f.config.origin,'x-csrf-token':'csrf2'};
 try{
  for(const action of ['prepare','submit'])assert.equal((await app.inject({method:'POST',url:`/api/launches/launch1/buy/${action}`,headers,payload:{}})).statusCode,410);
  await f.db.query("INSERT INTO launch_buys(launch_id,status,message_base64,transaction_base64,last_valid_height,signature) VALUES('launch1','submitted','old','old',100,'old-signature')");
  await workerTick({...f,chain});assert.equal((await f.db.query("SELECT status FROM launch_buys WHERE launch_id='launch1'")).rows[0].status,'confirmed');
 }finally{await app.close();await f.db.close();}
});

test('creation is mint co-signed before wallet approval and keeps exact-message tamper protection',async()=>{
 const {chainService}=await import('../src/chain.mjs');
 const mint=Keypair.generate(),payer=Keypair.generate(),creator=Keypair.generate();
 const encryptionKey=Buffer.alloc(32,9).toString('base64');
 const chain=chainService(configFromEnv({SOLANA_RPC_URL:'https://unused.invalid',KEY_ENCRYPTION_KEY:encryptionKey}));
 chain.connection.getGenesisHash=async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
 chain.connection.getLatestBlockhash=async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:200});
 chain.connection.simulateTransaction=async()=>({value:{err:null,unitsConsumed:120000}});
 chain.connection.getFeeForMessage=async()=>({value:10000});
 const args={mint:mint.publicKey.toBase58(),creator:creator.publicKey.toBase58(),wallet:payer.publicKey.toBase58(),name:'Test',symbol:'TEST',uri:'https://example.test/meta.json',initialBuy:0n,encryptedMintSecret:encrypt(mint.secretKey,encryptionKey,`mint:${mint.publicKey.toBase58()}`)};
 for(let attempt=0;attempt<2;attempt++){
  const prepared=await chain.prepareLaunch(args),tx=VersionedTransaction.deserialize(Buffer.from(prepared.wire,'base64'));
  const index=tx.message.staticAccountKeys.findIndex(k=>k.equals(mint.publicKey));
  assert.ok(nacl.sign.detached.verify(tx.message.serialize(),tx.signatures[index],mint.publicKey.toBytes()));
  assert.ok(tx.signatures[0].every(b=>b===0),'payer has not signed; this cannot be broadcast successfully');
  tx.sign([payer]);assert.doesNotThrow(()=>signedMatches(Buffer.from(tx.serialize()).toString('base64'),prepared.message,args.wallet));
  // A changed blockhash invalidates the mint signature and is still rejected,
  // even when the payer has signed the altered transaction.
  tx.message.recentBlockhash=Keypair.generate().publicKey.toBase58();tx.sign([payer]);
  assert.throws(()=>signedMatches(Buffer.from(tx.serialize()).toString('base64'),prepared.message,args.wallet),/transaction was changed/);
 }
 await assert.rejects(chain.prepareLaunch({...args,encryptedMintSecret:encrypt(creator.secretKey,encryptionKey,`mint:${args.mint}`)}),/Mint signer mismatch/);
});


test('recipient lookup rechecks the current username and never confirms unknown or reassigned handles',async()=>{
 const f=await fixture();f.config.telegramBotToken='bot-test';let calls=0;
 const fetcher=async(url,init)=>{
  calls++;
  if(String(url).endsWith('/getChat')){const id=JSON.parse(init.body).chat_id;return {ok:true,json:async()=>({ok:true,result:{type:'private',username:id==='1'?'sold_handle':'hamoon',first_name:'Current owner'}})}}
  return {ok:true,text:async()=>'<html><h1>Site Unavailable</h1></html>'};
 };
 const app=await buildApp({...f,chain:{},fetcher});try{
  const found=await app.inject('/api/public/recipients?q=Hamoon');assert.equal(found.statusCode,200,found.body);assert.equal(found.json().results.length,1);assert.equal(found.json().results[0].name,'Current owner');assert.equal(found.json().results[0].id,undefined);
  const before=calls;await app.inject('/api/public/recipients?q=hamoon');assert.equal(calls,before);
  const unknown=(await app.inject('/api/public/recipients?q=unknown_name')).json();assert.equal(unknown.results.length,0);assert.equal(unknown.exactStatus,'unavailable');
  assert.equal((await app.inject('/api/public/recipients?q=../../bad')).statusCode,400);
 }finally{await app.close();await f.db.close()}
});
test('public Telegram preview only recognizes matching contact profiles, not generic or channel pages',async()=>{
 const {parsePublicProfile}=await import('../src/recipients.mjs');
 const page='<div class="tgme_page_title"><span>A &amp; B</span></div><div class="tgme_page_extra">@hamoon</div><img class="tgme_page_photo_image" src="https://cdn4.telesco.pe/file/photo.jpg"><a>Send Message</a>';
 assert.equal(parsePublicProfile(page,'hamoon').name,'A & B');assert.ok(parsePublicProfile(page,'hamoon').photo.startsWith('https://cdn4.telesco.pe/'));
 assert.equal(parsePublicProfile(page,'other'),null);assert.equal(parsePublicProfile(page.replace('Send Message','View Channel'),'hamoon'),null);assert.equal(parsePublicProfile('<a>Send Message</a>','hamoon'),null);
 assert.equal(parsePublicProfile(page.replace('https://cdn4.telesco.pe/file/photo.jpg','https://evil.example/photo.jpg'),'hamoon').photo,null);
});

test('atomic launch preserves both instructions and the mint signature within the packet limit; failure never becomes create-only',async()=>{
 const {chainService}=await import('../src/chain.mjs');const {PUMP_SDK}=await import('@pump-fun/pump-sdk');
 const snapshots=JSON.parse(await readFile(new URL('./fixtures/pump-public-accounts.json',import.meta.url),'utf8'));
 const mint=Keypair.generate(),payer=Keypair.generate(),creator=Keypair.generate(),encryptionKey=Buffer.alloc(32,9).toString('base64');
 const chain=chainService({rpcUrl:'https://unused.invalid',cluster:'mainnet-beta',encryptionKey});
 chain.connection.getGenesisHash=async()=> '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
 chain.connection.getLatestBlockhash=async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:200});
 let simulations=0;
 chain.connection.simulateTransaction=async()=>{simulations++;return {value:{err:simulations>1?{InstructionError:[2,'InsufficientFunds']}:null}}};
 chain.connection.getFeeForMessage=async()=>({value:10000});
 chain.sdk.fetchGlobal=async()=>PUMP_SDK.decodeGlobal({data:Buffer.from(snapshots.global,'base64')});
 chain.sdk.fetchFeeConfig=async()=>PUMP_SDK.decodeFeeConfig({data:Buffer.from(snapshots.fee,'base64')});
 const args={mint:mint.publicKey.toBase58(),creator:creator.publicKey.toBase58(),wallet:payer.publicKey.toBase58(),name:'A'.repeat(32),symbol:'A'.repeat(10),uri:'https://telepaid-production.up.railway.app/api/m/'+'a'.repeat(22),initialBuy:1000000n,encryptedMintSecret:encrypt(mint.secretKey,encryptionKey,`mint:${mint.publicKey.toBase58()}`)};
 const prepared=await chain.prepareLaunch(args),tx=VersionedTransaction.deserialize(Buffer.from(prepared.wire,'base64'));
 assert.ok(tx.serialize().length<=1232);assert.equal(tx.message.compiledInstructions.length,3);
 const index=tx.message.staticAccountKeys.findIndex(k=>k.equals(mint.publicKey));assert.ok(nacl.sign.detached.verify(tx.message.serialize(),tx.signatures[index],mint.publicKey.toBytes()));
 assert.ok(tx.signatures[0].every(b=>b===0));
 await assert.rejects(chain.prepareLaunch(args),/Launch simulation failed/);assert.equal(simulations,2);
 await assert.rejects(chain.prepareLaunch({...args,name:'🍑'.repeat(20)}),/32 UTF-8 bytes/);
});

test('real Pump simulation events decode and cannot be spoofed by another program or a failed transaction',async()=>{
 const {parseTrades,candleSeries}=await import('../src/market.mjs');
 const fixture=JSON.parse(await readFile(new URL('./fixtures/atomic-simulation.json',import.meta.url),'utf8'));
 const trades=parseTrades(fixture,fixture.mint,fixture.signature);assert.equal(trades.length,1);assert.equal(trades[0].side,'buy');assert.ok(BigInt(trades[0].solLamports)>0n);
 assert.deepEqual(parseTrades({...fixture,meta:{...fixture.meta,err:{InstructionError:[2,'failed']}}},fixture.mint,fixture.signature),[]);
 assert.deepEqual(parseTrades(fixture,Keypair.generate().publicKey.toBase58(),fixture.signature),[]);
 const forged={...fixture,meta:{...fixture.meta,logMessages:['Program 11111111111111111111111111111111 invoke [1]',...fixture.meta.logMessages.filter(l=>l.startsWith('Program data:')),'Program 11111111111111111111111111111111 success']}};
 assert.deepEqual(parseTrades(forged,fixture.mint,fixture.signature),[]);
 const candles=candleSeries([{...trades[0],time:120,priceSol:2},{...trades[0],time:160,priceSol:4},{...trades[0],time:240,priceSol:3}],60);
 assert.equal(candles.length,2);assert.deepEqual([candles[0].open,candles[0].high,candles[0].low,candles[0].close],[2,4,2,4]);assert.equal(candles[1].time,240);assert.equal(candles[0].trades,2);
});

test('market indexing persists actual trades once, excludes failures and reports the live curve price',async()=>{
 const f=await fixture();const {marketService}=await import('../src/market.mjs');const snapshot=JSON.parse(await readFile(new URL('./fixtures/atomic-simulation.json',import.meta.url),'utf8'));
 try{
  const token={id:'launch1',mint:snapshot.mint};let fetches=0;
  const chain={checkNetwork:async()=>{},sdk:{fetchBondingCurve:async()=>({complete:false,virtualQuoteReserves:30000000000n,virtualTokenReserves:1000000000000000n})},connection:{getSignaturesForAddress:async()=>[{signature:snapshot.signature,err:null}],getTransaction:async(_signature,options)=>{assert.equal(options.maxSupportedTransactionVersion,1);fetches++;return snapshot;}}};
  const service=marketService({db:f.db,chain});const first=await service.load(token,60);assert.equal(first.trades.length,1);assert.ok(first.spotPriceSol>0);assert.equal(first.stale,false);
  const second=await service.load(token,300);assert.equal(second.trades.length,1);assert.equal(fetches,1);
  await marketService({db:f.db,chain}).load(token,60);assert.equal(fetches,1);assert.equal((await f.db.query('SELECT * FROM market_trades')).rowCount,1);
 }finally{await f.db.close();}
});

test('recipient directory opt-in reveals a real profile without granting authentication or claim proof',async()=>{
 const f=await fixture();Object.assign(f.config,{telegramBotToken:'test-bot',telegramWebhookSecret:'test-webhook'});
 const fetcher=async(url)=>({ok:true,json:async()=>({ok:true,result:String(url).endsWith('/getChat')?{type:'private',username:'newrecipient',first_name:'New recipient'}:{}}),text:async()=>''});
 const app=await buildApp({...f,chain:{},fetcher});try{
  const update={message:{from:{id:123,username:'newrecipient',first_name:'New recipient'},chat:{id:123,type:'private'},text:'/start recipient'}};
  assert.equal((await app.inject({method:'POST',url:'/api/telegram/webhook',payload:update})).statusCode,401);
  const headers={'x-telegram-bot-api-secret-token':'test-webhook'};assert.equal((await app.inject({method:'POST',url:'/api/telegram/webhook',headers,payload:update})).statusCode,200);
  const result=(await app.inject('/api/public/recipients?q=newrecipient&refresh=1')).json();assert.equal(result.results[0].name,'New recipient');
  assert.equal((await f.db.query("SELECT * FROM users WHERE id='123'")).rowCount,0);assert.equal((await f.db.query("SELECT * FROM sessions WHERE user_id='123'")).rowCount,0);
  await app.inject({method:'POST',url:'/api/telegram/webhook',headers,payload:{message:{...update.message,text:'/remove'}}});assert.equal((await f.db.query('SELECT * FROM telegram_directory')).rowCount,0);
 }finally{await app.close();await f.db.close();}
});

test('sharing receipts require the official program, correct mint, and 100% treasury allocation',async()=>{
 const {sharingReceipt,assertSharing}=await import('../src/fee-sharing.mjs');
 const {PUMP_PROGRAM_ID,feeSharingConfigPda}=await import('@pump-fun/pump-sdk');const {createHash}=await import('node:crypto');
 const mint=Keypair.generate().publicKey,treasury=Keypair.generate().publicKey;
 const state={mint,adminRevoked:true,shareholders:[{address:treasury,shareBps:10000}]};assertSharing(state,mint.toBase58(),treasury.toBase58());
 assert.throws(()=>assertSharing({...state,adminRevoked:false},mint.toBase58(),treasury.toBase58()),/locked/);
 assert.throws(()=>assertSharing({...state,shareholders:[{address:treasury,shareBps:8000}]},mint.toBase58(),treasury.toBase58()),/locked/);
 const encoded=createHash('sha256').update('event:DistributeCreatorFeesEvent').digest().subarray(0,8).toString('base64');
 const event={...state,sharingConfig:feeSharingConfigPda(mint),distributed:10001n};const decoder={decodeDistributeCreatorFeesEvent:()=>event};
 const tx={meta:{err:null,logMessages:[`Program ${PUMP_PROGRAM_ID} invoke [1]`,`Program data: ${encoded}`,`Program ${PUMP_PROGRAM_ID} success`]}};
 assert.equal(sharingReceipt(tx,mint.toBase58(),treasury.toBase58(),decoder),10001n);
 tx.meta.logMessages[0]=`Program ${Keypair.generate().publicKey} invoke [1]`;assert.equal(sharingReceipt(tx,mint.toBase58(),treasury.toBase58(),decoder),0n);
});

test('durable indexing resumes failed pages and catches up without skipping signatures',async()=>{
 const f=await fixture();try{
 const {indexAddress}=await import('../src/indexer.mjs');const address=Keypair.generate().publicKey;const calls=[],processed=[];let fail=true;
 const connection={getSignaturesForAddress:async(_a,opts)=>{calls.push(opts);return opts.before?[{signature:'old'}]:opts.until?[]:[{signature:'new'},{signature:'middle'}];}};
 const args={db:f.db,connection,launchId:'launch1',address,kind:'check',limit:2,process:async s=>{if(s.signature==='middle'&&fail)throw new Error('RPC retry');processed.push(s.signature)}};
 await assert.rejects(indexAddress(args),/RPC retry/);assert.equal((await f.db.query('SELECT before_signature FROM index_cursors')).rows[0].before_signature,null);
 fail=false;assert.equal((await indexAddress(args)).complete,false);assert.equal((await indexAddress(args)).complete,true);assert.equal(calls.at(-1).before,'middle');
 await indexAddress(args);assert.equal(calls.at(-1).until,'new');assert.ok(processed.includes('old'));
 }finally{await f.db.close()}
});

test('USD candles use historical reference rates; missing rates do not invent dollar prices',async()=>{
 const f=await fixture();try{
 const {marketService}=await import('../src/market.mjs');const now=Math.floor(Date.now()/300000)*300;
 await f.db.query("INSERT INTO market_state(launch_id,spot_price_sol,updated_at,backlog,sol_usd,sol_usd_at,supply) VALUES('launch1',0.002,now(),false,200,now(),1000)");
 for(const [i,rate] of [[1,100],[2,150]]){
 await f.db.query('INSERT INTO sol_usd_rates(minute,price) VALUES($1,$2)',[now-i*300,rate]);
 await f.db.query("INSERT INTO market_trades VALUES('launch1',$1,0,$2,to_timestamp($3),'buy','wallet',1000000000,1000000000,0.001)",['tx'+i,i,now-i*300]);}
 const service=marketService({db:f.db,chain:{},config:{production:true}}),r=await service.load({id:'launch1'},60);
 assert.equal(r.spotPriceUsd,0.4);assert.equal(r.candles[0].close,0.15);assert.equal(r.candles[1].close,0.1);assert.equal(r.stats.volume24hUsd,250);assert.equal(r.stats.marketCapUsd,400);
 await f.db.query('DELETE FROM sol_usd_rates WHERE minute=$1',[now-300]);const missing=await service.load({id:'launch1'},60);assert.equal(missing.candles.length,1);assert.equal(missing.stats.volume24hUsd,null);assert.equal(missing.trades[0].priceUsd,null);
 }finally{await f.db.close()}
});

test('truncated trade logs recover from authenticated Anchor event CPIs without double counting',async()=>{
 const {parseTrades}=await import('../src/market.mjs');const {PUMP_PROGRAM_ID,PUMP_EVENT_AUTHORITY_PDA}=await import('@pump-fun/pump-sdk');const {createHash}=await import('node:crypto');
 const fixture=JSON.parse(await readFile(new URL('./fixtures/atomic-simulation.json',import.meta.url),'utf8'));
 const discriminator=createHash('sha256').update('event:TradeEvent').digest().subarray(0,8);
 const event=fixture.meta.logMessages.filter(l=>l.startsWith('Program data: ')).map(l=>Buffer.from(l.slice(14),'base64')).find(b=>b.subarray(0,8).equals(discriminator));
 const keys=[PUMP_PROGRAM_ID,PUMP_EVENT_AUTHORITY_PDA];const transaction={message:{getAccountKeys:()=>({get:i=>keys[i]})}};
 const innerInstructions=[{index:4,instructions:[{programIdIndex:0,accounts:[1],data:bs58.encode(Buffer.concat([Buffer.from('e445a52e51cb9a1d','hex'),event]))}]}];
 const truncated={...fixture,transaction,meta:{...fixture.meta,innerInstructions,logMessages:['Log truncated']}};
 assert.equal(parseTrades(truncated,fixture.mint,fixture.signature).length,1);
 assert.equal(parseTrades({...truncated,meta:{...truncated.meta,logMessages:fixture.meta.logMessages}},fixture.mint,fixture.signature).length,1);
 keys[1]=Keypair.generate().publicKey;assert.equal(parseTrades(truncated,fixture.mint,fixture.signature).length,0);
});

test('a single finalized transaction may distribute for two mints, with independent idempotent credits',async()=>{
 const f=await fixture();try{
 const mint=Keypair.generate().publicKey.toBase58();await f.db.query("INSERT INTO mint_pool(address,secret_encrypted,suffix,status) VALUES($1,'unused','TeLe','consumed')",[mint]);
 await f.db.query("INSERT INTO launches(id,idempotency_key,owner_id,recipient_handle,wallet,mint,creator,creator_secret,name,symbol,description,metadata_uri,image_uri) SELECT 'launch2','key2',owner_id,'othername',wallet,$1,$1,creator_secret,name,symbol,description,metadata_uri,image_uri FROM launches WHERE id='launch1'",[mint]);
 for(const launchId of ['launch1','launch2']){const e={eventId:'shared:'+launchId,launchId,recipientHandle:launchId==='launch1'?'hamoon':'othername',signature:'one-transaction',lamports:100n,slot:123};assert.equal(await recordCollection(f.db,e),true);assert.equal(await recordCollection(f.db,{...e,eventId:'other:'+launchId}),false);}
 assert.equal((await f.db.query('SELECT * FROM fee_events')).rowCount,2);
 assert.deepEqual((await f.db.query('SELECT earned::text FROM balances ORDER BY handle')).rows.map(x=>x.earned),['80','80']);
 }finally{await f.db.close()}
});
