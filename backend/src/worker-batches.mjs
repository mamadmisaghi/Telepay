// Durable round-robin batches: old tokens remain eligible regardless of launch volume.
export async function tokenBatch(db,kind,limit=20){
 if(!['market','fees','collection'].includes(kind))throw new Error('Unknown worker batch');
 await db.query('INSERT INTO worker_cursors(kind) VALUES($1) ON CONFLICT DO NOTHING',[kind]);
 const {rows:[cursor]}=await db.query('SELECT last_id FROM worker_cursors WHERE kind=$1',[kind]);
 const select=after=>db.query("SELECT l.* FROM launches l WHERE l.status='confirmed' AND ($1::text IS NULL OR l.id>$1) AND ($2::text='market' OR l.source='platform') AND ($2::text<>'fees' OR l.fee_mode='sharing-v1') ORDER BY l.id LIMIT $3",[after,kind,limit]);
 let {rows}=await select(cursor.last_id);if(!rows.length&&cursor.last_id)({rows}=await select(null));
 return rows;
}
export async function completeBatch(db,kind,rows){if(rows.length)await db.query('UPDATE worker_cursors SET last_id=$2 WHERE kind=$1',[kind,rows.at(-1).id]);}
export async function marketBatch({db,markets,log=console.error}){
 const rows=await tokenBatch(db,'market');
 for(let i=0;i<rows.length;i+=3)await Promise.all(rows.slice(i,i+3).map(async token=>{try{await markets.sync(token)}catch{log(JSON.stringify({event:'market_index_retry',token:token.id}))}}));
 await completeBatch(db,'market',rows);return rows.length;
}
