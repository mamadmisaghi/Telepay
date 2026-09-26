import {randomUUID} from 'node:crypto';
import {splitCreatorFees} from '../../lib/domain/fees.ts';
import {need} from './errors.mjs';
export const normalizeHandle=value=>String(value||'').replace(/^@/,'').toLowerCase();
export async function recordCollection(db,{eventId,launchId,recipientHandle,signature,lamports,slot}) {
 const split=splitCreatorFees(lamports);need(lamports>0n,400,'Collection must be positive');
 return db.transaction(async tx=>{
  const handle=normalizeHandle(recipientHandle);
  const event=await tx.query('INSERT INTO fee_events(event_id,launch_id,recipient_handle,signature,gross,recipient,project,slot) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING event_id',[eventId,launchId,handle,signature,lamports.toString(),split.recipientLamports.toString(),split.projectLamports.toString(),slot]);
  if(!event.rowCount)return false;
  await tx.query('INSERT INTO balances(handle,earned) VALUES($1,$2) ON CONFLICT(handle) DO UPDATE SET earned=balances.earned+EXCLUDED.earned',[handle,split.recipientLamports.toString()]);return true;
 });
}
export async function reserveClaim(db,{userId,handle,wallet,amount,idempotencyKey,minimum,sessionHash}) {
 need(typeof amount==='bigint'&&amount>=minimum&&amount<=(1n<<64n)-1n,400,'Claim amount is below the minimum or outside the supported range');handle=normalizeHandle(handle);
 need(/^[a-z][a-z0-9_]{3,31}$/.test(handle),403,'Your verified Telegram account needs a username');
 return db.transaction(async tx=>{
  await tx.query('INSERT INTO balances(handle) VALUES($1) ON CONFLICT DO NOTHING',[handle]);
  const {rows:[balance]}=await tx.query('SELECT * FROM balances WHERE handle=$1 FOR UPDATE',[handle]);
  const existing=await tx.query('SELECT * FROM claims WHERE user_id=$1 AND idempotency_key=$2',[userId,idempotencyKey]);
  if(existing.rowCount){need(existing.rows[0].wallet===wallet&&BigInt(existing.rows[0].amount)===amount&&existing.rows[0].handle===handle,409,'This request key was already used for a different claim');return existing.rows[0];}
  // Every new claim consumes a fresh Telegram username proof. Session user IDs are
  // only authentication/audit records; funds belong to the handle, not that ID.
  const proof=await tx.query('UPDATE sessions SET claim_used=true WHERE token_hash=$1 AND user_id=$2 AND verified_handle=$3 AND claim_used=false AND created_at>now()-interval \'2 minutes\' AND expires_at>now() RETURNING token_hash',[sessionHash,userId,handle]);
  need(proof.rowCount,401,'Verify your current Telegram username again before claiming');
  const linked=await tx.query('SELECT address FROM wallets WHERE address=$1 AND user_id=$2 AND verification_session_hash=$3',[wallet,userId,sessionHash]);need(linked.rowCount,403,'Verify this wallet before claiming');
  need(BigInt(balance.earned)-BigInt(balance.reserved)-BigInt(balance.settled)>=amount,409,'Insufficient claimable balance');
  const id=randomUUID();await tx.query('UPDATE balances SET reserved=reserved+$2 WHERE handle=$1',[handle,amount.toString()]);
  const {rows:[claim]}=await tx.query('INSERT INTO claims(id,user_id,handle,wallet,amount,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,userId,handle,wallet,amount.toString(),idempotencyKey]);
  await tx.query("INSERT INTO jobs(id,kind,claim_id) VALUES($1,'claim',$2)",[randomUUID(),id]);return claim;
 });
}
export async function finishClaim(db,id,{success,signature}) {
 return db.transaction(async tx=>{
  const {rows:[claim]}=await tx.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE',[id]);need(claim,404,'Claim not found');if(['confirmed','failed'].includes(claim.status))return;
  await tx.query('UPDATE balances SET reserved=reserved-$2, settled=settled+$3 WHERE handle=$1',[claim.handle,claim.amount,success?claim.amount:'0']);
  await tx.query('UPDATE claims SET status=$2, signature=$3, confirmed_at=CASE WHEN $2=\'confirmed\' THEN now() ELSE NULL END WHERE id=$1',[id,success?'confirmed':'failed',signature]);
 });
}
