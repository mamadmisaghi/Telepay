// Exercise the built Cloudflare Worker, D1 and R2 without a browser or a dev server.
import '../scripts/sites-env.mjs';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare}=wranglerRequire('miniflare');
const {unstable_getMiniflareWorkerOptions}=require('wrangler');
export async function workerHarness(){
 const root=path.resolve('dist/server');
 const files=readdirSync(root,{recursive:true}).filter(f=>/\.(js|mjs)$/.test(f));
 files.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
 const bindings=JSON.parse(readFileSync('deploy/secrets/devnet-runtime.json','utf8'));
 const {workerOptions}=unstable_getMiniflareWorkerOptions('dist/server/wrangler.json');
 const modules=files.map(f=>({type:'ESModule',path:path.join(root,f)}));
 const mf=new Miniflare({...workerOptions,modulesRoot:root,modules,bindings,d1Databases:{DB:'telepaid-worker-qa'},r2Buckets:['BUCKET'],d1Persist:'backend/data/worker-d1',r2Persist:'backend/data/worker-r2',cf:false});
 const db=await mf.getD1Database('DB');
 await db.prepare('CREATE TABLE IF NOT EXISTS qa_migrations(name TEXT PRIMARY KEY)').run();
 for(const name of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()){
  if(await db.prepare('SELECT name FROM qa_migrations WHERE name=?').bind(name).first())continue;
  const queries=readFileSync('drizzle/'+name,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
  await db.batch([...queries.map(sql=>db.prepare(sql)),db.prepare('INSERT INTO qa_migrations(name) VALUES(?)').bind(name)]);
 }
 return {mf,db,fetch:(url,init)=>mf.dispatchFetch(url,init),close:()=>mf.dispose()};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const worker=await workerHarness();try{const response=await worker.fetch('https://telepaid.test/api/devnet/state');console.log(response.status,(await response.text()).slice(0,2500));}finally{await worker.close()}
}
