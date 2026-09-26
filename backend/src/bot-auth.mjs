import {randomUUID} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {hash,randomToken,equal} from './crypto.mjs';
import {need} from './errors.mjs';

export async function launcherFor(db,req){
 if(!req.cookies.tp_launch)return null;
 return (await db.query('SELECT * FROM launcher_sessions WHERE token_hash=$1 AND expires_at>now()',[hash(req.cookies.tp_launch)])).rows[0]||null;
}
export function botAuthRoutes(app,{db,config,fetcher=fetch}){
 const cookie={path:'/',httpOnly:true,secure:config.production,sameSite:'lax'};
 const limited={config:{rateLimit:{max:12,timeWindow:'1 minute'}}};
 const bot=async(method,body)=>{
  const response=await fetcher(`https://api.telegram.org/bot${config.telegramBotToken}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  const result=await response.json();need(response.ok&&result.ok,502,'Telegram is temporarily unavailable');return result.result;
 };
 app.post('/api/auth/wallet/start',limited,async(req,reply)=>{
  const address=req.body?.address;let publicKey;try{publicKey=new PublicKey(address);}catch{}
  need(publicKey&&PublicKey.isOnCurve(publicKey.toBytes()),400,'Connect a Solana signing wallet');
  const id=randomUUID(),binding=randomToken(),expires=new Date(Date.now()+300000);
  const message=`${new URL(config.origin).host} wants you to sign in to TelePaid:\n${address}\n\nThis verifies your wallet only. It does not authorize a payment or token creation.\nURI: ${config.origin}\nNonce: ${id}\nExpiration Time: ${expires.toISOString()}`;
  await db.query("INSERT INTO login_requests(id,kind,binding_hash,address,message,expires_at) VALUES($1,'wallet',$2,$3,$4,$5)",[id,hash(binding),address,message,expires]);
  reply.setCookie('tp_wallet_login',binding,{...cookie,maxAge:300});return {id,message};
 });
 app.post('/api/auth/wallet/finish',limited,async(req,reply)=>{
  const {id,signature}=req.body||{};need(typeof id==='string'&&typeof signature==='string'&&signature.length<150&&req.cookies.tp_wallet_login,400,'Invalid wallet proof');
  const token=randomToken(),csrf=randomToken();
  const address=await db.transaction(async tx=>{
   const {rows:[r]}=await tx.query("SELECT * FROM login_requests WHERE id=$1 AND kind='wallet' AND binding_hash=$2 AND expires_at>now() FOR UPDATE",[id,hash(req.cookies.tp_wallet_login)]);need(r,401,'Wallet proof expired or already used');
   let valid=false;try{valid=nacl.sign.detached.verify(new TextEncoder().encode(r.message),bs58.decode(signature),new PublicKey(r.address).toBytes());}catch{}
   need(valid,401,'Wallet signature is invalid');
   const userId=`wallet:${r.address}`;
   await tx.query("INSERT INTO users(id,display_name) VALUES($1,'Wallet launcher') ON CONFLICT DO NOTHING",[userId]);
   if(req.cookies.tp_launch)await tx.query('DELETE FROM launcher_sessions WHERE token_hash=$1',[hash(req.cookies.tp_launch)]);
   await tx.query("INSERT INTO launcher_sessions(token_hash,user_id,address,csrf,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours')",[hash(token),userId,r.address,csrf]);
   await tx.query('DELETE FROM login_requests WHERE id=$1',[id]);return r.address;
  });
  reply.clearCookie('tp_wallet_login',cookie).setCookie('tp_launch',token,{...cookie,maxAge:86400});return {address,csrf};
 });
 app.get('/api/auth/wallet/session',async req=>{
  const s=await launcherFor(db,req);return s?{address:s.address,csrf:s.csrf}:{address:null};
 });
 app.post('/api/auth/bot/start',limited,async(req,reply)=>{
  need(config.telegramBotToken&&config.telegramWebhookSecret,503,'Telegram verification is not configured');
  const launcher=await launcherFor(db,req);need(launcher&&equal(req.headers['x-launch-csrf'],launcher.csrf),401,'Verify your connected wallet first');
  const id=randomUUID(),binding=randomToken();
  await db.query("INSERT INTO login_requests(id,kind,binding_hash,address,expires_at) VALUES($1,'telegram',$2,$3,now()+interval '10 minutes')",[id,hash(binding),launcher.address]);
  reply.setCookie('tp_bot_login',binding,{...cookie,maxAge:600});return {id,url:`https://t.me/${config.telegramBotUsername}?start=${id}`,expiresIn:600};
 });
 app.post('/api/auth/bot/finish',limited,async(req,reply)=>{
  need(typeof req.body?.id==='string'&&req.cookies.tp_bot_login,400,'Start Telegram verification again');
  const launcher=await launcherFor(db,req);need(launcher&&equal(req.headers['x-launch-csrf'],launcher.csrf),401,'Verify your connected wallet first');
  const token=randomToken();
  const result=await db.transaction(async tx=>{
   const {rows:[r]}=await tx.query("SELECT * FROM login_requests WHERE id=$1 AND kind='telegram' AND binding_hash=$2 AND address=$3 AND expires_at>now() FOR UPDATE",[req.body.id,hash(req.cookies.tp_bot_login),launcher.address]);need(r,401,'Telegram verification expired or already used');
   if(!r.verified_at)return {pending:true};
   need(Date.now()-new Date(r.verified_at).getTime()<120000,401,'Telegram confirmation expired. Verify again');
   const identity=r.identity;
   await tx.query('INSERT INTO users(id,username,display_name,verified_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,verified_at=EXCLUDED.verified_at',[identity.id,identity.username,identity.name,r.verified_at]);
   if(req.cookies.tp_session)await tx.query('DELETE FROM sessions WHERE token_hash=$1',[hash(req.cookies.tp_session)]);
   await tx.query("INSERT INTO sessions(token_hash,user_id,csrf,verified_handle,created_at,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '24 hours')",[hash(token),identity.id,randomToken(),identity.username,r.verified_at]);
   // Both fresh Telegram confirmation AND browser-bound wallet signature are required.
   await tx.query('INSERT INTO wallets(address,user_id,verification_session_hash) VALUES($1,$2,$3) ON CONFLICT(address) DO UPDATE SET user_id=EXCLUDED.user_id,verification_session_hash=EXCLUDED.verification_session_hash,verified_at=now()',[r.address,identity.id,hash(token)]);
   await tx.query('DELETE FROM login_requests WHERE id=$1',[r.id]);return {pending:false,username:identity.username};
  });
  if(!result.pending)reply.clearCookie('tp_bot_login',cookie).setCookie('tp_session',token,{...cookie,maxAge:86400});return result;
 });
 app.post('/api/telegram/webhook',{config:{rateLimit:false}},async req=>{
  need(config.telegramWebhookSecret&&equal(req.headers['x-telegram-bot-api-secret-token'],config.telegramWebhookSecret),401,'Invalid webhook');
  const update=req.body||{},message=update.message,callback=update.callback_query;
  if(message?.chat?.type==='private'&&message.from?.id===message.chat.id){
   // Explicit opt-in to public recipient discovery; this grants no claim proof or session.
   if(/^\/start(?:@\w+)?(?:\s+recipient)?$/.test(message.text||'')&&!message.from.is_bot){
    const handle=String(message.from.username||'').toLowerCase();
    if(/^[a-z][a-z0-9_]{3,31}$/.test(handle)){
     await db.query('INSERT INTO telegram_directory(id,handle) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET handle=EXCLUDED.handle,updated_at=now()',[String(message.from.id),handle]);
     await bot('sendMessage',{chat_id:message.chat.id,text:`@${handle} can now be found as a TelePaid fee recipient. Return to the launch form and retry the username lookup.\n\nThis does not connect a wallet or authorize claims. Claim verification is separate.\nSend /remove to remove your account from recipient suggestions.`});
    }else await bot('sendMessage',{chat_id:message.chat.id,text:'Set a public Telegram username in Settings, then press Start again.'});
    return {ok:true};
   }
   if(/^\/remove(?:@\w+)?$/.test(message.text||'')){
    await db.query('DELETE FROM telegram_directory WHERE id=$1',[String(message.from.id)]);
    await bot('sendMessage',{chat_id:message.chat.id,text:'Removed from TelePaid recipient suggestions. Existing fee allocations and public Telegram profiles are unchanged.'});return {ok:true};
   }
   const id=/^\/start(?:@\w+)?\s+([a-f0-9-]{36})$/.exec(message.text||'')?.[1];
   if(!id)return {ok:true};
   const r=(await db.query("SELECT * FROM login_requests WHERE id=$1 AND kind='telegram' AND expires_at>now() AND verified_at IS NULL",[id])).rows[0];
   if(!r)return {ok:true};
   await bot('sendMessage',{chat_id:message.chat.id,text:`Confirm your current Telegram username for TelePaid.\n\nOnly confirm if you opened ${config.origin} yourself and this is your wallet:\n${r.address}\n\nThis connects your account for fee claims. It does not transfer funds.`,reply_markup:{inline_keyboard:[[{text:'Confirm this wallet',callback_data:`verify:${id}`}]]}});
  }
  if(callback?.message?.chat?.type==='private'&&callback.from?.id===callback.message.chat.id&&!callback.from.is_bot){
   const id=/^verify:([a-f0-9-]{36})$/.exec(callback.data||'')?.[1];if(!id)return {ok:true};
   const username=String(callback.from.username||'').toLowerCase();
   if(!/^[a-z][a-z0-9_]{3,31}$/.test(username)){await bot('answerCallbackQuery',{callback_query_id:callback.id,text:'Set a Telegram username first, then try again.',show_alert:true});return {ok:true};}
   const identity={id:String(callback.from.id),username,name:callback.from.first_name||'Telegram user'};
   const result=await db.query("UPDATE login_requests SET identity=$2,verified_at=now() WHERE id=$1 AND kind='telegram' AND expires_at>now() AND verified_at IS NULL RETURNING id",[id,JSON.stringify(identity)]);
   await bot('answerCallbackQuery',{callback_query_id:callback.id,text:result.rowCount?'Verified. Return to TelePaid.':'This request expired or was already confirmed.'});
   if(result.rowCount)await bot('editMessageText',{chat_id:callback.message.chat.id,message_id:callback.message.message_id,text:`@${username} verified. Return to ${config.origin}/#claims and finish within two minutes.`});
  }
  return {ok:true};
 });
}
