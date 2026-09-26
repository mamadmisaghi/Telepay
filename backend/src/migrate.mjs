import {readFile} from 'node:fs/promises';
import {database} from './db.mjs';
import {configFromEnv} from './config.mjs';
export async function migrate(db) {
  const sql=await readFile(new URL('../migrations/001_core.sql',import.meta.url),'utf8');
  await db.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(78219341)');await tx.query(sql);});
}
if(import.meta.url===`file://${process.argv[1]}`){const db=database(configFromEnv().databaseUrl);try{await migrate(db);console.log('Database migrations complete');}finally{await db.close();}}
