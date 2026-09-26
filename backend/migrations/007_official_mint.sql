-- The project's mint is created with an external signer. It never enters the
-- launchpad's mint pool or the Telegram fee/claim ledger.
ALTER TABLE launches DROP CONSTRAINT IF EXISTS launches_mint_fkey;
ALTER TABLE launches ALTER COLUMN recipient_handle DROP NOT NULL;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'platform';
ALTER TABLE launches DROP CONSTRAINT IF EXISTS launches_source_check;
ALTER TABLE launches ADD CONSTRAINT launches_source_check CHECK (source IN ('platform','official'));

CREATE TABLE IF NOT EXISTS official_mints (
 mint text PRIMARY KEY,
 expected_wallet text NOT NULL,
 launch_id text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','confirmed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz
);
INSERT INTO users(id,display_name) VALUES('official:telepay','TelePay') ON CONFLICT DO NOTHING;
INSERT INTO official_mints(mint,expected_wallet,launch_id)
 VALUES('G3odGzwyaYgjzwh5yUizB5WEh8MEdW1wg4TpjGVnTeLe','HAM7o9fKUaJ5NGDxVcW4HxzLeMyqgmN8fPnKmmbveUd5','official-telepay-v1')
 ON CONFLICT(mint) DO NOTHING;
