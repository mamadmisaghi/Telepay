import pg from 'pg';
export function database(url) {
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({connectionString:url,max:10});
  return {
    query:(sql,args)=>pool.query(sql,args),
    async transaction(fn) {
      const client = await pool.connect();
      try {await client.query('BEGIN'); const value=await fn(client);await client.query('COMMIT');return value;}
      catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    },
    async workerLock(fn) {
      const client=await pool.connect();
      try{const r=await client.query('SELECT pg_try_advisory_lock(78219342) AS locked');if(!r.rows[0].locked)return;await fn();}
      finally{await client.query('SELECT pg_advisory_unlock(78219342)');client.release();}
    },
    close:()=>pool.end(),
  };
}
