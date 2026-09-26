import {env} from 'cloudflare:workers';
import {devnetService} from '@/lib/devnet-service.mjs';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>devnetService(env)(request);
export const POST=(request:Request)=>devnetService(env)(request);
