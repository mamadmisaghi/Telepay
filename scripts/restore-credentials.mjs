// Restore the owner's encrypted checkpoint outside the repository.
// Usage: node scripts/restore-credentials.mjs KEY_FILE OUTPUT_DIRECTORY
import {readFileSync,writeFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';
import {createDecipheriv} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [keyFile,output]=process.argv.slice(2);
if(!keyFile||!output)throw new Error('Supply the recovery key file and a private output directory outside this repository.');
const keyText=readFileSync(keyFile,'utf8');
const match=/^RECOVERY_KEY=([A-Za-z0-9+/=]+)$/m.exec(keyText);
if(!match)throw new Error('Recovery key was not found.');
const bundle=JSON.parse(readFileSync(path.join(root,'deploy/credentials.enc.json'),'utf8'));
if(bundle.version!==1||bundle.algorithm!=='aes-256-gcm')throw new Error('Unsupported backup format.');
const decipher=createDecipheriv('aes-256-gcm',Buffer.from(match[1],'base64'),Buffer.from(bundle.iv,'base64'));
decipher.setAAD(Buffer.from('TelePaid credential checkpoint v1'));
decipher.setAuthTag(Buffer.from(bundle.tag,'base64'));
const archive=JSON.parse(Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext,'base64')),decipher.final()]).toString());
const destination=path.resolve(output);
if(existsSync(destination))throw new Error('Choose a new output directory to avoid overwriting any credentials.');
const parent=realpathSync(path.dirname(destination));
if(parent===root||parent.startsWith(root+path.sep))throw new Error('Restore outside the Git repository.');
mkdirSync(destination,{mode:0o700});
for(const item of archive.files){
 const target=path.resolve(destination,item.path);
 if(!target.startsWith(destination+path.sep))throw new Error('Invalid path in backup.');
 mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
 writeFileSync(target,Buffer.from(item.base64,'base64'),{flag:'wx',mode:0o600});
}
console.log(`Restored ${archive.files.length} files. Keep this directory private and transfer values into Railway Variables as needed.`);
