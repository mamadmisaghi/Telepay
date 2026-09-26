CREATE TABLE IF NOT EXISTS login_requests (
 id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('wallet','telegram')),
 binding_hash text NOT NULL, address text NOT NULL, message text,
 identity jsonb, verified_at timestamptz, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS launcher_sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 address text NOT NULL, csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS launch_buys (
 launch_id text PRIMARY KEY REFERENCES launches(id),
 status text NOT NULL CHECK(status IN ('prepared','submitted','confirmed','failed','expired')),
 message_base64 text NOT NULL, transaction_base64 text NOT NULL,
 signature text UNIQUE, last_valid_height bigint NOT NULL
);
