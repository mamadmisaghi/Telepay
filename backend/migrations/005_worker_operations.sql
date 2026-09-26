CREATE TABLE IF NOT EXISTS worker_cursors(kind text PRIMARY KEY,last_id text);
CREATE TABLE IF NOT EXISTS operational_status(name text PRIMARY KEY,updated_at timestamptz NOT NULL DEFAULT now(),details jsonb NOT NULL DEFAULT '{}');
