# Atomic launch and real market data — 2026-09-26

## Implemented

- Launch form developer buy is included in the creation transaction. No initial-buy
  component remains on the real token page. Separate buy endpoints return 410;
  the worker still reconciles already-submitted legacy buys.
- Short, immutable, content-addressed metadata aliases retain the old full URLs.
  Legacy prepared messages must be refreshed; signatures remain bound to the
  exact message. Token names must fit 32 UTF-8 bytes.
- Real finalized Pump and canonical PumpSwap trade events are decoded with the
  installed official SDK, persisted idempotently and displayed in SOL. Logs are
  attributed to the executing program; failed or foreign transactions are excluded.
- Market polling indexes at most 12 unseen transactions per refresh from the
  latest 60 signatures per venue. The UI describes recent indexed history, not a
  complete archive. Missing historical intervals are never filled with fake trades.
  Before a first trade, the chart displays a current bonding-curve price snapshot.
- Telegram recipients must have a confirmed profile, in both form and backend.
  Unknown handles have no bypass. Exact public profiles and bot-opted-in profiles
  are supported. `/start recipient` opts into suggestions; `/remove` opts out.
  Registration grants neither a login session nor claim ownership proof.
- Approved sidebar, fonts, header/footer, colors, logo and sample data are preserved.
  Added only scoped market styles inside the existing token detail panel.

## Validation

- 28 backend tests pass, including atomic amount propagation, packet size, mint
  pre-signature, no create-only fallback, legacy quote rejection, immutable metadata,
  trade log spoofing, failed trades, OHLC grouping, persistent indexing and Telegram
  directory opt-in without granting claim proof.
- TypeScript check and Railway Vite production build pass.
- Read-only mainnet simulation of the production chain builder, max 32-byte name,
  10-character ticker and 0.001 SOL requested buy: success, 1220-byte transaction,
  3 instructions, 197743 compute units. Real SDK decoding found the buy event.
- Live RPC testing identified version 1 trades; the market reader now explicitly
  accepts version 1, supported by the installed backend Solana SDK. Reading the
  existing Test token successfully decoded 12 recent buy/sell events.
- No chain transaction was broadcast and no SOL was spent during these checks.

## Remaining limitations

- Full Telegram-wide name/prefix search is unavailable with Bot API alone. It needs
  Telegram API ID, API hash and a securely authorized MTProto user session. These
  have not been supplied. The available lookup does not pretend to be global search.
- Financial collection and payouts remain paused under the existing deployment
  configuration. This release does not claim an end-to-end live fee/claim test.
- A wallet-approved mainnet launch is still the final real-funds acceptance test.
  Earlier create-only tokens cannot retroactively receive an atomic developer buy.
