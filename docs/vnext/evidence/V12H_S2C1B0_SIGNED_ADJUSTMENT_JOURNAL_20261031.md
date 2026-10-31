# S2c-1b0 — append-only signed journal and exact money reconciliation: evidence

Tested functional head `3f35d8416a630701bc703cabb4a1d56d05f2dde8` on 2026-10-31. See [frozen acceptance](../acceptance/V12H_S2C1B0_IMMUTABLE_ADJUSTMENT_JOURNAL_20261031.md).

## Verified GitHub Actions

- [S2b/S2c itemized NestJS + modular Spring #41165124836](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41165124836): **SUCCESS both generated targets** using isolated Docker PostgreSQL, real HTTP and mobile Chromium 390×844. Individual logs contain `PROTOCOLIA_S2C1B0_JOURNAL_PASS immutable idempotency and source-drift denial` and `PROTOCOLIA_S2C1B0_JOURNAL_ALL_PASS nestjs` / `modular-spring`.
- [Legacy exact financial workshop #41165124855](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41165124855): **SUCCESS NestJS + Spring**; no regression to scalar-source receipt journal, concurrency, once-only reversal, mobile acceptance.
- [General quality #41165124798](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41165124798): **SUCCESS all five jobs** (artifact/type/schema and both Python unit versions).

## Executed database checks

A compiled `@reconcileExact(... adjustmentJournal=true)` now validates source balance as `SUM(originalChargeLines.amount) + SUM(signedAdjustments.delta) = parent.chargeTotal = openingBalance`, alongside the existing `available = opening - postedReceipts`, nonzero row bound 1–20 and journal row count 0–100, all in a single PostgreSQL NUMERIC MVCC snapshot.

For each independently generated backend, the synthetic oracle:

1. Created an order with immutable 2.00 + 1.00 original charges and an existing 1.00 receipt.
2. Inserted a signed -0.50 correction **via privileged PostgreSQL fixture only** without updating parent balances; read `balanced=false` / `coverageState=inconsistent`, and observed 409 for new receipt and reversal, with zero receipt creation.
3. Verified the DB rejects UPDATE/DELETE of an adjustment and denies repeated per-parent adjustment ID, zero delta and a nonexistent parent FK.
4. Simulated the eventual write operation **through test-only SQL**: one transaction moves chargeTotal/opening from 3.00 to 2.50 and available from 2.00 to 1.50. Result: `balanced=true`, `partial`, exact read 2.50/1.50/1.00; original immutable charge rows still 2.00 and 1.00; further valid 0.50 receipt accepted.
5. Simulated +0.30 signed journal on a zero-charge order through one privileged SQL transaction; source exact total and preview recomputed consistently without changes to original zero row.
6. Re-ran preceding itemization, 20-row, five privileged source-drifts, 10 competing receipts / 3 accepted / 7 conflicts, reversal, and 390×844 Chromium acceptance.

## Explicit exclusions and trust limit

**No application HTTP endpoint** creates or applies a financial adjustment. The privileged test-only SQL is *not* a production workflow or authorization model. The journal's actor/reason/adjustment ID are stored, but user-authenticated actor ownership, reason validation in HTTP, transactional app audit, API idempotency and multi-user concurrency remain S2c-1b1 tasks. The signed ledger proves exact arithmetic, not customer consent, tax/discount accounting, external card/bank settlement or legal credit notes. Database owners can alter triggers; cryptographic tamper protection, migration of production data, roles/tenant IAM and backup recovery are not covered. No stable financial tag or production deployment. Issue #57 remains OPEN.
