import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import {botAuthRoutes,launcherFor} from './bot-auth.mjs';
import {authRoutes,sessionFor} from './auth.mjs';
import {launchRoutes} from './launches.mjs';
import {metadataRoutes} from './metadata.mjs';
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
  // Public static files never bypass authentication for /api routes.
  if(config.staticDir&&!req.url.split('?')[0].startsWith('/api/')&&['GET','HEAD'].includes(req.method))return;
  if(!req.url.startsWith('/api/metadata/'))reply.header('Cache-Control','no-store');
  const path=req.url.split('?')[0];
  const publicGet=req.method==='GET'&&(path==='/api/health'||path==='/api/runtime'||path==='/api/session'||path.startsWith('/api/auth/telegram')||path.startsWith('/api/public/')||path.startsWith('/api/metadata/'));
  if(publicGet||req.method==='GET'&&path==='/api/auth/wallet/session')return;
  if(req.method==='POST'&&path==='/api/telegram/webhook')return;
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
 botAuthRoutes(app,{db,config,fetcher});authRoutes(app,{db,config,verifyIdentity,fetcher});launchRoutes(app,{db,config,chain});metadataRoutes(app,config);
 app.get('/api/public/tokens',async req=>{
  const search=String(req.query.q||'').slice(0,80),offset=Math.max(0,Math.min(100000,Number(req.query.offset)||0));
  const {rows}=await db.query("SELECT l.id,l.mint,l.name,l.symbol,l.description,l.image_uri,l.recipient_handle,l.confirmed_at,l.signature,COALESCE(f.earned,'0') AS earned_lamports,COALESCE(f.gross,'0') AS collected_lamports FROM launches l LEFT JOIN (SELECT launch_id,sum(recipient) AS earned,sum(gross) AS gross FROM fee_events GROUP BY launch_id) f ON f.launch_id=l.id WHERE l.status='confirmed' AND (l.name ILIKE $1 OR l.symbol ILIKE $1 OR l.recipient_handle ILIKE $1) ORDER BY l.confirmed_at DESC LIMIT 48 OFFSET $2",[`%${search}%`,offset]);return {tokens:rows};
 });
 app.get('/api/public/token/:id',async req=>{
  const {rows:[token]}=await db.query("SELECT l.id,l.mint,l.name,l.symbol,l.description,l.image_uri,l.recipient_handle,l.confirmed_at,l.signature,COALESCE(f.earned,0)::text AS earned_lamports,COALESCE(f.gross,0)::text AS collected_lamports FROM launches l LEFT JOIN (SELECT launch_id,sum(recipient) AS earned,sum(gross) AS gross FROM fee_events GROUP BY launch_id) f ON f.launch_id=l.id WHERE l.status='confirmed' AND l.id=$1",[req.params.id]);need(token,404,'Token not found');return token;
 });
 app.get('/api/public/analytics' ,async()=>{
  const {rows:[fees]}=await db.query('SELECT COALESCE(sum(gross),0)::text AS collected,COALESCE(sum(recipient),0)::text AS recipients,COALESCE(sum(project),0)::text AS project FROM fee_events');
  const {rows:[claims]}=await db.query("SELECT COALESCE(sum(amount),0)::text AS claimed FROM claims WHERE status='confirmed'");
  const {rows:[count]}=await db.query("SELECT count(*)::int AS tokens FROM launches WHERE status='confirmed'");
  const {rows:daily}=await db.query("SELECT date_trunc('day',received_at) AS day,sum(gross)::text AS collected FROM fee_events WHERE received_at>now()-interval '30 days' GROUP BY 1 ORDER BY 1");
  const {rows:recent}=await db.query('SELECT signature,recipient_handle,gross::text,recipient::text,project::text,received_at FROM fee_events ORDER BY received_at DESC LIMIT 20');
  return {...fees,...claims,...count,daily,recent};
 });
 app.get('/api/public/profile/:handle',async req=>{
  const handle=normalizeHandle(req.params.handle);need(/^[a-z][a-z0-9_]{3,31}$/.test(handle),400,'Invalid Telegram username');
  const {rows:[balance]}=await db.query('SELECT earned::text,settled::text,reserved::text FROM balances WHERE handle=$1',[handle]);
  const {rows:tokens}=await db.query("SELECT l.id,l.mint,l.name,l.symbol,l.image_uri,l.confirmed_at,l.recipient_handle,COALESCE(f.earned,0)::text AS earned_lamports FROM launches l LEFT JOIN (SELECT launch_id,sum(recipient) AS earned FROM fee_events GROUP BY launch_id) f ON f.launch_id=l.id WHERE l.recipient_handle=$1 AND l.status='confirmed' ORDER BY l.confirmed_at DESC LIMIT 48",[handle]);
  return {handle,balance:balance||{earned:'0',settled:'0',reserved:'0'},tokens};
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
