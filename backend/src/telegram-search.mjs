import {TelegramClient,Api,Logger} from 'telegram';
import {StringSession} from 'telegram/sessions/index.js';

export function telegramSearch(config){
 let client,connecting,cooldown=0;
 const enabled=Boolean(config.telegramApiId&&config.telegramApiHash&&(config.telegramSearchSession||config.telegramBotToken));
 async function ready(){
  if(!enabled||Date.now()<cooldown)return null;
  if(connecting)return connecting;
  if(client?.connected)return client;
  connecting=(async()=>{
   client=new TelegramClient(new StringSession(config.telegramSearchSession||''),config.telegramApiId,config.telegramApiHash,{connectionRetries:2,requestRetries:2,timeout:8,floodSleepThreshold:0,baseLogger:new Logger('none')});
   if(config.telegramSearchSession){await client.connect();if(!await client.checkAuthorization())throw new Error('Search session expired');}
   else await client.start({botAuthToken:config.telegramBotToken});
   return client;
  })().catch(async()=>{cooldown=Date.now()+30000;await client?.disconnect();client=null;return null}).finally(()=>{connecting=null});
  return connecting;
 }
 async function run(fn){
  let timer;try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Lookup timeout')),10000)})]);}
  catch(e){cooldown=Date.now()+Math.min(3600,Number(e.seconds)||15)*1000;return null;}finally{clearTimeout(timer);}
 }
 async function profile(c,user){
  if(!user?.username||user.bot||user.deleted)return null;
  let photo=null;if(user.photo){try{const bytes=await c.downloadProfilePhoto(user,{isBig:false});if(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=150000)photo=`data:image/jpeg;base64,${bytes.toString('base64')}`;}catch{}}
  return {handle:user.username.toLowerCase(),name:[user.firstName,user.lastName].filter(Boolean).join(' ').slice(0,100)||user.username,photo,status:'found',source:'mtproto'};
 }
 return {
  enabled,global:Boolean(config.telegramSearchSession),
  async exact(handle){return run(async()=>{const c=await ready();if(!c)return null;const r=await c.invoke(new Api.contacts.ResolveUsername({username:handle}));return profile(c,r.users.find(u=>u.username?.toLowerCase()===handle));});},
  async search(q){if(!config.telegramSearchSession)return [];return await run(async()=>{const c=await ready();if(!c)return [];const r=await c.invoke(new Api.contacts.Search({q,limit:6}));return (await Promise.all(r.users.filter(u=>u.username&&!u.bot&&!u.deleted).slice(0,6).map(u=>profile(c,u)))).filter(Boolean);})||[];},
  async close(){await client?.disconnect();},
 };
}
