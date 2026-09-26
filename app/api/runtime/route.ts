import {env} from 'cloudflare:workers';
// Public configuration only. Never expose application secrets or custody keys.
export function GET(){const config=env as {PRIVY_APP_ID?:string;DEVNET_ENABLED?:string;TELEGRAM_BOT_TOKEN?:string};const privyAppId=config.PRIVY_APP_ID||'',devnet=config.DEVNET_ENABLED==='true';return Response.json({mode:devnet?'devnet':'preview',telegram:devnet&&!!config.TELEGRAM_BOT_TOKEN,wallet:!!privyAppId,privyAppId,cluster:devnet?'devnet':'mainnet-beta',launch:devnet,claims:devnet,suffix:'TeLe'},{headers:{'Cache-Control':'no-store'}});}
