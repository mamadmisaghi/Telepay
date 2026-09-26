ALTER TABLE launches ADD COLUMN IF NOT EXISTS launch_format text NOT NULL DEFAULT 'legacy';
CREATE TABLE IF NOT EXISTS market_trades (
 launch_id text NOT NULL REFERENCES launches(id), signature text NOT NULL, event_index integer NOT NULL,
 slot bigint NOT NULL, traded_at timestamptz NOT NULL, side text NOT NULL CHECK(side IN ('buy','sell')),
 wallet text NOT NULL, sol_lamports numeric(30,0) NOT NULL, token_raw numeric(30,0) NOT NULL, price_sol double precision NOT NULL,
 PRIMARY KEY(launch_id,signature,event_index)
);
CREATE INDEX IF NOT EXISTS market_trades_time ON market_trades(launch_id,traded_at DESC);
CREATE TABLE IF NOT EXISTS market_scans (
 launch_id text NOT NULL REFERENCES launches(id),signature text NOT NULL,PRIMARY KEY(launch_id,signature)
);
CREATE TABLE IF NOT EXISTS market_state (
 launch_id text PRIMARY KEY REFERENCES launches(id),spot_price_sol double precision,graduated boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL,backlog boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS telegram_directory (
 id text PRIMARY KEY,handle text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_directory_handle ON telegram_directory(handle);
