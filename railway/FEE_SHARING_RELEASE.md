# TelePaid fee sharing and market release — 2026-09-26

## Launch

New launches record the connected wallet as the original Pump creator. One wallet-approved transaction executes create_v2 → create_fee_sharing_config → update_fee_shares_v2 (100% treasury, creator admin revoked) → optional ATA + initial buy. The mint is co-signed before wallet approval; exact-message verification remains enforced. `TeLe` remains mandatory.

Mainnet RPC simulations (no broadcast / no payer signature): max 32-byte name and 10-byte symbol, 961 bytes without buy, 1148 bytes with 0.001 SOL buy, 262006 / 353392 compute units, 10000 lamport signature fee. Account rent and optional buy are additional. Simulations succeeded using existing public ALT `Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP`; active table state is checked on every preparation. Existing ALT indices cannot be rewritten, but its authority may deactivate the table. An owned, pre-funded replacement is recommended for independent infrastructure; unavailable tables fail closed.

Pump's current curve creator becomes the sharing-config PDA; the initial creator event identifies the user's wallet. GMGN's proprietary Offchain label is not guaranteed to change and requires observing a new real launch.

## Fees

Legacy dedicated-creator tokens retain their original collection/sweep path. New tokens distribute directly from their per-mint sharing vault to the treasury. Received finalized fees are split 80% username / 20% project, once. Permissionless distributions by other callers are indexed too; `(launch_id, signature)` deduplication prevents double-credit and permits multi-token distributions in a single transaction. Fresh Telegram ownership and wallet proof remain required for claims.

Collections and payouts remain disabled pending funding of the separate gas payer and a controlled real-money end-to-end test. No mainnet transaction was broadcast by this release's tests. Operator at inspection: `BU6RZQ1R9upPsUVqpnHYSc7Kjj5gYHDYZJYKkuRHBVUz`, 0 lamports. Treasury: `Gs5XjivVJVQNmAhcHVVXZYUivTJ6NmhhBZJRVP7UfVn2`, 0 lamports.

## Telegram

Both user-provided credential pairs were accepted by Telegram on Railway. Both authenticated as TelePayFunBot and resolved Gofindahouse with profile-photo metadata. Both returned BotMethodInvalidError for contacts.search: this is the expected user-only API restriction. Series 1 is selected. No credentials are stored in this document or committed code.

Exact public-user lookup uses MTProto, including available profile photo, with caching, request throttling and cooldown. Bot login/claim verification is separate. Global username suggestions activate when TELEGRAM_SEARCH_SESSION is supplied. A failed lookup is not evidence a username is vacant.

To create the user session on your computer (dedicated project account):

```powershell
cd backend
py -m pip install telethon==1.45.0
py scripts/telegram-user-session.py
```

Enter API ID/hash, project account phone, Telegram code and 2FA password locally. The script tests contacts.search and writes `deploy/secrets/telegram-user-session.env`, excluded from Git. Copy its three settings to Railway's web service Variables. Do not send the login code, 2FA password or session in chat. The session authorizes the Telegram account, not just search; revoke it in Telegram Devices if no longer needed.

## Market data

Background indexing paginates finalized curve/PumpSwap transactions with durable cursors; it never advances past a failed RPC response. Anchor event CPI metadata recovers events truncated from runtime logs. USD candlesticks and USD trade values use historical Kraken SOL/USD 5-minute candles, explicitly labelled as indicative conversion; current USD price uses the current SOL/USD candle. Unavailable rates stay null. Coinbase was tested and returned HTTP 403 from Railway; Kraken OHLC and ticker succeeded.

Full 24h volume remains pending while catch-up is incomplete. 24h price change requires a pre-window baseline and at least 24 hours of token history. Market cap uses actual mint supply. Holders count unique on-curve wallet owners with positive balances across paginated DAS token accounts; program-controlled accounts are excluded. Holder data is cached for 5 minutes and hidden if stale beyond 10 minutes. Market charts show the last 25 hours of indexed trades; earlier trades remain in the database.

The approved graphite/blue shell, logo, typography, sidebar, launch controls and sample listings are preserved. Scoped changes: candlestick chart + volume/crosshair/zoom, top statistics bar, copyable contract address, recipient lookup hints. TradingView Lightweight Charts attribution is included.
