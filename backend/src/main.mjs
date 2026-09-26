import {configFromEnv} from './config.mjs';
import {database} from './db.mjs';
import {chainService} from './chain.mjs';
import {buildApp} from './app.mjs';
import {configureBotProfile} from './bot-profile.mjs';
const config=configFromEnv(),db=database(config.databaseUrl),chain=chainService(config);
const app=await buildApp({db,config,chain,logger:{redact:['req.headers.cookie','req.headers.authorization','req.headers.x-csrf-token'],level:'info'}});
await app.listen({host:'0.0.0.0',port:config.port});
void configureBotProfile(config).then(result=>{
 if(result.updated)app.log.info({botUsername:result.username},'Telegram bot profile updated');
}).catch(error=>app.log.error({message:error.message},'Telegram bot profile update failed'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();await db.close();process.exit(0);});
