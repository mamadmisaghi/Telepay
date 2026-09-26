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
 const doc=JSON.stringify({name:input.name,symbol:input.symbol,description:[input.description,`Fees to @${input.recipient.toLowerCase()} via TelePay`].filter(Boolean).join('\n\n'),image,external_url:input.website||config.origin,properties:{category:'image',files:[{uri:image,type:`image/${match[1]}`}]},extensions:{telepaid:{recipient:input.recipient.toLowerCase(),recipient_share_bps:8000,project_share_bps:2000,mint_suffix:'TeLe'},telegram:input.telegram||undefined,twitter:input.twitter||undefined,website:input.website||undefined}});
 const filename=`${hash(doc)}.json`;await writeFile(resolve(config.metadataDir,filename),doc,{mode:0o644});
 return {uri:await compactMetadata(config,`${config.origin}/api/metadata/${filename}`),image};
}
// Existing launches carry their original links in the immutable on-chain
// metadata. Read the local content-addressed copy rather than trusting a URL
// supplied by a caller or doing an outbound fetch in a public API request.
export async function tokenSocials(config,uri){
 const empty={website:null,telegram:null,twitter:null};
 try{
  const path=new URL(uri).pathname;
  const compact=/^\/api\/m\/([A-Za-z0-9_-]{22})$/.exec(path);
  const long=/^\/api\/metadata\/([a-f0-9]{64}\.json)$/.exec(path);
  if(!compact&&!long)return empty;
  const file=compact?`${compact[1]}.json`:long[1];
  const doc=JSON.parse(await readFile(resolve(config.metadataDir,file),'utf8'));
  const links=doc.extensions||{};
  const safe=value=>{
   if(typeof value!=='string'||value.length>200)return null;
   try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.toString():null;}catch{return null;}
  };
  return {website:safe(links.website),telegram:safe(links.telegram),twitter:safe(links.twitter)};
 }catch{return empty;}
}
export function metadataRoutes(app,config){app.get('/api/metadata/:filename',async(req,reply)=>{
 const filename=req.params.filename;need(/^[a-f0-9]{64}\.(png|jpeg|webp|json)$/.test(filename),404,'File not found');
 let bytes;try{bytes=await readFile(resolve(config.metadataDir,filename));}catch{need(false,404,'File not found');}
 const ext=filename.split('.').pop();
 // Existing launches keep their original Railway image URLs after a custom-domain switch.
 // These public token images must remain embeddable from the new site origin.
 if(ext!=='json')reply.header('Cross-Origin-Resource-Policy','cross-origin');
 reply.header('Cache-Control','public, max-age=31536000, immutable').type(ext==='json'?'application/json':`image/${ext}`);
 return reply.send(bytes);
});}

// A compact content-addressed URI keeps atomic create + buy below Solana's packet limit.
// Existing full metadata URLs remain available indefinitely.
export async function compactMetadata(config,uri){
 if(uri.startsWith(`${config.origin}/api/m/`))return uri;
 const filename=uri.startsWith(`${config.origin}/api/metadata/`)?uri.split('/').pop():'';
 need(/^[a-f0-9]{64}\.json$/.test(filename),422,'This launch metadata must be prepared again');
 const doc=await readFile(resolve(config.metadataDir,filename));
 const id=Buffer.from(hash(doc),'hex').subarray(0,16).toString('base64url');
 const path=resolve(config.metadataDir,`${id}.json`);
 try{await writeFile(path,doc,{flag:'wx',mode:0o644});}catch(e){if(e.code!=='EEXIST')throw e;need((await readFile(path)).equals(doc),500,'Metadata alias collision');}
 return `${config.origin}/api/m/${id}`;
}
export function compactMetadataRoutes(app,config){app.get('/api/m/:id',async(req,reply)=>{
 need(/^[A-Za-z0-9_-]{22}$/.test(req.params.id),404,'File not found');
 let bytes;try{bytes=await readFile(resolve(config.metadataDir,`${req.params.id}.json`));}catch{need(false,404,'File not found');}
 return reply.header('Cache-Control','public, max-age=31536000, immutable').type('application/json').send(bytes);
});}
