import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {hash} from './crypto.mjs';
import {need} from './errors.mjs';
export async function saveMetadata(config,input) {
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(input.image||'');
 need(match,400,'Upload a PNG, JPEG, or WebP image');const bytes=Buffer.from(match[2],'base64');need(bytes.length>12&&bytes.length<=2*1024*1024,400,'Image must be smaller than 2 MB');
 const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 need(valid,400,'Image contents do not match its type');
 await mkdir(config.metadataDir,{recursive:true});const imageName=`${hash(bytes)}.${match[1]}`;
 await writeFile(resolve(config.metadataDir,imageName),bytes,{flag:'w',mode:0o644});
 const image=`${config.origin}/api/metadata/${imageName}`;
 const doc=JSON.stringify({name:input.name,symbol:input.symbol,description:[input.description,`Fees to @${input.recipient.toLowerCase()} via TelePaid`].filter(Boolean).join('\n\n'),image,external_url:input.website||config.origin,properties:{category:'image',files:[{uri:image,type:`image/${match[1]}`}]},extensions:{telepaid:{recipient:input.recipient.toLowerCase(),recipient_share_bps:8000,project_share_bps:2000,mint_suffix:'TeLe'},telegram:input.telegram||undefined,twitter:input.twitter||undefined,website:input.website||undefined}});
 const filename=`${hash(doc)}.json`;await writeFile(resolve(config.metadataDir,filename),doc,{mode:0o644});
 return {uri:`${config.origin}/api/metadata/${filename}`,image};
}
export function metadataRoutes(app,config){app.get('/api/metadata/:filename',async(req,reply)=>{
 const filename=req.params.filename;need(/^[a-f0-9]{64}\.(png|jpeg|webp|json)$/.test(filename),404,'File not found');
 let bytes;try{bytes=await readFile(resolve(config.metadataDir,filename));}catch{need(false,404,'File not found');}
 const ext=filename.split('.').pop();reply.header('Cache-Control','public, max-age=31536000, immutable').type(ext==='json'?'application/json':`image/${ext}`);return reply.send(bytes);
});}
