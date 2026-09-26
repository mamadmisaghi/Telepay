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

## Phantom creation fix — 2026-09-26

- User-reported creation with zero initial buy reached Phantom approval, then
  returned "The transaction was changed. Review and prepare again". Railway
  recorded HTTP 400 from submit, before the application's on-chain broadcast.
- Previously the mint signature was added only after wallet approval. Creation
  and refresh now include the mint co-signature before handing the transaction
  to the wallet, binding the exact prepared message while leaving the payer's
  signature empty. Exact-message and wallet-signature checks remain enforced.
- Phantom documents transaction augmentation; the exact changed instruction in
  this incident was not captured, so this is a compatibility fix rather than a
  claim that a particular augmentation was observed.
- All 22 backend tests passed. Regression coverage verifies the mint signature,
  absent payer signature, successful unchanged wallet signing, rejection of
  changed messages and mismatched mint keys, and signer forwarding on prepare
  and refresh. No real SOL was spent in these tests.
- Existing prepared launches must use "Refresh this launch transaction" to get
  the co-signed payload. A real Phantom retry remains necessary to confirm the
  complete wallet-extension flow. No UI, mock data or financial flags changed.

## Live token navigation and buy continuation — 2026-09-26

- Confirmed launches now share the existing Top Tokens / Explore cards with
  retained samples. Recent sorts by creation age, unavailable real market/trade
  data stays unknown, and live cards open internal token pages with real images,
  metadata, collection totals, mint and transaction links. Public username pages
  list their real tokens and aggregate claim balances.
- Successful creation opens the internal token page. The creator can continue
  the separate initial buy there, reconnect/reverify the wallet, or explicitly
  set a positive amount if the original request was zero. A submitted or completed
  buy cannot be replaced or repeated with a new amount. Existing prepared quotes
  remain bound to their amount. Creation is never described as a completed buy.
- Terminal saved launches no longer silently replace a new launch form. Active
  saved requests are resumed explicitly. The separate top-of-page live strip and
  TELE navigation/page were removed; approved layout and sample records remain.
- Recipient picker supports debounced exact public-profile lookup plus prefix
  matches among public TelePaid recipients. Known user IDs are rechecked against
  the CURRENT username via Bot API and never used as fee ownership keys. Photos
  are shown when available. Unconfirmed lookups remain explicitly unconfirmed.
- Full Telegram-wide substring search is NOT implemented: contacts.search is
  user-only MTProto, unavailable through the installed Bot API credential.
  Public t.me previews are best effort and may be unavailable; no generic page
  is interpreted as an existing account. Claim ownership checks are unchanged.
- 24 backend tests passed, including current/reassigned handle lookup, rejecting
  generic and channel previews, public detail projections, and buy amount/access/
  replay guards. TypeScript and Railway Vite builds passed. No mainnet transaction
  or purchase was submitted by the agent. Browser/deployment checks follow rollout.
