# TelePaid checkpoint — 26 September 2026

Repository: https://github.com/mamadmisaghi/Telepay

Source snapshot: `89db43ee5255df9f33511750860fbb1d8c9a59fa` (Sites version 10).

## Current product state

The approved Graphite Blue interface has been restored, including the collapsible sidebar, original header/footer/Create page, sample tokens, images and mock data. The current home page is the original interface preview. Devnet service, Telegram bot, wallet integration, migrations, tests and the separate Devnet UI remain in the source; the separate Devnet UI is not mounted on the home page.

Previously verified Devnet creation, initial buy and payout are documented in `deploy/READINESS.md`. That document describes the Devnet release before the interface restoration; this checkpoint clarifies the current UI state. Real Telegram verification still needs the owner's hands-on acceptance test. Mainnet is not ready.

## Continue development

- Preserve the approved design and mock data unless the owner explicitly requests changes.
- Apply future functionality within that existing design; do not substitute a different application shell.
- Synchronize final changes to this GitHub repository as requested by the owner.
- Use exact case-sensitive `TeLe` mint suffix and 80% recipient / 20% project allocation.
- Recipient identity is the current verified Telegram username owner. Privy is the wallet connector.

## Contents and credentials

All 175 tracked files from the snapshot are included, with source, assets, lockfiles, SQL migrations, tests and VPS deployment files. Dependencies, compiled output, runtime databases and local caches are reproducible or environment-specific and are not source files.

`deploy/credentials.enc.json` contains an AES-256-GCM encrypted backup of available credentials. The recovery key is delivered separately to the owner and must never be committed. Restore using `node scripts/restore-credentials.mjs /absolute/path/TelePaid-Recovery-Key.txt /private/output/directory`.

The backup includes Privy configuration, provided RPC URLs, Telegram bot credentials, test wallet, Devnet treasury, mint inventory and hosted development configuration. Keys are a point-in-time backup, not a guarantee that every provider or network is production-ready. Used Devnet mint addresses must not be reassigned.

## Railway handoff

This is a complete checkpoint, not a completed Railway deployment. Start with `deploy/README.md`, `deploy/runtime.env.example`, `deploy/READINESS.md`, `backend/`, and `vps/`. Hosted APIs use Cloudflare D1/R2; the separate VPS backend uses PostgreSQL. They are different deployment targets. Configure Railway Variables/secrets outside Git, adapt the service/storage configuration, and validate the chosen deployment before enabling launch or payout flags.
