import {mkdir,chown} from 'node:fs/promises';
import {configFromEnv} from './config.mjs';
// Railway volumes are mounted at runtime. Prepare their ownership before dropping privileges.
const config=configFromEnv();
await mkdir(config.metadataDir,{recursive:true});
if(process.getuid?.()===0){await chown(config.metadataDir,1000,1000);process.setgid(1000);process.setuid(1000);}
await import('./main.mjs');
