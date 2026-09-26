CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, oidc_sub text UNIQUE, username text, display_name text NOT NULL,
 verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_username ON users(lower(username));
CREATE TABLE IF NOT EXISTS oauth_states (
 state_hash text PRIMARY KEY, binding_hash text NOT NULL, verifier text NOT NULL, nonce text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), csrf text NOT NULL,
 verified_handle text, claim_used boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallets (
 address text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), verification_session_hash text, verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallet_challenges (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), address text NOT NULL,
 message text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS mint_pool (
 address text PRIMARY KEY, secret_encrypted text NOT NULL, suffix text NOT NULL,
 status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','reserved','consumed','quarantined')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS launches (
 id text PRIMARY KEY, idempotency_key text NOT NULL, owner_id text NOT NULL REFERENCES users(id),
 recipient_handle text NOT NULL,
 wallet text NOT NULL, mint text NOT NULL UNIQUE REFERENCES mint_pool(address),
 creator text NOT NULL UNIQUE, creator_secret text NOT NULL,
 name text NOT NULL, symbol text NOT NULL, description text NOT NULL, metadata_uri text NOT NULL,
 image_uri text NOT NULL, initial_buy numeric(20,0) NOT NULL DEFAULT 0 CHECK(initial_buy>=0),
 status text NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','prepared','submitted','confirmed','failed','expired')),
 message_base64 text, transaction_base64 text, signature text UNIQUE, last_valid_height bigint,
 error text, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz,
 UNIQUE(owner_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS balances (
 handle text PRIMARY KEY, earned numeric(30,0) NOT NULL DEFAULT 0,
 reserved numeric(30,0) NOT NULL DEFAULT 0, settled numeric(30,0) NOT NULL DEFAULT 0,
 CHECK(earned>=0 AND reserved>=0 AND settled>=0 AND earned>=reserved+settled)
);
CREATE TABLE IF NOT EXISTS claims (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), handle text NOT NULL, wallet text NOT NULL REFERENCES wallets(address),
 amount numeric(20,0) NOT NULL CHECK(amount>0), idempotency_key text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','submitted','confirmed','failed')),
 signature text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz,
 UNIQUE(user_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS jobs (
 id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('collect','sweep','claim')),
 launch_id text REFERENCES launches(id), claim_id text REFERENCES claims(id),
 amount numeric(20,0), status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','submitted','confirmed','failed')),
 transaction_base64 text, signature text UNIQUE, last_valid_height bigint, error text,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_collection ON jobs(launch_id) WHERE kind IN ('collect','sweep') AND status IN ('queued','submitted');
CREATE UNIQUE INDEX IF NOT EXISTS one_claim_job ON jobs(claim_id) WHERE claim_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS fee_events (
 event_id text PRIMARY KEY, launch_id text NOT NULL REFERENCES launches(id),
 recipient_handle text NOT NULL, signature text NOT NULL UNIQUE,
 gross numeric(20,0) NOT NULL CHECK(gross>0), recipient numeric(20,0) NOT NULL,
 project numeric(20,0) NOT NULL, slot bigint NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), CHECK(gross=recipient+project)
);
CREATE TABLE IF NOT EXISTS audit_events (
 id bigserial PRIMARY KEY, actor text, action text NOT NULL, subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
