# Treasury and worker operations — 26 September 2026

This report supersedes older readiness reports for treasury configuration and worker operations. Deployment evidence and financial test results are recorded separately after rollout.

## Treasury rotation

New launches assign 100% of Pump creator fees to `HAM7o9fKUaJ5NGDxVcW4HxzLeMyqgmN8fPnKmmbveUd5`. The supplied signing key was checked against that public address. Keys are server variables; no signing key is in the frontend or this commit.

Existing locked fee-sharing contracts retain their original destination, including `Gs5XjivVJVQNmAhcHVVXZYUivTJ6NmhhBZJRVP7UfVn2`. Retained treasury keys let the worker continue collecting those fees and consolidate old SOL balances into the current treasury. Consolidations persist a signed transaction before broadcasting, resume the same signature after interruption, verify the finalized recipient/amount and never create another fee credit. In-flight legacy sweeps retain their actual transaction destination across rotations.

Actual finalized creator-fee receipts are accounted once: 80% to the current Telegram username's balance, 20% to the project. PostgreSQL is the persistent ledger. Depositing operational funds directly into a treasury does not create claimable fees. A fresh Telegram ownership proof and wallet signature remain mandatory for each claim. Gas payer remains separate: `BU6RZQ1R9upPsUVqpnHYSc7Kjj5gYHDYZJYKkuRHBVUz`.

## Worker operations

- Persistent round-robin batches cover all confirmed tokens for market indexing, fee-receipt scans and collection eligibility; older tokens no longer fall outside a fixed first/latest-N selection.
- Eight additional exact-case `TeLe` signers were generated privately. Import is idempotent and never resets reserved/consumed keys.
- Worker native libsodium generation refills toward 20 ready mints, with one CPU thread and a 60-second budget per 300 seconds. Candidates are encrypted before PostgreSQL storage; temporary private files are removed. A database advisory lock prevents concurrent refill across replicas.
- Once-per-minute operational status records/logs mint inventory, operator/treasury balances, liabilities, delayed jobs, stale market data and financial enable flags. This is local monitoring, not an external notification integration.

## Validation and remaining gates

41 backend tests passed, including treasury rotation/retry/receipt mismatch and existing financial/authentication regression coverage. Mainnet simulations do not prove a real claim has completed; never fabricate a Telegram identity or fee credit to make that test pass.

The live site still needs the user's final domain and its DNS configuration, followed by origin/Privy/Telegram checks. Native Railway backup scheduling could not be independently inspected/configured through the available connector during this review; the historical claim of daily backups is not new verification. Confirm schedules in the Railway dashboard and complete a restore drill. Keep a secure independent recovery copy of every retained treasury key and database encryption key.

The launch flow currently uses a public address lookup table. Its active state is checked for every preparation, but its authority is external; an owned table removes that availability dependency. Global Telegram suggestions still require a dedicated user-account MTProto session; exact username lookup already works with the bot.

No frontend layout, logo, typography or sample listings changed in this release.
