import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import {botAuthRoutes,launcherFor} from './bot-auth.mjs';
import {authRoutes,sessionFor} from './auth.mjs';
import {marketRoutes} from './market.mjs';
import {recipientRoutes} from './recipients.mjs';
import {launchRoutes} from './launches.mjs';
import {metadataRoutes,compactMetadataRoutes,tokenSocials} from './metadata.mjs';
import {reserveClaim,normalizeHandle} from './ledger.mjs';
import {readiness} from './config.mjs';
import {equal} from './crypto.mjs';
import {need} from './errors.mjs';

export async function buildApp({db,config,chain,verifyIdentity,fetcher,logger=false}) {
 const app=Fastify({logger,bodyLimit:3*1024*1024,trustProxy:1});
 await app.register(cookie);await app.register(helmet,{contentSecurityPolicy:false});await app.register(rateLimit,{max:120,timeWindow:'1 minute'});
 app.setErrorHandler((err,req,reply)=>{
  const status=err.statusCode|| (err.name==='ZodError'?400:500);
  // Log codes and request IDs only, never request bodies, signatures, cookies, or secrets.
  if(status>=500)req.log.error({code:err.code||err.name,requestId:req.id},'Request failed');
  reply.code(status).send({error:status>=500?'Service is not ready. Please try again shortly.':err.name==='ZodError'?'Check the token details and try again.':err.message});
 });
 app.addHook('onRequest',async(req,reply)=>{
  // Keep the healthcheck alive while all public routes, static assets and API
  // endpoints are temporarily unavailable. The fee worker is a separate service.
  if(config.sitePaused && req.url.split('?')[0]!=='/api/health'){
   reply.code(503).header('Cache-Control','no-store').header('Retry-After','3600').send();
   return;
  }
  // Public static files never bypass authentication for /api routes.
  if(config.staticDir&&!req.url.split('?')[0].startsWith('/api/')&&['GET','HEAD'].includes(req.method))return;
  if(!req.url.startsWith('/api/metadata/')&&!req.url.startsWith('/api/m/'))reply.header('Cache-Control','no-store');
  const path=req.url.split('?')[0];
  const publicGet=req.method==='GET'&&(path==='/api/health'||path==='/api/runtime'||path==='/api/session'||path.startsWith('/api/auth/telegram')||path.startsWith('/api/public/')||path.startsWith('/api/metadata/')||path.startsWith('/api/m/'));
  if(publicGet||req.method==='GET'&&path==='/api/auth/wallet/session')return;
  if(req.method==='POST'&&path==='/api/telegram/webhook')return;
  // Signing out must work even when only a wallet launcher session remains.
  if(req.method==='POST'&&path==='/api/auth/logout'){need(req.headers.origin===config.origin,403,'Request origin did not match');return;}
  if(req.method==='POST'&&['/api/auth/wallet/start','/api/auth/wallet/finish','/api/auth/bot/start','/api/auth/bot/finish'].includes(path)){need(req.headers.origin===config.origin,403,'Request origin did not match');return;}
  if(path.startsWith('/api/launches')){const launcher=await launcherFor(db,req);if(launcher){req.launcher=launcher;req.session=launcher;if(req.method!=='GET'){need(req.headers.origin===config.origin,403,'Request origin did not match');need(equal(req.headers['x-csrf-token'],launcher.csrf),403,'Verify your wallet again');}return;}}
  req.session=await sessionFor(db,req);need(req.session,401,'Sign in with Telegram to continue');
  if(req.method!=='GET'&&req.method!=='HEAD'){
   need(req.headers.origin===config.origin,403,'Request origin did not match');
   need(equal(req.headers['x-csrf-token'],req.session.csrf),403,'Refresh the page and try again');
  }
 });
 app.get('/api/health',async()=>{await db.query('SELECT 1');return {ok:true};});
 app.get('/api/runtime',async()=>({...readiness(config),minimumClaimLamports:config.minimumClaim.toString()}));
 // Aggregate availability only: never reveal mint addresses or private keys.
 app.get('/api/public/mint-availability',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async()=>{
  const {rows:[pool]}=await db.query("SELECT count(*)::int AS ready FROM mint_pool WHERE status='ready' AND suffix=$1",[config.suffix]);
  return {suffix:config.suffix,readyMints:pool.ready};
 });
 botAuthRoutes(app,{db,config,fetcher});authRoutes(app,{db,config,verifyIdentity,fetcher});const recipients=recipientRoutes(app,{db,config,fetcher});launchRoutes(app,{db,config,chain,resolveRecipient:recipients.find});metadataRoutes(app,config);compactMetadataRoutes(app,config);marketRoutes(app,{db,chain,config});
 app.get('/api/public/tokens',async req=>{
  const search=String(req.query.q||'').slice(0,80),offset=Math.max(0,Math.min(100000,Number(req.query.offset)||0));
  const {rows}=await db.query("SELECT l.id,l.mint,l.source,l.wallet AS launcher_wallet,l.name,l.symbol,l.description,l.image_uri,l.recipient_handle,l.confirmed_at,l.signature,COALESCE(f.earned,'0') AS earned_lamports,COALESCE(f.gross,'0') AS collected_lamports,CASE WHEN m.updated_at>now()-interval '90 seconds' AND m.sol_usd_at>now()-interval '3 minutes' THEN m.spot_price_sol*m.sol_usd*m.supply ELSE NULL END AS market_cap_usd,(SELECT max(t.traded_at) FROM market_trades t WHERE t.launch_id=l.id) AS last_trade_at FROM launches l LEFT JOIN market_state m ON m.launch_id=l.id LEFT JOIN (SELECT launch_id,sum(recipient) AS earned,sum(gross) AS gross FROM fee_events GROUP BY launch_id) f ON f.launch_id=l.id WHERE l.status='confirmed' AND (l.name ILIKE $1 OR l.symbol ILIKE $1 OR l.recipient_handle ILIKE $1) ORDER BY l.confirmed_at DESC LIMIT 48 OFFSET $2",[`%${search}%`,offset]);return {tokens:rows};
 });
 app.get('/api/public/profiles',async req=>{
  const offset=Math.max(0,Math.min(100000,Math.floor(Number(req.query.offset)||0)));
  const {rows}=await db.query("SELECT l.recipient_handle AS handle,count(*)::int AS token_count,COALESCE(b.earned,0)::text AS earned_lamports,max(l.confirmed_at) AS latest_launch_at FROM launches l LEFT JOIN balances b ON b.handle=l.recipient_handle WHERE l.status='confirmed' AND l.source='platform' GROUP BY l.recipient_handle,b.earned ORDER BY latest_launch_at DESC,l.recipient_handle ASC LIMIT 25 OFFSET $1",[offset]);
  const page=rows.slice(0,24),profiles=[];
  // Bound Telegram lookups: a large public directory must not open dozens of
  // concurrent MTProto or HTTP requests. The existing resolver caches results.
  for(let i=0;i<page.length;i+=6){
   const group=await Promise.all(page.slice(i,i+6).map(async row=>{
    try{const identity=await recipients.find(row.handle);return {...row,name:identity.status==='found'?identity.name:row.handle,photo:identity.status==='found'?identity.photo:null};}
    catch{return {...row,name:row.handle,photo:null};}
   }));profiles.push(...group);
  }
  return {profiles,nextOffset:rows.length>24?offset+24:null};
 });
 app.get('/api/public/token/:id',async req=>{
  const {rows:[token]}=await db.query("SELECT l.id,l.mint,l.source,l.wallet AS launcher_wallet,l.name,l.symbol,l.description,l.metadata_uri,l.image_uri,l.recipient_handle,l.confirmed_at,l.signature,COALESCE(f.earned,0)::text AS earned_lamports,COALESCE(f.gross,0)::text AS collected_lamports FROM launches l LEFT JOIN (SELECT launch_id,sum(recipient) AS earned,sum(gross) AS gross FROM fee_events GROUP BY launch_id) f ON f.launch_id=l.id WHERE l.status='confirmed' AND l.id=$1",[req.params.id]);need(token,404,'Token not found');const {metadata_uri,...publicToken}=token;return {...publicToken,socials:token.source==='platform'?await tokenSocials(config,metadata_uri):{website:null,telegram:null,twitter:null}};
 });
 app.get('/api/public/analytics' ,async()=>{
  const {rows:[fees]}=await db.query('SELECT COALESCE(sum(gross),0)::text AS collected,COALESCE(sum(recipient),0)::text AS recipients,COALESCE(sum(project),0)::text AS project FROM fee_events');
  const {rows:[claims]}=await db.query("SELECT COALESCE(sum(amount),0)::text AS claimed FROM claims WHERE status='confirmed'");
  const {rows:[balances]}=await db.query('SELECT COALESCE(sum(earned-settled),0)::text AS unclaimed,COALESCE(sum(reserved),0)::text AS pending FROM balances');
  const {rows:[count]}=await db.query("SELECT count(*)::int AS tokens FROM launches WHERE status='confirmed'");
  const {rows:daily}=await db.query("SELECT date_trunc('day',received_at) AS day,sum(gross)::text AS collected FROM fee_events WHERE received_at>=date_trunc('day',now() AT TIME ZONE 'UTC')-interval '29 days' GROUP BY 1 ORDER BY 1");
  const {rows:recent}=await db.query("SELECT e.event_id,e.signature,e.recipient_handle,e.gross::text,e.recipient::text,e.project::text,e.received_at,l.id AS launch_id,l.name AS token_name,l.image_uri AS token_image FROM fee_events e JOIN launches l ON l.id=e.launch_id WHERE l.status='confirmed' ORDER BY e.received_at DESC,e.event_id DESC LIMIT 20");
  const {rows:recentClaims}=await db.query("SELECT id,handle,amount::text,signature,confirmed_at FROM claims WHERE status='confirmed' ORDER BY confirmed_at DESC,id DESC LIMIT 20");
  const {rows:topTokens}=await db.query("SELECT l.id,l.name,l.symbol,l.image_uri,l.recipient_handle,COALESCE(sum(e.recipient),0)::text AS earned_lamports FROM launches l LEFT JOIN fee_events e ON e.launch_id=l.id WHERE l.status='confirmed' AND l.source='platform' GROUP BY l.id,l.name,l.symbol,l.image_uri,l.recipient_handle ORDER BY COALESCE(sum(e.recipient),0) DESC,l.confirmed_at DESC LIMIT 10");
  const {rows:topRecipients}=await db.query("SELECT l.recipient_handle AS handle,COALESCE(b.earned,0)::text AS earned_lamports FROM (SELECT DISTINCT recipient_handle FROM launches WHERE status='confirmed' AND source='platform') l LEFT JOIN balances b ON b.handle=l.recipient_handle ORDER BY COALESCE(b.earned,0) DESC,l.recipient_handle LIMIT 10");
  return {...fees,...claims,...balances,...count,daily,recent,recentClaims,topTokens,topRecipients};
 });
 app.get('/api/public/profile/:handle',async req=>{
  const handle=normalizeHandle(req.params.handle);need(/^[a-z][a-z0-9_]{3,31}$/.test(handle),400,'Invalid Telegram username');
  const offset=Math.max(0,Math.min(100000,Math.floor(Number(req.query.offset)||0)));
  const {rows:[balance]}=await db.query('SELECT earned::text,settled::text,reserved::text FROM balances WHERE handle=$1',[handle]);
  const {rows:tokens}=await db.query("SELECT l.id,l.mint,l.name,l.symbol,l.description,l.image_uri,l.confirmed_at,l.recipient_handle,l.signature,COALESCE(f.earned,0)::text AS earned_lamports,COALESCE(f.gross,0)::text AS collected_lamports FROM launches l LEFT JOIN (SELECT launch_id,sum(recipient) AS earned,sum(gross) AS gross FROM fee_events GROUP BY launch_id) f ON f.launch_id=l.id WHERE l.recipient_handle=$1 AND l.status='confirmed' ORDER BY l.confirmed_at DESC,l.id DESC LIMIT 49 OFFSET $2",[handle,offset]);
  return {handle,balance:balance||{earned:'0',settled:'0',reserved:'0'},tokens:tokens.slice(0,48),nextOffset:tokens.length>48?offset+48:null};
 });
 app.get('/api/claims',async req=>{const {rows}=await db.query('SELECT id,handle,wallet,amount::text,status,signature,created_at FROM claims WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.session.user_id]);return {claims:rows};});
 app.post('/api/claims',async req=>{
  need(config.payoutsEnabled,503,'Claims are not enabled yet');const {amount,wallet}=req.body||{};const key=req.headers['idempotency-key'];
  need(typeof amount==='string'&&/^\d{1,20}$/.test(amount)&&typeof wallet==='string',400,'Invalid claim');need(typeof key==='string'&&key.length>=16&&key.length<=100,400,'A unique request key is required');
  return reserveClaim(db,{userId:req.session.user_id,handle:req.session.username,wallet,amount:BigInt(amount),idempotencyKey:key,minimum:config.minimumClaim,sessionHash:req.session.token_hash});
 });
 if(config.staticDir)await app.register(fastifyStatic,{root:config.staticDir,dotfiles:'deny',index:['index.html'],maxAge:'1h',setHeaders(res,path){if(path.endsWith('/index.html'))res.header('Cache-Control','no-cache');}});
 return app;
}
