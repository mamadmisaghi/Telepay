// Service integration test with real Devnet transactions. Telegram identity is a local fixture;
// it never sends a Telegram message or impersonates a user on the published service.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {testDb} from '../../tests/d1-adapter.mjs';
import {devnetService} from '../../lib/devnet-service.mjs';
import {VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {readKey} from '../src/chain.mjs';
import {digestPayload} from '../../lib/devnet-proof.mjs';
import {nonceHash} from '../../lib/telegram-bot.mjs';
const origin='http://127.0.0.1:4173',wallet=readKey(readFileSync('deploy/secrets/test-wallet.base58','utf8').trim()),receiptPath='backend/data/devnet-e2e.json';
const db=testDb('backend/data/devnet-e2e.sqlite');
const service=devnetService({...JSON.parse(readFileSync('deploy/secrets/devnet-runtime.json','utf8')),DB:db,BUCKET:{put:async(key,data)=>{const file='backend/data/e2e-r2/'+key;mkdirSync(file.slice(0,file.lastIndexOf('/')),{recursive:true});writeFileSync(file,data)},get:async key=>({body:readFileSync('backend/data/e2e-r2/'+key)})}});
const receipt=existsSync(receiptPath)?JSON.parse(readFileSync(receiptPath,'utf8')):{requestId:crypto.randomUUID()};
const save=()=>writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600});save();
async function api(path,body){const response=await service(new Request(origin+'/api/devnet/'+path,{...(body?{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}));const result=await response.json();if(!response.ok)throw new Error(path+': '+result.error);return result;}
async function signed(action,payload){const full={...payload,wallet:wallet.publicKey.toBase58()},digest=await digestPayload(full);const proof=await api('challenge',{wallet:full.wallet,action,digest});return api(action,{payload:full,proof:{id:proof.id,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(proof.message),wallet.secretKey))}})}
async function submit(tx){if(tx.status==='prepared'){const wire=VersionedTransaction.deserialize(Buffer.from(tx.transaction,'base64'));wire.sign([wallet]);return (await api('submit',{id:tx.id,transaction:Buffer.from(wire.serialize()).toString('base64')})).transaction;}return tx;}
async function finalized(kind){for(let attempt=0;attempt<22;attempt++){const state=await api('state?wallet='+wallet.publicKey.toBase58());const token=state.tokens.find(t=>t.id===receipt.launchId),tx=token?.transactions.find(t=>t.kind===kind);if(tx?.status==='confirmed'){console.log({kind,status:'finalized',signature:tx.signature});return tx;}if(tx?.status==='failed')throw new Error(kind+' failed: '+tx.error);await new Promise(r=>setTimeout(r,3000));}throw new Error(kind+' is still pending; rerun to reconcile the same transaction');}
if(!receipt.launchId){const result=await signed('prepare',{requestId:receipt.requestId,name:'TelePaid Devnet QA',symbol:'TPQA',description:'Automated Devnet creation and payout test. Not a mainnet token.',handle:'telepaid_qa',image:'data:image/png;base64,'+readFileSync('public/telepaid-mark.png').toString('base64'),initialBuy:'1000000'});receipt.launchId=result.launch.id;receipt.mint=result.launch.mint;save();await submit(result.transaction);}else{const result=await signed('resume',{id:receipt.launchId});await submit(result.transaction);}
receipt.create=await finalized('create');save();
const purchase=await signed('buy',{id:receipt.launchId});await submit(purchase.transaction);receipt.buy=await finalized('buy');save();
receipt.credit=await signed('credit',{id:receipt.launchId});save();
if(!receipt.claim){
 const verification=await signed('telegram',{}),nonce=new URL(verification.url).searchParams.get('start'),hash=await nonceHash(nonce);
 const query="UPDATE sandbox_telegram SET telegram_id='local_qa_fixture',handle='telepaid_qa',verified_at="+Date.now()+" WHERE nonce_hash='"+hash+"' AND verified_at IS NULL";
 db.sqlite.exec(query);
 await signed('claim',{id:receipt.launchId});receipt.claim=await finalized('claim');save();
}
const retry=await signed('claim',{id:receipt.launchId});if(retry.transaction.signature!==receipt.claim.signature)throw new Error('Claim retry changed its transaction');
console.log(JSON.stringify({network:'devnet',mint:receipt.mint,create:receipt.create.signature,buy:receipt.buy.signature,claim:receipt.claim.signature,split:receipt.credit,claimRetry:'same signature',telegram:'local fixture only'},null,2));
