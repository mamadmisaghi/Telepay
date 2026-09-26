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

## Live results

- Runtime commit: `0d208d044f7e3d0db66114db9488244cfbde1c46`.
- Web deployment `55875746-6ac1-432d-9f72-6c71e68feebd` and worker deployment `8d7ddb0b-d5a2-45b8-b344-e1e2eae9dbd4` reached SUCCESS. Enabling collection produced worker deployment `b4151493-7bfe-437d-ba5f-54ad06f227ac` (SUCCESS).
- Confirmed live treasury address is the requested `HAM7...veUd5`; ready inventory started at eight and reached nine after an automatic refill. No stale markets or delayed jobs at the check.
- New-treasury mainnet launch simulation with a 0.001 SOL atomic buy and maximum name/symbol lengths passed: 1,148 bytes, 346,055 compute units, 10,000-lamport signature fee. No launch/trade was broadcast by this test.
- Existing shared-token collection and new-treasury payout simulations both passed with signatures verified. A payout simulation is not a completed authenticated claim.
- User-authorized operational funding: 0.005 SOL from the new treasury to the separate gas payer; network fee 0.000005 SOL. Finalized signature: `4g5bcwVKZmAwS686qkMDqKUSsz8io4d2Tuf4bhXwNV43jBTz23Axovx5YpmhJvp84wazri9G7cv4zP76S2LU7YQx`. An earlier attempt expired without landing; the replacement was made only after expiration reconciliation.
- Actual mainnet collection succeeded for both formats. Shared token: 5,456,426 lamports, recipient 4,365,140, project 1,091,286; signature `2rWknJUxMov43LB8gVZAw5B5hHiohi7JyZunKwoJVxHi6UuCYbvRXiTiKiVyuAhvs7N7WURoAc56yWkziVfAonyA`. Legacy collection/sweep: 18,224,192 lamports, recipient 14,579,353, project 3,644,839; treasury sweep signature `3s8pxYwmDGqEensNwtSHLBeCGFQzWpHnzmA5iha3tT3Gv6GCYJWHqQTx4f672CbHGM92fydgXK8FUfELRNuMKioG`.
- At 15:08:51 UTC, treasury held 515,676,618 lamports: initial 497,001,000 minus 5,000,000 gas funding and 5,000 funding fee plus 23,680,618 collected. Thus the old locked treasury's collection was consolidated into the new treasury as intended. Outstanding username liabilities were 18,944,493 lamports. Gas wallet held 1,988,120 lamports after collection/forwarding costs and account rent.
- `gofindahouse` has 14,579,353 lamports (0.014579353 SOL) credited; `oosta987654` has 4,365,140 lamports. No fabricated credits or Telegram identities were created. Final user-authenticated claim confirmation remains to be completed by the account holder.
- Collections and payouts have now been enabled for the funded workflow. Claim release deployment health/runtime verification follows the variable rollout. Direct treasury deposits remain excluded from fee accounting.
- Independent finalized RPC checks confirmed both collection signatures succeeded and the old treasury returned to zero. Consolidation receipt into the new treasury: `47F7VF47Dbj3qhSi3uyqNdi9zXkmZLdvi9kabd55jnAtyRXDrXdMis35ivM2ZHDBbWnSrUU3CJnvnbWCRyQZ7tRP`.
- Payout-enabled web deployment `a400e1a6-114f-4ea0-a4e7-52bc51b383bc` reached SUCCESS. Live `/api/health` returned OK, `/api/runtime` returned `claims:true`, and the public recipient workspace showed the real `gofindahouse` balance with no reservation or settled claim. Fee totals remained stable across restarts.
- Payout-enabled worker deployment `136971ff-13f0-41f8-b1d9-9f0aacdea78a` reached SUCCESS. At 15:13:03 UTC both collections/payouts were true, ready mint count was 10, liabilities and treasury reconciled unchanged, and operational alerts were empty.
