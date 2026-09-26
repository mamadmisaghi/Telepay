import { readFileSync } from 'node:fs';
import { assertValidSuffix } from '../../lib/domain/launch-policy.ts';

const secret = (env, name) => env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`], 'utf8').trim() : (env[name] || '');
export function configFromEnv(env = process.env) {
  const origin = env.PUBLIC_ORIGIN || 'http://localhost:8080';
  if (new URL(origin).origin !== origin) throw new Error('PUBLIC_ORIGIN must be an origin without a trailing slash or path');
  if (env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('Production requires HTTPS');
  const suffix = env.MINT_SUFFIX || 'TeLe';
  if(suffix !== 'TeLe') throw new Error('All TelePay launches must use the approved TeLe suffix');
  if (suffix) assertValidSuffix(suffix);
  const previousTreasurySecrets=JSON.parse(secret(env,'PREVIOUS_TREASURY_KEYPAIRS')||'[]');
  if(!Array.isArray(previousTreasurySecrets)||previousTreasurySecrets.length>16||previousTreasurySecrets.some(k=>typeof k!=='string'||!k))throw new Error('Invalid previous treasury configuration');
  return {
    origin, production: env.NODE_ENV === 'production', port: Number(env.PORT || 3001),
    privyAppId: env.PRIVY_APP_ID || '',
    uiMode: env.UI_MODE === 'preview' ? 'preview' : 'live',
    staticDir: env.STATIC_DIR || '',
    databaseUrl: secret(env, 'DATABASE_URL'), encryptionKey: secret(env, 'KEY_ENCRYPTION_KEY'),
    telegramClientId: env.TELEGRAM_CLIENT_ID || '', telegramClientSecret: secret(env, 'TELEGRAM_CLIENT_SECRET'),
    telegramBotToken: secret(env,'TELEGRAM_BOT_TOKEN'), telegramBotUsername: env.TELEGRAM_BOT_USERNAME || 'UseTelePay_bot', telegramWebhookSecret: secret(env,'TELEGRAM_WEBHOOK_SECRET'),
    rpcUrl: secret(env, 'SOLANA_RPC_URL'), cluster: env.SOLANA_CLUSTER || 'mainnet-beta', suffix,
    feeSharingEnabled:env.FEE_SHARING_ENABLED==='true',launchLookupTables:(env.LAUNCH_LOOKUP_TABLES||'').split(',').filter(Boolean),
    telegramApiId:Number(env.TELEGRAM_API_ID||0),telegramApiHash:secret(env,'TELEGRAM_API_HASH'),telegramSearchSession:secret(env,'TELEGRAM_SEARCH_SESSION'),
    treasurySecret: secret(env, 'TREASURY_KEYPAIR'), operatorSecret: secret(env, 'OPERATOR_KEYPAIR'),
    previousTreasurySecrets,
    launchesEnabled: env.LAUNCHES_ENABLED === 'true', payoutsEnabled: env.PAYOUTS_ENABLED === 'true', collectionsEnabled: env.COLLECTIONS_ENABLED === 'true',
    metadataDir: env.METADATA_DIR || './data/metadata', vanityTarget: Math.max(1,Math.min(100,Number(env.VANITY_POOL_TARGET)||20)),
    vanityAuto:env.VANITY_AUTO_REFILL==='true',vanityBinary:env.VANITY_BINARY||'/usr/local/bin/telepaid-vanity',
    vanityBudgetSeconds:Math.max(10,Math.min(300,Number(env.VANITY_BUDGET_SECONDS)||60)),
    vanityIntervalMs:Math.max(60000,Number(env.VANITY_INTERVAL_MS)||300000),
    minimumClaim: BigInt(env.MINIMUM_CLAIM_LAMPORTS || '1000000'),
    collectionThreshold: BigInt(env.COLLECTION_THRESHOLD_LAMPORTS || '1000000'),
  };
}
export function readiness(c) {
  return {telegram: !!((c.telegramBotToken && c.telegramWebhookSecret)||(c.telegramClientId && c.telegramClientSecret)), botLogin:!!(c.telegramBotToken&&c.telegramWebhookSecret), telegramBotUsername:c.telegramBotUsername, integrated:true, wallet: !!c.privyAppId, privyAppId:c.privyAppId,
    launch: !!(c.launchesEnabled && c.suffix && c.rpcUrl && c.encryptionKey),
    claims: !!(c.payoutsEnabled && c.rpcUrl && c.treasurySecret && c.operatorSecret),
    suffix: c.suffix || null, mode: c.uiMode || 'live', cluster: c.cluster};
}
