import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function testDb(path=':memory:'){
 const sqlite=new DatabaseSync(path);
 sqlite.exec('CREATE TABLE IF NOT EXISTS qa_migrations(name TEXT PRIMARY KEY)');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())if(!sqlite.prepare('SELECT name FROM qa_migrations WHERE name=?').get(file)){sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));sqlite.prepare('INSERT INTO qa_migrations(name) VALUES(?)').run(file);}
 const make=(sql,args=[])=>({bind:(...values)=>make(sql,values),execute:()=>({results:sqlite.prepare(sql).all(...args),success:true}),first:async()=>sqlite.prepare(sql).all(...args)[0]||null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>({meta:sqlite.prepare(sql).run(...args),results:[]})});
 return {prepare:sql=>make(sql),batch:async statements=>{sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}},close:()=>sqlite.close(),sqlite};
}
