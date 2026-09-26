# TelePaid readiness — 26 September 2026

The new hosted version is a Solana **Devnet sandbox**, using Privy wallets, real Pump token creation, a separate real initial buy, Telegram bot verification, and real Devnet payouts. Fee income is explicitly simulated. It is not a mainnet release.

## Verified

- 29 automated tests pass: 18 Node backend tests, 5 domain/signature tests, 6 hosted-service/Telegram tests. These include forged and replayed signatures, wrong/stale Telegram usernames, current username ownership using a different wallet, concurrent claims, one-use verification, webhook authentication and duplicate payout prevention.
- Real Devnet integration through the same hosted service handler completed creation, initial buy, and claim. SQLite/R2 adapters and a local Telegram identity fixture were used for this automated test; it did not authenticate a real Telegram user.
- Mint: `3rcQdumW2gK6A7rBj8EUDWFUHgWX1MFWWg53kJhYTeLe`.
- Finalized creation: `2aK41zBZzhqgkf8YVj5rLoECekEy9XGfmG613YnyLYBacNXBmQ5CnEF2dYD3yi3uToheFTjbxhMmtspcHgS9zatG`.
- Finalized 0.001 SOL buy: `3aacmTevDxVRZxysSLWck5ioxGG8VmL4Hm61fVpUJMC9QPdL1BodTFwsbBAvtY76y6ZZwbFWwE1HjvGxYz3FYVnp`.
- Finalized 0.0008 SOL payout: `64kkTUTmg3Q4mTCBvieVvhjckTJxf8aiFkJPwcTmg3pG7LgJHCwUPrXPTK6z3bJyHoqQyqfgbYMeUa7PytvHrFCC`.
- Repeating the claim returned the same transaction signature. No mainnet transaction was signed or sent.
- The built Cloudflare Worker passes its state API check with actual local D1 and R2 bindings. Solana/Anchor browser entrypoints avoid Node-only transports in Workers.
- TypeScript checking and both hosted/VPS production builds pass. Bot identity was validated with Telegram `getMe`.
- Seven unused exact-case `TeLe` mint signers are configured for public testing. The automated test's spent mint is excluded. The separate test treasury was funded with 0.05 Devnet SOL.

## Test the published flow

1. Connect a Solana wallet through Privy. Fund it with Devnet SOL and enable the wallet's Devnet/testnet view if needed.
2. Open Launch, upload a PNG/JPG/WebP, enter name, ticker and your current Telegram username. Optionally enter a dev buy amount up to 1 SOL.
3. Approve the wallet message and creation transaction. Wait for Finalized. If requested, use the separate Dev buy button and approve that transaction.
4. Click Add test fee. This allocates a simulated 0.001 SOL: 0.0008 recipient, 0.0002 project. Each test token gets this credit once.
5. On Claims, click Verify with Telegram, approve the wallet message, open TelePayFunBot, press Start, and confirm the displayed wallet/username.
6. Return to Claims within two minutes and claim 0.0008 Devnet SOL. Check the finalized explorer receipt. Fresh verification is required for each new claim.

A different wallet can claim when its Telegram proof matches the token's recipient username. The creator cannot claim merely because they created the token. An already reserved payout remains bound to its original destination. Rejected wallet prompts and refreshes are recoverable from Your saved tests.

## Remaining before mainnet/VPS release

- User-assisted HTTPS Privy and genuine Telegram confirmation test on desktop/mobile. The internal browser preview is HTTP, which Privy correctly refuses; no security bypass is used.
- Automatic collection and allocation of actual Pump/PumpSwap trading fees, including migration, remain to be verified end to end. The hosted sandbox's Add test fee button is not a collector.
- Connect real market-cap/latest-trade data. The sandbox deliberately shows no fabricated market data.
- Choose one production authentication architecture: port the tested bot flow to the VPS Node backend or configure its existing OIDC flow. The bot token alone is not an OIDC client secret.
- Separate production treasury/operator keys, tested RPC, encrypted mint inventory, PostgreSQL concurrency tests, Docker startup, HTTPS/domain, backup/restore and monitoring.
- Controlled mainnet launch/collection/claim and independent financial/security review before unrestricted operation. Production launch/collection/payout switches remain off until their gates pass.

The user does not need a VPS to run the hosted Devnet test. The test mint inventory is finite and needs replenishment after seven launches. Test funds and keys are separate from future production custody.

## Reproducible checks

```sh
pnpm exec tsc --noEmit
node --test tests/*.test.mjs
npm run test:backend
npm run build:vps
node tests/worker-harness.mjs
node backend/scripts/devnet-e2e.mjs
```

The Devnet integration script reads ignored secrets and persists its receipt before/after transactions. Re-running resumes the same token and payout. Never delete its receipt to retry a pending operation. Do not copy the used QA mint into a fresh production database. Secret files and receipts are excluded from Git and deployment archives.
