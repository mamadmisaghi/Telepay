import {sqliteTable,text,integer,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const sandboxChallenges=sqliteTable('sandbox_challenges',{
 id:text('id').primaryKey(),wallet:text('wallet').notNull(),action:text('action').notNull(),digest:text('digest').notNull(),message:text('message').notNull(),expires:integer('expires').notNull(),used:integer('used').notNull().default(0),
},t=>[index('sandbox_challenge_wallet_expiry').on(t.wallet,t.expires)]);
export const sandboxMints=sqliteTable('sandbox_mints',{
 address:text('address').primaryKey(),launchId:text('launch_id'),
});
export const sandboxLaunches=sqliteTable('sandbox_launches',{
 id:text('id').primaryKey(),requestId:text('request_id').notNull(),wallet:text('wallet').notNull(),mint:text('mint').notNull(),name:text('name').notNull(),symbol:text('symbol').notNull(),description:text('description').notNull(),handle:text('handle').notNull(),imageType:text('image_type').notNull(),initialBuy:text('initial_buy').notNull(),credited:integer('credited').notNull().default(0),createdAt:integer('created_at').notNull(),
},t=>[uniqueIndex('sandbox_launch_mint').on(t.mint),uniqueIndex('sandbox_launch_request').on(t.wallet,t.requestId),index('sandbox_launch_wallet').on(t.wallet)]);
export const sandboxTransactions=sqliteTable('sandbox_transactions',{
 id:text('id').primaryKey(),launchId:text('launch_id').notNull(),kind:text('kind').notNull(),wallet:text('wallet').notNull(),status:text('status').notNull(),message:text('message'),wire:text('wire'),signature:text('signature'),lastValidHeight:integer('last_valid_height'),amount:integer('amount').notNull().default(0),createdAt:integer('created_at').notNull(),error:text('error'),
},t=>[uniqueIndex('sandbox_tx_kind').on(t.launchId,t.kind),index('sandbox_tx_status').on(t.status)]);
export const sandboxTelegram=sqliteTable('sandbox_telegram',{
 nonceHash:text('nonce_hash').primaryKey(),wallet:text('wallet').notNull(),expires:integer('expires').notNull(),telegramId:text('telegram_id'),handle:text('handle'),verifiedAt:integer('verified_at'),consumed:integer('consumed').notNull().default(0),
},t=>[index('sandbox_telegram_wallet').on(t.wallet,t.verifiedAt)]);
