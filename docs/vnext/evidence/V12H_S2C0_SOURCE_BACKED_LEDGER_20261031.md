# S2c-0 — persisted source-backed exact ledger drift detection: evidence

Verified on functional SHA `3001f2733e2fd36d3432dd8aa5ca6766d2e50b59` in PR #65, 31 October 2026. Synthetic/test-only PostgreSQL and Chromium, **no real customer money**.

## CI evidence

- [Itemized workshop dual target #41162995227](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41162995227): **SUCCESS NestJS + modular Spring**. Generated apps compiled and passed generic HTTP/DB conformance on isolated PostgreSQL, generated mobile Chromium (390x844), exact charge ledger and 10-way receipt acceptance. The extended oracle injected out-of-band SQL UPDATE, INSERT, DELETE on child charge lines and UPDATE of parent charge total/opening; every case returned `balanced=false`, `coverageState=inconsistent`, HTTP 409 on attempted new receipt and reversal, 0 new receipt/audit, unchanged balance. Restoring data resumed lawful receipts and once-only reversal.
- [Existing scalar-source financial workshop #41162995228](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41162995228): **SUCCESS both independently generated targets**, preserving existing journal behavior, exact source, drift-safe lock protocol and mobile acceptance.
- [General PR quality #41162995296](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41162995296): **SUCCESS five jobs**. [Push quality #41162978134](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41162978134) also SUCCESS.
- [Acceptance freeze](../acceptance/V12H_S2C0_SOURCE_BACKED_LEDGER_DRIFT_20261031.md) remains the governing scope. Both generators use the **same** `compileExactReconciliations` SQL. No change to the external schema response fields.

## Technical explanation

For a declared financial `@createDetails` with a reconciled parent, the one PostgreSQL statement now evaluates:

1. existing journal integrity: `available = openingBalance - SUM(postedReceipts)`
2. source integrity: `COUNT(chargeRows) BETWEEN 1 AND 20`, `SUM(chargeRows.amount) = chargeTotal`, and `openingBalance = chargeTotal`.

A source-only mismatch can leave the reported **journal-specific** `difference` at zero. The independent `balanced` and `coverageState` fields correctly report the inconsistency, and POST/reversal uses the same snapshot **after the parent lock**. Money comparisons are PostgreSQL `numeric`, never JavaScript float. The generated HTTP interface still seals independent charge-row mutation.

## Explicit limitations and handoff

This is *detect-and-reject*, not a legal or business-approved correction workflow. It is not a cryptographic history and does not detect a privileged same-total replacement of rows. An administrator with full database privileges may alter the database or race a financial transaction; production roles, row policies, privileged audit integrity and stronger isolation need separate controls. Do not interpret 'covered' as external bank settlement. No approved repricing, tax/discount policy, refunds, credit notes, merchant provider, production IAM/tenancy or backups were built. Keep issue #57 OPEN and **no stable finance tag or production deploy**. S2c-1 must freeze business decisions for signed adjustments and previously posted receipts before writing money-mutating code.
