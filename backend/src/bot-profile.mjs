import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Run after the server starts. The durable marker avoids adding another photo
// every time Railway restarts the process; changing the image or origin retries.
export async function configureBotProfile(config,{fetcher=fetch}={}){
 if(!config.telegramBotToken||!config.staticDir)return {skipped:true};
 const root=`https://api.telegram.org/bot${config.telegramBotToken}/`;
 const call=async(method,body)=>{
  const response=await fetcher(root+method,{method:'POST',body:body instanceof FormData?body:JSON.stringify(body),headers:body instanceof FormData?undefined:{'content-type':'application/json'},signal:AbortSignal.timeout(12000)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(`Telegram ${method} failed (${response.status})`);
  return data.result;
 };
 const me=await call('getMe',{});
 if(me.username)config.telegramBotUsername=me.username;
 const photo=await readFile(join(config.staticDir,'telepay-bot-avatar.jpg'));
 const marker=join(config.metadataDir,'.bot-profile-version');
 const fingerprint=createHash('sha256').update('telepay-bot-profile-v1').update(config.origin).update(String(me.id)).update(photo).digest('hex');
 try{if((await readFile(marker,'utf8')).trim()===fingerprint)return {skipped:true,username:me.username};}catch{}
 await call('setMyName',{name:'TelePay'});
 await call('setMyDescription',{description:'Create a token. Route creator fees to a Telegram username. Verify your account and claim your share on Solana. Visit TelePay.live or follow @UseTelePay on X.'});
 await call('setMyShortDescription',{short_description:'Create a token. Route fees to any Telegram user. Verify and claim on Solana.'});
 await call('setMyCommands',{commands:[
  {command:'start',description:'Welcome to TelePay'},
  {command:'claims',description:'Verify and view your fees'},
  {command:'launch',description:'Launch a token'},
  {command:'discover',description:'List your public username'},
  {command:'remove',description:'Leave recipient suggestions'},
  {command:'help',description:'How TelePay works'}
 ]});
 await call('setChatMenuButton',{menu_button:{type:'commands'}});
 const upload=new FormData();
 upload.append('photo',JSON.stringify({type:'static',photo:'attach://telepay_photo'}));
 upload.append('telepay_photo',new Blob([photo],{type:'image/jpeg'}),'telepay-photo.jpg');
 await call('setMyProfilePhoto',upload);
 await writeFile(marker,fingerprint,'utf8');
 return {updated:true,username:me.username};
}
