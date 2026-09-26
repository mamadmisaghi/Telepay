import {randomUUID} from 'node:crypto';
import bs58 from 'bs58';
import {readKey} from './chain.mjs';

export function treasuryKeys(config){
 const keys=new Map();
 for(const secret of [config.treasurySecret,...(config.previousTreasurySecrets||[])].filter(Boolean)){
  const key=readKey(secret);keys.set(key.publicKey.toBase58(),key);
 }
 return keys;
}

// Rotation moves already-accounted funds. It never creates a new fee event.
// Persist the signed wire before broadcast; reconcile it even while switches are off.
export async function consolidateTreasuries({db,chain,config,operator,treasury}){
 const pending=await db.query("SELECT * FROM treasury_transfers WHERE status='submitted' ORDER BY created_at");
 for(const move of pending.rows){
  const state=await chain.status(move.signature,move.last_valid_height);
  if(state.state==='pending'){try{await chain.send(move.transaction_base64)}catch{}continue;}
  if(state.state==='confirmed'){
   const receipt=await chain.receivedBy(move.signature,move.destination);
   if(receipt.lamports!==BigInt(move.amount))throw new Error('Treasury transfer receipt mismatch');
  }
  await db.query("UPDATE treasury_transfers SET status=$2,completed_at=now() WHERE id=$1",[move.id,state.state==='confirmed'?'confirmed':'failed']);
 }
 if(!config.collectionsEnabled)return;
 for(const [address,key] of treasuryKeys(config)){
  if(address===treasury.publicKey.toBase58())continue;
  if(key.publicKey.equals(operator.publicKey))throw new Error('Previous treasury cannot be the gas payer');
  if((await db.query("SELECT 1 FROM treasury_transfers WHERE source=$1 AND status='submitted'",[address])).rowCount)continue;
  const balance=await chain.connection.getBalance(key.publicKey,'finalized');
  if(!Number.isSafeInteger(balance))throw new Error('Invalid treasury balance');
  if(balance<=0)continue;
  const prepared=await chain.transfer(key,treasury.publicKey.toBase58(),BigInt(balance),operator);
  await db.query('INSERT INTO treasury_transfers(id,source,destination,amount,transaction_base64,signature,last_valid_height) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),address,treasury.publicKey.toBase58(),String(balance),prepared.wire,bs58.encode(prepared.tx.signatures[0]),prepared.lastValidHeight]);
 }
}
