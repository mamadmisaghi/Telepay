import {migrate} from './migrate.mjs';
import {configFromEnv} from './config.mjs';
import {database} from './db.mjs';
const db=database(configFromEnv().databaseUrl);
try{await migrate(db);console.log('Database migrations complete');}finally{await db.close();}
await import('./bootstrap.mjs');
