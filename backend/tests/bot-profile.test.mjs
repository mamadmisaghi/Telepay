import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureBotProfile} from '../src/bot-profile.mjs';

test('Telegram profile uses the complete supplied JPG, links, commands and a durable version marker',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'telepay-bot-'));
 try{
  const jpg=Buffer.from([0xff,0xd8,0xff,0xd9]);
  await writeFile(join(dir,'telepay-bot-avatar.jpg'),jpg);
  const config={telegramBotToken:'fixture-token',staticDir:dir,metadataDir:dir,origin:'https://example.test',telegramBotUsername:'OldBot'};
  const calls=[];
  const fetcher=async(url,options)=>{
   const method=url.split('/').pop();calls.push({method,body:options.body});
   return {ok:true,status:200,json:async()=>({ok:true,result:method==='getMe'?{id:42,username:'TelePayFunBot'}:true})};
  };
  const first=await configureBotProfile(config,{fetcher});
  assert.equal(first.updated,true);assert.equal(config.telegramBotUsername,'TelePayFunBot');
  assert.deepEqual(calls.map(c=>c.method),['getMe','setMyName','setMyDescription','setMyShortDescription','setMyCommands','setChatMenuButton','setMyProfilePhoto']);
  assert.equal(JSON.parse(calls.find(c=>c.method==='setMyName').body).name,'TelePay');
  assert.match(JSON.parse(calls.find(c=>c.method==='setMyDescription').body).description,/TelePay\.live/);
  assert.deepEqual(new Uint8Array(await calls.at(-1).body.get('telepay_photo').arrayBuffer()),new Uint8Array(jpg));
  assert.equal((await configureBotProfile(config,{fetcher})).skipped,true);
  assert.equal(calls.filter(c=>c.method==='setMyProfilePhoto').length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
