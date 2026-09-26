import { readFileSync } from 'node:fs';
import { assertValidSuffix } from '../../lib/domain/launch-policy.ts';

const secret = (env, name) => env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`], 'utf8').trim() : (env[name] || '');
export function configFromEnv(env = process.env) {
  const origin = env.PUBLIC_ORIGIN || 'http://localhost:8080';
  if (new URL(origin).origin !== origin) throw new Error('PUBLIC_ORIGIN must be an origin without a trailing slash or path');
  if (env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('Production requires HTTPS');
  const suffix = env.MINT_SUFFIX || 'TeLe';
  if(suffix !== 'TeLe') throw new Error('All TelePaid launches must use the approved TeLe suffix');
  if (suffix) assertValidSuffix(suffix);
  return {
    origin, production: env.NODE_ENV === 'production', port: Number(env.PORT || 3001),
    privyAppId: env.PRIVY_APP_ID || '',
    uiMode: env.UI_MODE === 'preview' ? 'preview' : 'live',
    staticDir: env.STATIC_DIR || '',
    databaseUrl: secret(env, 'DATABASE_URL'), encryptionKey: secret(env, 'KEY_ENCRYPTION_KEY'),
    telegramClientId: env.TELEGRAM_CLIENT_ID || '', telegramClientSecret: secret(env, 'TELEGRAM_CLIENT_SECRET'),
    rpcUrl: secret(env, 'SOLANA_RPC_URL'), cluster: env.SOLANA_CLUSTER || 'mainnet-beta', suffix,
    treasurySecret: secret(env, 'TREASURY_KEYPAIR'), operatorSecret: secret(env, 'OPERATOR_KEYPAIR'),
    launchesEnabled: env.LAUNCHES_ENABLED === 'true', payoutsEnabled: env.PAYOUTS_ENABLED === 'true', collectionsEnabled: env.COLLECTIONS_ENABLED === 'true',
    metadataDir: env.METADATA_DIR || './data/metadata', vanityTarget: Number(env.VANITY_POOL_TARGET || 20),
    minimumClaim: BigInt(env.MINIMUM_CLAIM_LAMPORTS || '1000000'),
    collectionThreshold: BigInt(env.COLLECTION_THRESHOLD_LAMPORTS || '1000000'),
  };
}
export function readiness(c) {
  return {telegram: !!(c.telegramClientId && c.telegramClientSecret), wallet: !!c.privyAppId, privyAppId:c.privyAppId,
    launch: !!(c.launchesEnabled && c.suffix && c.rpcUrl && c.encryptionKey),
    claims: !!(c.payoutsEnabled && c.rpcUrl && c.treasurySecret && c.operatorSecret),
    suffix: c.suffix || null, mode: c.uiMode || 'live', cluster: c.cluster};
}
