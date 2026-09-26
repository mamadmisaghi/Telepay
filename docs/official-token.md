# TelePay official token

The reserved official Solana mint is `G3odGzwyaYgjzwh5yUizB5WEh8MEdW1wg4TpjGVnTeLe`.
The expected Pump creator and launcher wallet is the project treasury, `HAM7o9fKUaJ5NGDxVcW4HxzLeMyqgmN8fPnKmmbveUd5`.

Import the already generated mint keypair into the external launcher. Connecting the treasury wallet alone will not make the minted address end in `TeLe`: the launcher must accept a separately supplied mint signer. Review the public mint address and the treasury as both the payer and creator before signing. Never upload either private key to Git or this site's launch form.

Migration `007_official_mint.sql` registers the public mint in `official_mints` with status `waiting`. The worker checks finalized Pump bonding curve state and the Pump CreateEvent for the exact mint and treasury. Once both match, it inserts one confirmed launch in the common token list and market index. The Home, Explore and token detail pages use the normal live token APIs. The official launch is excluded from Telegram recipient fees, the 80/20 ledger and Claim.

If the token does not appear after launch, check the Railway worker logs for `official_mint_retry` or `official_mint_imported`, and ensure the external launcher actually used this mint signer, created the Pump coin on mainnet, and set the treasury as creator. An ordinary new mint from that wallet cannot be substituted for the registered address.
