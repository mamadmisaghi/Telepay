ALTER TABLE jobs ADD COLUMN IF NOT EXISTS destination text;
CREATE TABLE IF NOT EXISTS treasury_transfers (
 id text PRIMARY KEY, source text NOT NULL, destination text NOT NULL,
 amount numeric(20,0) NOT NULL CHECK(amount>0),
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','confirmed','failed')),
 transaction_base64 text NOT NULL, signature text NOT NULL UNIQUE, last_valid_height bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_treasury_transfer ON treasury_transfers(source) WHERE status='submitted';
