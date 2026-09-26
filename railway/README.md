# TelePaid on Railway

This target serves the existing approved `app/page.tsx` interface and mock data from the Node API container. It does not substitute the separate VPS/Devnet UI. `UI_MODE=preview` must remain set until real actions have been integrated into the approved design.

## Infrastructure

- Project: `ad3e7728-62cf-4f78-b968-ac628c6c700e`
- Environment: `4fd4aa71-8fc3-42f4-a28d-95caff02108d`
- App: `9db4d553-b3ec-4280-8bdf-ea134904db9b`
- PostgreSQL: `3a31421e-b79a-4be3-b356-cb24f57645d0`, private networking and persistent volume.
- GitHub source: `mamadmisaghi/Telepay`, `main`.
- Dockerfile: `railway/Dockerfile`; settings reference: `railway/service-settings.json`.
- Pre-deploy command: `node src/migrate.mjs`.
- Healthcheck: `/api/health` verifies PostgreSQL connectivity.

Runtime variables: `PUBLIC_ORIGIN` (the actual HTTPS app origin), `PORT=8080`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `UI_MODE=preview`, `PRIVY_APP_ID`, `SOLANA_CLUSTER=mainnet-beta`, and `SOLANA_RPC_URL`. Keep `LAUNCHES_ENABLED`, `COLLECTIONS_ENABLED`, and `PAYOUTS_ENABLED` all `false` initially. Secrets belong in Railway Variables, never in frontend bundles.

Settings are applied through Railway service configuration. New Railway services no longer accept legacy `railway.json` Config as Code; `service-settings.json` documents the intended values and is not automatically applied.

## Before the first mainnet transaction

1. Integrate the real launch/claim actions into the approved interface while preserving its styling and illustrative data labels.
2. Port the tested Telegram bot proof to the PostgreSQL backend or configure its OIDC implementation. The existing hosted bot webhook must not be redirected to an unimplemented route.
3. Use separate mainnet treasury/operator wallets and an encrypted unused TeLe mint pool. Do not fund or reuse the shared Devnet test key for mainnet custody.
4. Mount durable metadata storage and configure a settlement worker before enabling financial operations.
5. Simulate one creation, estimate network fees/rent, and agree an explicit total test budget and initial buy. Obtain the creator's wallet approval for the transaction.
6. Verify actual collection of creator fees and the exact 80/20 ledger allocation, then verify a small Telegram-authenticated claim and its finalized receipt. Test fee credits do not establish mainnet collector correctness.

Mainnet transactions are intentionally not enabled by deploying this container. The encrypted credentials checkpoint is a backup, not automatic Railway configuration. Mainnet readiness is separate from a healthy deployment.

## Integrated operations (2026-09-26)

The approved `app/page.tsx` remains the application shell, including its sidebar,
header/footer, fonts and clearly labeled sample listings. `platform-actions.tsx`
connects the existing dialogs to the API. Do not switch to the old LiveApp layout.

- Wallet-only launch authentication signs a browser-bound, expiring message.
- Telegram bot confirmation binds the current username to that signed wallet and
  browser. Each claim needs a proof younger than two minutes; its time begins at
  Telegram confirmation, not when the browser polls. No username-to-ID lookup is
  required at creation.
- Create and optional initial buy have separate wallet approvals. A 1% slippage
  allowance applies to the buy. The same launch/mint resumes after expiration.
- The worker reconciles finalized create/buy/collection/sweep/claim transactions.
  Allocations are credited only after the treasury actually receives the sweep.
- Fresh mainnet treasury and gas-payer keys are stored in Railway Variables;
  two privately generated, unused addresses end in exact `TeLe`. The deployment
  bootstrap imports mint keys once and checks that they do not exist on chain.
- `node src/prepare-deploy.mjs` migrates PostgreSQL and imports the mint pool.
- `railway/Worker.Dockerfile` runs the worker without a public domain.
- The web service volume mounts `/srv/telepaid/data`. Its entrypoint prepares
  metadata ownership and drops to uid/gid 1000 before starting the HTTP service.

Keep collections/payouts paused until the operator gas wallet is funded and the
first controlled mainnet launch/trade can be reconciled. Launches require the
connected user's explicit wallet signature and SOL for account rent and fees.
There are no production fake-fee or simulated-credit endpoints.

Operator gas wallet: `BU6RZQ1R9upPsUVqpnHYSc7Kjj5gYHDYZJYKkuRHBVUz`
Treasury (receives collected fees): `Gs5XjivVJVQNmAhcHVVXZYUivTJ6NmhhBZJRVP7UfVn2`
Never fund or reuse the old shared Devnet test private key on mainnet.

Before unrestricted public launch: complete one funded mainnet create, optional
buy, creator-fee collection, fresh real-user Telegram verification and claim;
verify Privy allows the Railway origin; check restore/backup policies for the
Postgres and metadata volumes; replenish the vanity pool beyond its initial two
addresses. Test success alone is not a security audit of a custodial service.
