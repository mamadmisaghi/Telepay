// Durable pagination: never advance a cursor past an unprocessed transaction.
export async function indexAddress({db,connection,launchId,address,kind,process,limit=30}){
 const key=address.toBase58();
 await db.query('INSERT INTO index_cursors(launch_id,address,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[launchId,key,kind]);
 const {rows:[cursor]}=await db.query('SELECT * FROM index_cursors WHERE launch_id=$1 AND address=$2 AND kind=$3',[launchId,key,kind]);
 const page=await connection.getSignaturesForAddress(address,{limit,...(cursor.before_signature?{before:cursor.before_signature}:{}),...(cursor.head?{until:cursor.head}:{})},'finalized');
 for(let i=0;i<page.length;i+=3)await Promise.all(page.slice(i,i+3).map(process));
 const target=cursor.target_head||page[0]?.signature||cursor.head;
 const done=page.length<limit;
 await db.query('UPDATE index_cursors SET head=$4,target_head=$5,before_signature=$6,backfill_done=backfill_done OR $7 WHERE launch_id=$1 AND address=$2 AND kind=$3',[launchId,key,kind,done?target:cursor.head,done?null:target,done?null:page.at(-1).signature,done]);
 return {complete:done&&Boolean(cursor.backfill_done||done)};
}
