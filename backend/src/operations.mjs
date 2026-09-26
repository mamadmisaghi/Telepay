import {readKey} from './chain.mjs';
export async function operationalCheck({db,chain,config,log=console.log}){
 const {rows:[counts]}=await db.query("SELECT (SELECT count(*)::int FROM mint_pool WHERE status='ready') AS ready_mints,(SELECT count(*)::int FROM launches WHERE status='confirmed') AS confirmed_tokens,(SELECT count(*)::int FROM jobs WHERE status IN ('queued','submitted') AND created_at<now()-interval '10 minutes') AS delayed_jobs,(SELECT count(*)::int FROM launches l LEFT JOIN market_state m ON m.launch_id=l.id WHERE l.status='confirmed' AND (m.updated_at IS NULL OR m.updated_at<now()-interval '5 minutes')) AS stale_markets");
 const {rows:[b]}=await db.query('SELECT COALESCE(sum(earned-settled),0)::text AS liabilities FROM balances');
 const operator=config.operatorSecret?readKey(config.operatorSecret).publicKey:null,treasury=config.treasurySecret?readKey(config.treasurySecret).publicKey:null;
 const [gas,funds]=await Promise.all([operator?chain.connection.getBalance(operator,'finalized'):null,treasury?chain.connection.getBalance(treasury,'finalized'):null]);
 const alerts=[];if(counts.ready_mints<5)alerts.push('mint_pool_low');if(gas===null||gas<1000000)alerts.push('operator_unfunded');if(funds!==null&&BigInt(funds)<BigInt(b.liabilities))alerts.push('treasury_underfunded');if(counts.delayed_jobs)alerts.push('delayed_jobs');if(counts.stale_markets)alerts.push('stale_markets');
 const details={...counts,treasuryAddress:treasury?.toBase58()||null,operatorAddress:operator?.toBase58()||null,operatorLamports:gas,treasuryLamports:funds,liabilitiesLamports:b.liabilities,collectionsEnabled:config.collectionsEnabled,payoutsEnabled:config.payoutsEnabled,vanityAuto:config.vanityAuto,alerts};
 await db.query("INSERT INTO operational_status(name,details) VALUES('worker',$1) ON CONFLICT(name) DO UPDATE SET details=EXCLUDED.details,updated_at=now()",[JSON.stringify(details)]);
 log(JSON.stringify({event:'operations_status',...details}));return details;
}
