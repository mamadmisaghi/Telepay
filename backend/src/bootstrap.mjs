// Idempotently import privately generated mint keys; never reset reserved/consumed rows.
import {configFromEnv} from './config.mjs';
import {database} from './db.mjs';
import {readKey,chainService} from './chain.mjs';
import {encrypt} from './crypto.mjs';
import {assertLaunchMint} from '../../lib/domain/launch-policy.ts';
const config=configFromEnv(),db=database(config.databaseUrl);
try{
 const values=JSON.parse(process.env.MINT_POOL_KEYPAIRS||'[]');
 if(!Array.isArray(values)||values.length>100)throw new Error('Invalid mint pool');
 const chain=chainService(config);if(values.length)await chain.checkNetwork();
 for(const value of values){const key=readKey(value),address=key.publicKey.toBase58();assertLaunchMint(address,config.suffix);
  const existing=await db.query('SELECT address FROM mint_pool WHERE address=$1',[address]);if(existing.rowCount)continue;
  if(await chain.connection.getAccountInfo(key.publicKey,'finalized'))throw new Error('Mint already exists on configured chain');
  await db.query('INSERT INTO mint_pool(address,secret_encrypted,suffix) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[address,encrypt(key.secretKey,config.encryptionKey,`mint:${address}`),config.suffix]);
 }
 console.log(JSON.stringify({event:'mint_pool_ready',count:(await db.query("SELECT count(*)::int AS count FROM mint_pool WHERE status='ready'")).rows[0].count}));
}finally{await db.close();}
