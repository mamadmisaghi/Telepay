# TelePaid VPS deployment

The frontend and backend have separate builds. Sites remains the public design preview; the VPS bundle always uses real API data and never falls back to example balances.

## Ready in source

- Node 24 Fastify API, PostgreSQL schema, Telegram OIDC/PKCE, cookie sessions and CSRF protection.
- Privy Solana-only Phantom/Solflare connection, expiring signature challenge, token preparation and wallet signing.
- Pump SDK 2.0.0 adapter, exact-message mint signing, persistent transaction submission and reconciliation.
- Case-sensitive `TeLe` mint pool, encrypted private keys, bounded native Ed25519 generation workers.
- Handle-based fee ledger, exact integer 80/20 allocation, atomic claim reservations, finalized settlement worker.
- Original clean blue logo asset, live interface and empty/error states, fee analytics and receipts.
- Node/PostgreSQL/Caddy containers, HTTPS, health checks, backups and deployment preflight.

## Still requires real infrastructure

A reachable domain, Telegram OIDC client settings, Solana RPC, separate treasury and gas wallets, PostgreSQL volumes and generated TeLe mints. Docker is not available in the authoring environment: image builds, Compose startup, restart and restore must be exercised on the VPS. Local tests use PostgreSQL-compatible PGlite; real Telegram and mainnet tests have not been performed. Do not describe this as financially audited or production-verified.

## Initial setup on the VPS

Use a Linux host with Docker Engine and Compose installed, persistent storage, and ports 80/443 open. Do not expose PostgreSQL or the API port publicly. Start with all money-moving flags off.

1. Copy/clone the repository, then run `sudo node deploy/initialize-secrets.mjs` using Node 24. It creates secrets without printing them and preserves existing files. The API runs as UID 1000. The directory is private; PostgreSQL receives only its password file.
2. Copy `deploy/runtime.env.example` to `deploy/runtime.env`. Set `PUBLIC_ORIGIN` to the exact HTTPS origin, and `TELEGRAM_CLIENT_ID`. Fill the blank files in `deploy/secrets/` through an SSH editor or secret manager, never source control or chat.
   Set `PRIVY_APP_ID` to the public application ID. Register the production origin in Privy's allowed origins and enable external Solana wallets. This integration does not use a Privy App Secret or embedded wallets. Never expose a secret through `/api/runtime` or a frontend environment variable.
3. Treasury and operator keys are JSON Solana keypair arrays or base58-encoded 64-byte secret keys. Use separate wallets. Only the operator pays transaction costs; treasury funds cover liabilities and the platform allocation. Keep offline recovery copies encrypted and apart from database backups.
4. Register the origin and `https://YOUR_DOMAIN/api/auth/telegram/callback` with BotFather. Choose RS256 (default) or ES256. This application requests `openid profile`, never phone or messaging access. Claims use the freshly signed `preferred_username`.
5. Point DNS to the VPS and set `DOMAIN` in the shell, e.g. `export DOMAIN=telepaid.example` (replace with the real domain).
6. Run `docker compose -f deploy/compose.yml up -d --build`. The migration service must succeed before API and worker start. Caddy serves the compiled frontend and proxies `/api` to the API.
7. Run `docker compose -f deploy/compose.yml exec api node src/preflight.mjs`. It reports missing configuration without exposing secrets. Inspect API and worker logs with Compose.
8. Run `docker compose -f deploy/compose.yml --profile maintenance run --rm vanity` to fill the encrypted TeLe pool. It stops when the configured target is reached. Re-run from a scheduled maintenance task; never substitute a suffix-free mint if the pool is empty. Four exact characters are probabilistic work and can take substantial CPU time.
9. Complete the activation checks below. Only then enable launch, collection and payout flags and restart API/worker. Never send funds until the intended public addresses and transaction simulation have been reviewed.

## Activation checks

- Connect Phantom/Solflare through Privy, cancel and retry, disconnect/reconnect, and switch accounts. Open the connected-wallet button and run **Test wallet signature**. It signs a unique message and verifies its Ed25519 signature locally; it sends no transaction and is not Telegram verification. Check desktop extensions and a mobile wallet deep link.
- Actual Telegram login completes; invalid state, replay, issuer, audience, expiry and nonce fail.
- Login with a different account cannot claim another username. A new verified owner of the same username can claim its unreserved accrued balance. Proof is limited to two minutes and one new claim; reauthentication is required afterwards.
- Client only enters the recipient handle. No recipient Telegram ID or prior enrollment is required.
- A connected wallet signs its exact domain-bound challenge; a tampered/replayed proof is rejected.
- A controlled launch ends in TeLe, has the intended Pump creator fee destination, and appears only after finalization.
- Verify fee collection on both the bonding curve and PumpSwap after migration. The adapter unwraps creator WSOL and calculates actual fees from vault deltas; rent refunds are not treated as revenue. Sweep receipt and 80/20 allocation must reconcile exactly.
- A small claim settles exactly once, including RPC timeout/restart/retry. A failed finalized transaction releases its reservation. A transaction of unknown status stays reserved.
- Test actual PostgreSQL concurrent transactions, container restart, backup restoration and VPS firewall before opening publicly.

## Operations

- `deploy/backup.sh` creates database and metadata backups with private permissions. Copy to encrypted off-server storage. Back up the encryption key separately: without it, mint/collector secrets cannot be recovered.
- To restore into a replacement database: stop API/worker first, use `pg_restore --clean --if-exists` against the replacement database, restore metadata files, restore the matching encryption key, then reconcile pending signatures before reopening claims. Perform this as a drill on a disposable database first.
- Pause new payments with `PAYOUTS_ENABLED=false`; pause launch or collection independently. Already broadcast transactions may still finalize and must be reconciled.
- Failed sweeps require investigation before new collections for that mint. Never manually re-credit an event or replace an unknown transaction with a new payment.
- Monitor worker errors, queued/submitted age, gas balance, treasury liabilities, mint pool count and backup age. The initial package logs these events/errors; configure an external uptime/error alert destination on the VPS.
- Platform 20% is recorded separately in the ledger. No automatic platform withdrawal is enabled; a future withdrawal must preserve all outstanding recipient liabilities.
- The suffix is branding, not cryptographic provenance. Use the recorded mint and fee destination to verify a TelePaid launch.

## Boundaries

The product is a custodial collector: encrypted mint/collector keys and the treasury signer are server secrets. End-user wallet private keys are never collected. Financial correctness tests cover local state transitions, not external chain correctness or a third-party security audit. Market prices/trading charts are not fabricated; this version shows confirmed fee data and links trading to Pump.fun.
