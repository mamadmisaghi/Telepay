import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApp} from '../src/app.mjs';
import {configFromEnv} from '../src/config.mjs';

test('Railway serves the approved frontend while API authentication remains enforced',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'telepaid-static-'));
 await writeFile(join(directory,'index.html'),'<!doctype html><title>TelePaid</title>');
 await writeFile(join(directory,'logo.svg'),'<svg/>');
 await writeFile(join(directory,'.private'),'never serve');
 const config=configFromEnv({PUBLIC_ORIGIN:'https://telepaid.example',NODE_ENV:'production',STATIC_DIR:directory,UI_MODE:'preview',PRIVY_APP_ID:'public-app-id'});
 const db={query:async()=>({rows:[]})};
 const app=await buildApp({db,config,chain:{}});
 try{
  const page=await app.inject('/');assert.equal(page.statusCode,200);assert.match(page.body,/TelePaid/);
  assert.equal((await app.inject('/logo.svg')).statusCode,200);
  assert.notEqual((await app.inject('/.private')).statusCode,200);
  assert.equal((await app.inject('/api/health')).statusCode,200);
  const runtime=(await app.inject('/api/runtime')).json();assert.equal(runtime.mode,'preview');assert.equal(runtime.launch,false);assert.equal(runtime.claims,false);
  assert.equal((await app.inject({method:'POST',url:'/api/claims',payload:{}})).statusCode,401);
  assert.equal((await app.inject('/api/claims')).statusCode,401);
 }finally{await app.close();await rm(directory,{recursive:true});}
});
