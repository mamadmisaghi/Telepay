import {mkdir,writeFile,readFile,chmod,chown,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('./secrets/',import.meta.url));
await mkdir(dir,{recursive:true,mode:0o700});
let password;try{password=(await readFile(dir+'database_password','utf8')).trim();}catch{password=randomBytes(32).toString('hex');}
const values={database_password:password,database_url:`postgresql://telepaid:${password}@database:5432/telepaid`,encryption_key:randomBytes(32).toString('base64'),telegram_client_secret:'',solana_rpc_url:'',treasury_keypair:'',operator_keypair:''};
for(const[name,value]of Object.entries(values)){const file=dir+name;try{await stat(file);}catch{await writeFile(file,value+'\n',{flag:'wx',mode:name==='database_password'?0o644:0o600});}}
await chmod(dir,0o700);
if(process.getuid?.()===0){await chown(dir,1000,1000);for(const name of Object.keys(values))await chown(dir+name,1000,1000);}
console.log('Secret files initialized without printing values. Fill the empty files before starting services. Existing files were preserved.');
