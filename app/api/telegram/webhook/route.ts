import {env} from 'cloudflare:workers';
import {telegramWebhook} from '@/lib/telegram-bot.mjs';
export const POST=(request:Request)=>telegramWebhook(request,env);
