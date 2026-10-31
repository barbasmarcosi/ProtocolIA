# v1.2h-S2a — Fail-closed exact receipts on inconsistent ledger

2026-10-30 local / 2026-10-31 UTC. [Frozen acceptance](../acceptance/V12H_S2A_EXACT_LEDGER_MUTATION_20261030.md) committed before functional code. This is **a narrow financial safety prerequisite**, not dynamic charge-item support or real bank settlement.

## Verified actual build and execution

**Functional candidate:** `565dee8ef831ae7bfb2d3b0cf82e24df9217fdbe`.

[GitHub Actions #41156645175](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41156645175) **SUCCESS on both** generated applications:
- NestJS (job `124404789914`)
- Spring Boot modular (job `124404790100`)

Each independently compiled the same contract; both reported identical `contractSha256=9e14f5cf11f549def3c9786bbb01925ea2e2c311175d95878e5d5524b4cf0552`, `irSha256=3aa46d0e46157d76ae0d54f7d9fdea973e48ad5386f2073ec7b933da7c484d52`, `openapiSha256=e94be5df8b9040f46235107d9e0897b53ee357eb1c87dcbdfc6f0d8a388f8b27`. Actual generated HTTP/PostgreSQL/Chromium and previous source-declared exact charge, compiler-negative and legacy opt-out suites completed. [Quality #41156645123](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41156645123) five jobs SUCCESS.

## Generic implementation, not hardcoded WorkOrder

For every generated `@debitExact` or `@reverseExact` targeting an entity that also has `@reconcileExact`, both runtime adapters now call a shared internal precondition:
1. Lock that validated parent balance row via `SELECT ... FOR UPDATE` in the **same existing transaction**.
2. In a *new* SQL statement after the parent lock, execute the already-generated exact reconciliation snapshot on the same transaction connection. This matters under PostgreSQL READ COMMITTED: a correlated SUM inside the first UPDATE can observe a stale statement snapshot despite the UPDATE waiting for another writer.
3. If the snapshot reports `balanced=false`, fail with HTTP **409**, rolling back the entire request.
4. For reversals, fetch the immutable reference before the transition, acquire the parent lock and validate **before** changing the receipt status. That prevents a valid in-transaction reversal from falsely appearing inconsistent just because the credit has not yet been applied.
5. If no exact reconciliation plan exists, previously supported standalone exact debit/reversal paths retain their behavior.

All identifiers come from validated compiled IR and emitted plans. No second money ledger, no external API call, no custom WorkOrder code in generated framework runtime.

## Runtime cases observed in both targets

| Case | Evidence | Outcome |
|---|---|---|
| DG-01 | Test-only corrupted `available=9.00` vs declared opening 10.00, no posted receipt; valid 1.00 payment rejected HTTP 409; receipt GET 404; audit `Payment/DRIFT-POST` count 0; persisted available still 9.00 | PASS ×2 |
| DG-02 | Valid 3.00 receipt of 10.00 order, externally tampered available 7→6; reversal HTTP 409, receipt stayed `posted`, no status-reversal audit, available remained 6.00. After controlled repair to 7.00, reversal 200 once, second call 409, reconciles to `unpaid` | PASS ×2 |
| DG-03 | Unknown parent reference keeps existing 400 and no partial receipt via prior PG-07 test | PASS ×2 |
| DG-04 | All preexisting 11 payment tests incl. 10 concurrent 1.00 against available 3.00 (3 accepted, 7 conflicts), exact reversal and reconciliation; v1.2g multi-charge and v1.2h-S1 lifecycle tests; previous negative TypeSpec guards | PASS ×2 |
| DG-05 | Standalone exact operations without reconciliation unaffected by conditional plan path | Design-preserved, **not a separate fresh standalone runtime oracle** |
| DG-06 | Actual disposable PostgreSQL, HTTP/DB, 390×844 Chromium, zero browser errors, no client-managed opening/available | PASS ×2 |
| DG-07 | No new operation routes, permissions or privileges added; existing role-negative HTTP tests still pass | PASS ×2 |

Both logs contain `PROTOCOLIA_LEDGER_DRIFT_GUARD_PASS DG-01`, `DG-02`, `PROTOCOLIA_V12D_EXACT_PAYMENT_GUARD_PASS` with `passedCases:11`, `parallelCommitted:3`, `parallelConflicts:7`, `reversedExact:true`, `reconciled:true`, and `PROTOCOLIA_SERVER_ONLY_MOBILE_PASS`.

## Open risks

- This guard **does not repair** corrupted persisted money. It halts writes and requires a trusted operator to investigate, fix and document an integrity breach. The corrupt-data mutation in CI only targets temporary isolated databases. No production DB altered.
- No separately simulated SIGKILL at each new guard instruction was added in this S2a matrix; atomicity relies on the existing DB transaction boundaries (explicit Nest BEGIN/ROLLBACK/COMMIT, Spring transactional dispatcher) and their previously proved failure behavior. Do not claim a new crash-at-every-point proof.
- No dynamic charge rows, tax, discounts, mutable repricing, refund/credit-note accounting, provider idempotency/receipt confirmation, audited operator repair, external customer acceptance, tenant production IAM, or backups. Financial issue #57 remains **OPEN**.

**Verdict:** v1.2h-S2a scoped transactionally protected recorded-receipt mutations PASS independently in NestJS and modular Spring. This does not certify full real-money financial processing.
