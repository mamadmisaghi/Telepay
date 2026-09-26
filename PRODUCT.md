# TelePay product policy

Name TelePay; project token Tele; ticker TELE. Solana / Pump.fun.

80% of actually received creator fees belongs to the named Telegram **username**; 20% is the project allocation. Apply the split once on finalized collection, never again on withdrawal. No buyback, burn, supply, expiry, or TELE-specific exemption has been approved.

## Username ownership — user decision 2026-09-26

The launcher enters a handle only. No recipient ID, enrollment or ownership check is required at creation. Normalize by removing a leading @ and lowercasing. Funds are keyed by handle. Whoever freshly verifies that handle through official Telegram login can claim its unreserved balance, even after a username sale or reassignment. Already reserved claims retain their recorded destination. Internal user IDs support sessions and wallet authorization only; they do not own handle balances.

Every new claim consumes a fresh Telegram proof, valid for two minutes. Reauthentication is required for another claim. A wallet challenge is separately required before payout. Telegram OIDC attests the username at verification time; it is not a perpetual guarantee against subsequent reassignment.

## Mint signature

Exact approved suffix: **TeLe**, case-sensitive. Mandatory for all launches, no user toggle or random-address fallback. Keys are generated cryptographically, encrypted, reserved atomically, and never reassigned after exposure to a prepared transaction. The suffix alone is not authenticity proof.

## Deployment state

Hosted Sites URL is the interface preview. The VPS build uses the Node API and genuine database/chain records only. Backend source and local integration tests are present; Telegram credentials, actual RPC/keys, VPS deployment and controlled network tests remain external activation requirements. See deploy/README.md.
