import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {PUMP_PROGRAM_ID,PUMP_SDK,bondingCurvePda} from '@pump-fun/pump-sdk';
import {NATIVE_MINT} from '@solana/spl-token';
import {completeEventLogs} from './program-events.mjs';

const createTag=createHash('sha256').update('event:CreateEvent').digest().subarray(0,8);
const defaultArt='/telepaid-mark.png';
const metadataHosts=new Set(['ipfs.io','gateway.pinata.cloud','pump.mypinata.cloud','arweave.net','cf-ipfs.com','nftstorage.link']);

// Read an authenticated Pump event, never a third party's log line or a name
// supplied through our own API. A successful, finalized transaction is required.
export function officialCreation(tx,mint,wallet,decoder=PUMP_SDK){
 if(!tx?.meta||tx.meta.err)return null;
 const stack=[];
 for(const line of completeEventLogs(tx)){
  const invoke=/^Program (\w+) invoke \[(\d+)\]$/.exec(line);
  if(invoke){stack.length=Number(invoke[2])-1;stack.push(invoke[1]);continue;}
  if(/^Program \w+ (?:success|failed:)/.test(line)){stack.pop();continue;}
  if(stack.at(-1)!==PUMP_PROGRAM_ID.toBase58()||!line.startsWith('Program data: '))continue;
  const bytes=Buffer.from(line.slice(14),'base64');if(!bytes.subarray(0,8).equals(createTag))continue;
  let event;try{event=decoder.decodeCreateEventBc(bytes.subarray(8));}catch{continue;}
  if(event.mint.toBase58()!==mint||event.user.toBase58()!==wallet||event.creator.toBase58()!==wallet||event.isHolderReward)continue;
  if(event.quoteMint&&!event.quoteMint.equals(PublicKey.default)&&!event.quoteMint.equals(NATIVE_MINT))continue;
  if(!event.name?.trim()||!event.symbol?.trim()||typeof event.uri!=='string')continue;
  return {name:event.name.trim(),symbol:event.symbol.trim(),uri:event.uri};
 }
 return null;
}

function metadataUrl(input){
 try{
  const url=new URL(input.startsWith('ipfs://')?`https://ipfs.io/ipfs/${input.slice(7).replace(/^ipfs\//,'')}`:input);
  return url.protocol==='https:'&&metadataHosts.has(url.hostname.toLowerCase())?url.toString():null;
 }catch{return null;}
}
async function publicMetadata(uri,fetcher=fetch){
 const url=metadataUrl(uri);if(!url)return null;
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(6000)});
 if(!response.ok||Number(response.headers.get('content-length')||0)>256000)return null;
 const reader=response.body?.getReader();if(!reader)return null;
 let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256000)return null;chunks.push(value);}}
 finally{reader.releaseLock();}
 const doc=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 return {description:typeof doc.description==='string'?doc.description.slice(0,1000):'',image:metadataUrl(doc.image||'')||defaultArt};
}

async function findCreation(connection,mint,wallet,decoder){
 let before;
 for(let page=0;page<10;page++){
  const signatures=await connection.getSignaturesForAddress(new PublicKey(mint),{limit:100,...(before?{before}:{})},'finalized');
  // Most recent first: the external launcher may have made a large first buy.
  for(const signature of signatures){
   if(signature.err)continue;
   const tx=await connection.getTransaction(signature.signature,{commitment:'finalized',maxSupportedTransactionVersion:1});
   const event=officialCreation(tx,mint,wallet,decoder);
   if(event)return {...event,signature:signature.signature,confirmedAt:new Date((tx.blockTime||Math.floor(Date.now()/1000))*1000)};
  }
  if(signatures.length<100)break;
  before=signatures.at(-1).signature;
 }
 return null;
}

export async function syncOfficialMints({db,chain,fetcher=fetch,decodeCurve=account=>PUMP_SDK.decodeBondingCurve(account),decoder=PUMP_SDK}){
 const {rows}=await db.query('SELECT * FROM official_mints ORDER BY created_at');
 for(const row of rows){
  try{
   if(row.status==='confirmed'){
    const {rows:[token]}=await db.query('SELECT metadata_uri,image_uri FROM launches WHERE id=$1 AND source=$2',[row.launch_id,'official']);
    if(token?.image_uri===defaultArt){
     const metadata=await publicMetadata(token.metadata_uri,fetcher);
     if(metadata&&metadata.image!==defaultArt)await db.query('UPDATE launches SET image_uri=$2,description=$3 WHERE id=$1 AND source=$4',[row.launch_id,metadata.image,metadata.description,'official']);
    }
    continue;
   }
   await chain.checkNetwork();
   const mint=new PublicKey(row.mint),address=bondingCurvePda(mint);
   const account=await chain.connection.getAccountInfo(address,'finalized');
   if(!account)continue;
   if(!account.owner.equals(PUMP_PROGRAM_ID))throw Error('Bonding curve owner mismatch');
   const curve=decodeCurve(account);
   if(curve.creator.toBase58()!==row.expected_wallet)throw Error('Bonding curve creator mismatch');
   const create=await findCreation(chain.connection,row.mint,row.expected_wallet,decoder);
   if(!create)continue;
   let metadata=null;try{metadata=await publicMetadata(create.uri,fetcher);}catch{}
   await db.transaction(async tx=>{
    await tx.query("INSERT INTO launches(id,idempotency_key,owner_id,recipient_handle,wallet,mint,creator,creator_secret,name,symbol,description,metadata_uri,image_uri,status,confirmed_at,signature,fee_mode,source) VALUES($1,$1,'official:telepay',NULL,$2,$3,$2,'',$4,$5,$6,$7,$8,'confirmed',$9,$10,'official','official') ON CONFLICT(id) DO NOTHING",[row.launch_id,row.expected_wallet,row.mint,create.name,create.symbol,metadata?.description||'',create.uri,metadata?.image||defaultArt,create.confirmedAt,create.signature]);
    await tx.query("UPDATE official_mints SET status='confirmed',confirmed_at=$2 WHERE mint=$1",[row.mint,create.confirmedAt]);
   });
   console.log(JSON.stringify({event:'official_mint_imported',mint:row.mint}));
  }catch(error){console.error(JSON.stringify({event:'official_mint_retry',mint:row.mint,code:error.code||error.name}));}
 }
}
