import {digestPayload} from './devnet-proof.mjs';
export const nonceHash=nonce=>digestPayload({nonce});
export async function botApi(env,method,body,fetcher=fetch){
 const response=await fetcher('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const data=await response.json();if(!data.ok)throw new Error('Telegram request failed');return data.result;
}
export async function telegramWebhook(request,env,{call=(method,body)=>botApi(env,method,body)}={}){
 const header=request.headers.get('x-telegram-bot-api-secret-token')||'';
 // Compare hashes so the length and prefix of the webhook secret are not leaked.
 const actual=await digestPayload(header),expected=await digestPayload(env.TELEGRAM_WEBHOOK_SECRET||'');
 let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
 if(!env.TELEGRAM_WEBHOOK_SECRET||diff)return Response.json({error:'Unauthorized'},{status:401});
 try{
  const raw=await request.text();if(raw.length>65536)return new Response('Too large',{status:413});const update=JSON.parse(raw),db=env.DB;
  const callback=update.callback_query,message=update.message;
  if(callback){
   const match=/^verify:([A-Za-z0-9_-]{32})$/.exec(callback.data||'');
   if(!match||callback.message?.chat?.type!=='private')return Response.json({ok:true});
   const hash=await nonceHash(match[1]),item=await db.prepare('SELECT * FROM sandbox_telegram WHERE nonce_hash=?').bind(hash).first();
   const handle=String(callback.from?.username||'').toLowerCase(),userId=String(callback.from?.id||'');
   if(!item||item.expires<Date.now()||item.consumed||!userId||String(callback.message.chat.id)!==userId){await call('answerCallbackQuery',{callback_query_id:callback.id,text:'This request expired. Start again from TelePay.',show_alert:true});return Response.json({ok:true})}
   if(!/^[a-z][a-z0-9_]{3,31}$/.test(handle)){await call('answerCallbackQuery',{callback_query_id:callback.id,text:'Set a public Telegram username in Settings, then retry.',show_alert:true});return Response.json({ok:true})}
   // A callback replay never refreshes the verification timestamp.
   const result=await db.prepare('UPDATE sandbox_telegram SET telegram_id=?,handle=?,verified_at=? WHERE nonce_hash=? AND verified_at IS NULL AND consumed=0 AND expires>? RETURNING nonce_hash').bind(userId,handle,Date.now(),hash,Date.now()).first();
   await call('answerCallbackQuery',{callback_query_id:callback.id,text:result?'Telegram verified. Return to TelePay and claim within 2 minutes.':'Already processed. Return to TelePay.'});
   if(result)await call('editMessageText',{chat_id:callback.message.chat.id,message_id:callback.message.message_id,text:`Verified @${handle} for Devnet wallet:\n${item.wallet}\n\nReturn to TelePay and claim within 2 minutes. This proof can be used for one claim only.`,reply_markup:{inline_keyboard:[[{text:'Return to TelePay',url:env.DEVNET_PUBLIC_ORIGIN+'/#claims'}]]}});
   return Response.json({ok:true});
  }
  if(message?.chat?.type==='private'&&String(message.chat.id)===String(message.from?.id)){
   const match=/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{32})$/.exec(message.text||'');
   if(!match){if(/^\/start/.test(message.text||''))await call('sendMessage',{chat_id:message.chat.id,text:'Open TelePay, connect your wallet, and choose Verify with Telegram to create a verification request.'});return Response.json({ok:true})}
   const hash=await nonceHash(match[1]),item=await db.prepare('SELECT * FROM sandbox_telegram WHERE nonce_hash=?').bind(hash).first();
   if(!item||item.expires<Date.now()||item.verified_at||item.consumed){await call('sendMessage',{chat_id:message.chat.id,text:'This request expired or has already been used. Start a new verification from TelePay.'});return Response.json({ok:true})}
   await call('sendMessage',{chat_id:message.chat.id,text:`TelePay Devnet verification\n\nConnect your current Telegram username to this wallet:\n${item.wallet}\n\nOnly confirm if this is your wallet and you started this request on TelePay. No mainnet funds are involved.`,reply_markup:{inline_keyboard:[[{text:'Confirm my wallet & username',callback_data:'verify:'+match[1]}]]}});
  }
  return Response.json({ok:true});
 }catch{console.error('Telegram webhook processing failed');return Response.json({error:'Retry delivery'},{status:503})}
}
