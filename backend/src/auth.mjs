import {createHash,randomUUID} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {randomToken,hash,equal} from './crypto.mjs';
import {need} from './errors.mjs';

const jwks=createRemoteJWKSet(new URL('https://oauth.telegram.org/.well-known/jwks.json'));
export async function verifyTelegram(idToken,config,nonce,keys=jwks) {
 const {payload}=await jwtVerify(idToken,keys,{issuer:'https://oauth.telegram.org',audience:config.telegramClientId,algorithms:['RS256','ES256'],maxTokenAge:'2 minutes',requiredClaims:['exp','iat','sub','nonce']});
 need(equal(payload.nonce,nonce),401,'Telegram sign-in nonce did not match');
 need(payload.sub&&Number.isSafeInteger(payload.id)&&payload.id>0,401,'Telegram did not return a valid account ID');
 return {id:String(payload.id),sub:payload.sub,username:payload.preferred_username||null,name:payload.name||'Telegram user'};
}
export async function sessionFor(db,req) {
 if(!req.cookies.tp_session)return null;
 const {rows:[s]}=await db.query('SELECT s.*,s.verified_handle AS username,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()',[hash(req.cookies.tp_session)]);
 return s||null;
}
export function authRoutes(app,{db,config,verifyIdentity=verifyTelegram,fetcher=fetch}) {
 const cookie={path:'/',httpOnly:true,secure:config.production,sameSite:'lax'};
 app.get('/api/auth/telegram',async(req,reply)=>{
  need(config.telegramClientId&&config.telegramClientSecret,503,'Telegram sign-in is awaiting server configuration');
  const state=randomToken(),binding=randomToken(),verifier=randomToken(),nonce=randomToken();
  await db.query('INSERT INTO oauth_states(state_hash,binding_hash,verifier,nonce,expires_at) VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')',[hash(state),hash(binding),verifier,nonce]);
  reply.setCookie('tp_login',binding,{...cookie,maxAge:600});
  const url=new URL('https://oauth.telegram.org/auth');
  Object.entries({client_id:config.telegramClientId,redirect_uri:`${config.origin}/api/auth/telegram/callback`,response_type:'code',scope:'openid profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).forEach(([k,v])=>url.searchParams.set(k,v));
  return reply.redirect(url.href);
 });
 app.get('/api/auth/telegram/callback',async(req,reply)=>{
  need(typeof req.query.state==='string'&&typeof req.query.code==='string'&&req.cookies.tp_login,400,'Sign-in expired. Please try again');
  const {rows:[state]}=await db.query('DELETE FROM oauth_states WHERE state_hash=$1 AND binding_hash=$2 AND expires_at>now() RETURNING *',[hash(req.query.state),hash(req.cookies.tp_login)]);need(state,401,'Sign-in expired or already used');
  reply.clearCookie('tp_login',cookie);
  const response=await fetcher('https://oauth.telegram.org/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:`Basic ${Buffer.from(`${config.telegramClientId}:${config.telegramClientSecret}`).toString('base64')}`},body:new URLSearchParams({grant_type:'authorization_code',code:req.query.code,redirect_uri:`${config.origin}/api/auth/telegram/callback`,client_id:config.telegramClientId,code_verifier:state.verifier}),signal:AbortSignal.timeout(15000)});
  need(response.ok,502,'Telegram sign-in could not be completed');const result=await response.json();need(result.id_token,401,'Missing Telegram identity token');
  const identity=await verifyIdentity(result.id_token,config,state.nonce);
  await db.query('INSERT INTO users(id,oidc_sub,username,display_name,verified_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(id) DO UPDATE SET oidc_sub=EXCLUDED.oidc_sub,username=EXCLUDED.username,display_name=EXCLUDED.display_name,verified_at=now()',[identity.id,identity.sub,identity.username,identity.name]);
  if(req.cookies.tp_session)await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(req.cookies.tp_session)]);
  const token=randomToken();await db.query('INSERT INTO sessions(token_hash,user_id,csrf,verified_handle,expires_at) VALUES($1,$2,$3,$4,now()+interval \'24 hours\')',[hash(token),identity.id,randomToken(),identity.username?.toLowerCase()||null]);
  reply.setCookie('tp_session',token,{...cookie,maxAge:86400});return reply.redirect('/#claims');
 });
 app.post('/api/auth/logout',async(req,reply)=>{
  if(req.cookies.tp_session)await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(req.cookies.tp_session)]);
  if(req.cookies.tp_launch)await db.query('DELETE FROM launcher_sessions WHERE token_hash=$1',[hash(req.cookies.tp_launch)]);
  if(req.cookies.tp_bot_login)await db.query("DELETE FROM login_requests WHERE kind='telegram' AND binding_hash=$1",[hash(req.cookies.tp_bot_login)]);
  if(req.cookies.tp_wallet_login)await db.query("DELETE FROM login_requests WHERE kind='wallet' AND binding_hash=$1",[hash(req.cookies.tp_wallet_login)]);
  if(req.cookies.tp_login)await db.query('DELETE FROM oauth_states WHERE binding_hash=$1',[hash(req.cookies.tp_login)]);
  for(const name of ['tp_session','tp_launch','tp_bot_login','tp_wallet_login','tp_login'])reply.clearCookie(name,cookie);
  return {ok:true};
 });
 app.get('/api/session',async req=>{
  const s=await sessionFor(db,req);if(!s)return {user:null};
  const wallets=await db.query('SELECT address FROM wallets WHERE user_id=$1 AND verification_session_hash=$2 ORDER BY verified_at DESC',[s.user_id,s.token_hash]);
  const {rows:[b]}=await db.query('SELECT earned,reserved,settled FROM balances WHERE handle=$1',[s.username]);
  const balance=b||{earned:'0',reserved:'0',settled:'0'};
  return {user:{id:s.user_id,username:s.username,name:s.display_name},csrf:s.csrf,claimVerificationExpiresAt:new Date(new Date(s.created_at).getTime()+120000).toISOString(),claimVerificationFresh:!s.claim_used&&Date.now()-new Date(s.created_at).getTime()<120000,wallets:wallets.rows.map(w=>w.address),balance:{...balance,available:(BigInt(balance.earned)-BigInt(balance.reserved)-BigInt(balance.settled)).toString()}};
 });
 app.post('/api/wallet/challenge',async req=>{
  const address=req.body?.address;let pub;try{pub=new PublicKey(address);}catch{need(false,400,'Invalid Solana wallet');}
  need(PublicKey.isOnCurve(pub.toBytes()),400,'A signing wallet is required');
  const id=randomUUID(),issued=new Date(),expires=new Date(issued.getTime()+300000);
  const message=`${new URL(config.origin).host} wants you to verify this Solana wallet for TelePaid:\n${address}\n\nThis signature links your wallet to Telegram account ${req.session.user_id}. It does not authorize a transfer.\n\nURI: ${config.origin}\nNonce: ${id}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${expires.toISOString()}`;
  await db.query('INSERT INTO wallet_challenges(id,user_id,address,message,expires_at) VALUES($1,$2,$3,$4,$5)',[id,req.session.user_id,address,message,expires]);return {id,message};
 });
 app.post('/api/wallet/verify',async req=>{
  const {id,signature}=req.body||{};need(typeof id==='string'&&typeof signature==='string'&&signature.length<150,400,'Invalid wallet proof');
  return db.transaction(async tx=>{
   const {rows:[challenge]}=await tx.query('SELECT * FROM wallet_challenges WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE',[id,req.session.user_id]);need(challenge,401,'Wallet challenge expired or already used');
   let valid=false;try{valid=nacl.sign.detached.verify(new TextEncoder().encode(challenge.message),bs58.decode(signature),new PublicKey(challenge.address).toBytes());}catch{}
   need(valid,401,'Wallet signature is invalid');
   const existing=await tx.query('SELECT user_id FROM wallets WHERE address=$1',[challenge.address]);need(!existing.rowCount||existing.rows[0].user_id===req.session.user_id,409,'This wallet is already linked to another Telegram account');
   const linked=await tx.query('INSERT INTO wallets(address,user_id,verification_session_hash) VALUES($1,$2,$3) ON CONFLICT(address) DO UPDATE SET verification_session_hash=EXCLUDED.verification_session_hash,verified_at=now() WHERE wallets.user_id=EXCLUDED.user_id RETURNING address',[challenge.address,req.session.user_id,req.session.token_hash]);
   need(linked.rowCount,409,'This wallet belongs to another Telegram account');
   await tx.query('DELETE FROM wallet_challenges WHERE id=$1',[id]);return {address:challenge.address};
  });
 });
}
