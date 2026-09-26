# Railway verification — 2026-09-26

Runtime commit: `e095ae2ea5fac682404b164d8f37b28d262730af`.
URL: https://telepaid-production.up.railway.app

## Passed

- 21 backend tests: fee split/idempotency, fresh current-username claims,
  concurrency, CSRF/origin checks, JWT validation, wallet signatures, exact
  prepared messages, finalization/retries, collection-to-sweep accounting,
  browser-bound Telegram bot confirmation and separate initial buys.
- TypeScript and Vite production build; real Railway Docker builds.
- Web deployment `271b1f62-0302-490c-85ac-228ec0726f5f`: SUCCESS.
- Worker deployment `b32d5db3-2805-439c-a58f-6a425b47509f`: SUCCESS.
- Live API wallet challenge and signed wallet login: HTTP 200; bot verification
  start: 200; missing/forged webhook credential: 401. These tests did not create
  a Telegram identity, launch a token, move SOL or submit a chain transaction.
- Telegram Bot API confirms the Railway webhook, zero pending updates, no error.
- Browser: original sidebar collapses/expands, sample data remains, original
  launch form validates and opens its review, Privy displays Phantom/Solflare.
- Unchanged global CSS, sample data, logo and art assets.
- Two fresh private mint keypairs with exact `TeLe` suffix; encrypted backup
  includes them and production service keys. Restoration of all 12 files passed.
- PostgreSQL and metadata each use a persistent 500MB volume. Railway reports
  DAILY backup schedules enabled for both; no restore drill has been run yet.

## Current test settings

- Mainnet, launches enabled (requires the user's own wallet approval).
- Collections and payouts paused; no mainnet transaction sent by the agent.
- Minimum claim and collection threshold: 10,000 lamports (0.00001 SOL), lowered
  for a small controlled test. Gas is separately funded by the operator.
- Operator: `BU6RZQ1R9upPsUVqpnHYSc7Kjj5gYHDYZJYKkuRHBVUz` — 0 lamports checked.
- Treasury: `Gs5XjivVJVQNmAhcHVVXZYUivTJ6NmhhBZJRVP7UfVn2` — 0 lamports checked.

## Requires a real user / funded test

1. Connect a mainnet wallet in Privy; open Telegram verification, approve that
   wallet in TelePayFunBot, return and press "I confirmed in Telegram".
2. Choose a spending cap and fund the user's launch wallet plus the separate
   operator gas wallet. Do not send test funds to the old shared Devnet key.
3. Create one token; confirm finalization and the TeLe address. If requested,
   approve its initial buy separately; this is an additional trade, not atomic
   with creation, and its quote allows 1% slippage.
4. Enable collections/payouts for the controlled test, reconcile the real
   creator-fee collection and treasury sweep, then claim with a fresh Telegram
   confirmation. Verify exact on-chain 80/20 attribution and payout receipt.
5. Before unrestricted public use, review custody/security, run a backup restore
   drill and replenish the initial two-address vanity pool. Sample analytics
   remain explicitly illustrative; they must not be interpreted as live earnings.

Local automated tests are not evidence that a mainnet launch or payout occurred.
