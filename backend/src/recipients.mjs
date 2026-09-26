import {telegramSearch} from './telegram-search.mjs';
import {need} from './errors.mjs';

const validHandle=/^[a-z][a-z0-9_]{3,31}$/;
const clean=s=>s.replace(/<[^>]*>/g,'').replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();
export function parsePublicProfile(html,handle){
 const title=html.match(/<div\b[^>]*class="tgme_page_title[^"\n]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
 const extra=html.match(/<div\b[^>]*class="tgme_page_extra[^"\n]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
 // Telegram's generic contact landing page is not proof that an account exists.
 if(!title||clean(extra||'').toLowerCase()!=='@'+handle||!/>\s*Send Message\s*<\/a>/i.test(html))return null;
 const raw=html.match(/<img\b[^>]*class="tgme_page_photo_image"[^>]*src="([^"]+)"/i)?.[1];
 let photo=null;try{const url=new URL(clean(raw||''));if(url.protocol==='https:'&&/^(?:cdn\d*\.telesco\.pe|(?:[a-z0-9-]+\.)?telegram\.org|t\.me)$/.test(url.hostname))photo=url.href;}catch{}
 return {handle,name:clean(title).slice(0,100),photo,source:'public_profile',status:'found'};
}
export const normalizeRecipient=value=>String(value||'').trim().replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i,'').replace(/^@/,'').replace(/\/$/,'').toLowerCase();
export function recipientRoutes(app,{db,config,fetcher=fetch}){
 const cache=new Map(),pending=new Map(),remote=telegramSearch(config);app.addHook('onClose',()=>remote.close());
 async function bot(method,body){
  const r=await fetcher(`https://api.telegram.org/bot${config.telegramBotToken}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  const j=await r.json();if(!r.ok||!j.ok)return null;return j.result;
 }
 async function find(handle,{refresh=false}={}){
  if(refresh)cache.delete(handle);
  const cached=cache.get(handle);if(cached&&cached.expires>Date.now())return cached.value;
  if(pending.has(handle))return pending.get(handle);
  const job=(async()=>{
   let value=remote.enabled?await remote.exact(handle):null;
   // Existing IDs are only an API lookup hint. Always compare today's username;
   // they never become the fee beneficiary or prove future ownership.
   if(!value&&config.telegramBotToken){
    const {rows}=await db.query('SELECT id FROM telegram_directory WHERE handle=$1 UNION SELECT id FROM users WHERE lower(username)=$1 LIMIT 6',[handle]);
    for(const row of rows){if(!/^\d+$/.test(row.id))continue;
     try{const chat=await bot('getChat',{chat_id:row.id});if(chat?.type!=='private'||chat.username?.toLowerCase()!==handle)continue;
      let photo=null;
      if(chat.photo?.small_file_id){try{const file=await bot('getFile',{file_id:chat.photo.small_file_id});if(file?.file_path&&/^[a-zA-Z0-9_/-]+\.(?:jpg|jpeg|png)$/.test(file.file_path)){
       const r=await fetcher(`https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`,{signal:AbortSignal.timeout(5000)});const bytes=Buffer.from(await r.arrayBuffer());if(r.ok&&bytes.length<=150000)photo=`data:image/${file.file_path.endsWith('.png')?'png':'jpeg'};base64,${bytes.toString('base64')}`;
      }}catch{}}
      value={handle,name:[chat.first_name,chat.last_name].filter(Boolean).join(' ').slice(0,100)||handle,photo,source:'telegram',status:'found'};break;
     }catch{}
    }
   }
   if(!value){try{const r=await fetcher(`https://t.me/${handle}`,{redirect:'error',signal:AbortSignal.timeout(5000)});if(r.ok){const html=await r.text();if(html.length<300000)value=parsePublicProfile(html,handle);}}catch{}}
   value??={handle,name:handle,photo:null,status:'unavailable'};
   if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(handle,{value,expires:Date.now()+(value.status==='found'?60000:15000)});return value;
  })();pending.set(handle,job);try{return await job}finally{pending.delete(handle)}
 }
 app.get('/api/public/recipients',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async req=>{
  const q=normalizeRecipient(req.query.q);need(/^[a-z][a-z0-9_]{2,31}$/.test(q),400,'Enter at least 3 username characters');
  const {rows}=await db.query("SELECT recipient_handle AS handle FROM launches WHERE status='confirmed' AND starts_with(recipient_handle,$1) UNION SELECT handle FROM telegram_directory WHERE starts_with(handle,$1) ORDER BY handle LIMIT 6",[q]);
  const handles=[...new Set([...(validHandle.test(q)?[q]:[]),...rows.map(r=>r.handle)])];
  const suggestions=await remote.search(q);for(const value of suggestions)cache.set(value.handle,{value,expires:Date.now()+60000});
  handles.push(...suggestions.map(r=>r.handle).filter(h=>!handles.includes(h)));
  const result=await Promise.all(handles.map(handle=>find(handle,{refresh:req.query.refresh==='1'})));return {results:result.filter(r=>r.status==='found'),exactStatus:result.find(r=>r.handle===q)?.status||'incomplete',scope:remote.global?'telegram_search':remote.enabled?'telegram_exact':'exact_and_opted_in_recipients'};
 });
 return {find};
}
