import {readFile,readdir} from 'node:fs/promises';
import {database} from './db.mjs';
import {configFromEnv} from './config.mjs';
export async function migrate(db) {
  const directory=new URL('../migrations/',import.meta.url);
  const files=(await readdir(directory)).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
  const sql=(await Promise.all(files.map(f=>readFile(new URL(f,directory),'utf8')))).join('\n');
  await db.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(78219341)');await tx.query(sql);});
}
if(import.meta.url===`file://${process.argv[1]}`){const db=database(configFromEnv().databaseUrl);try{await migrate(db);console.log('Database migrations complete');}finally{await db.close();}}
