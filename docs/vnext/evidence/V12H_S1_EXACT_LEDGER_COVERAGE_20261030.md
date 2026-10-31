# ProtocolIA v1.2h-S1 — Exact recorded-receipt coverage (not payment settlement)

**Frozen acceptance first:** [V12H_S1_LEDGER_COVERAGE_20261030.md](../acceptance/V12H_S1_LEDGER_COVERAGE_20261030.md). **Draft:** [PR #60](https://github.com/barbasmarcosi/ProtocolIA/pull/60), stacked on [#59](https://github.com/barbasmarcosi/ProtocolIA/pull/59); **issue [#57](https://github.com/barbasmarcosi/ProtocolIA/issues/57) still OPEN**. 2026-10-30 local / 2026-10-31 UTC.

## Observed reproducible acceptance

- **Final functional code** `088fb55dcf358eb89df86fecd483257785187605` (TypeSpec runtime and corrected frozen legacy opt-out control).
- [GitHub Actions #41154795377](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41154795377) **SUCCESS BOTH**: generated NestJS (job 124399112945) and modular Spring Boot (job 124399112756) from one checked TypeSpec contract. Each ran generic HTTP/PostgreSQL conformance, live randomly named disposable Docker Compose/PostgreSQL, a 390×844 Chromium create against the generated React UI, and 11/11 original receipt financial tests. 10 competing 1.00 receipts against 3.00 still result in exactly three accepted and seven rejected writes; one-time reversals and exact balances remain safe.
- Both targets report the same **contract SHA-256** `9e14f5cf11f549def3c9786bbb01925ea2e2c311175d95878e5d5524b4cf0552`, **canonical IR SHA-256** `3aa46d0e46157d76ae0d54f7d9fdea973e48ad5386f2073ec7b933da7c484d52`, and **OpenAPI SHA-256** `e94be5df8b9040f46235107d9e0897b53ee357eb1c87dcbdfc6f0d8a388f8b27`.

## Semantics delivered

Additive optional last flag to existing TypeSpec decorator:
`@reconcileExact(opening, available, child, fk, amount, status, posted, reversed, chargeSource, true, true)`.
The final `true` requests a ninth required string `coverageState` in the typed reconciliation response; the default remains the previously verified eight-field response. Compiler rejects a ninth field with the flag absent or a flag with the ninth field absent; requires server-only immutable source-declared balance.

Both targets execute the **same generated validated PostgreSQL reconciliation query** and derive this classification in one MVCC snapshot, no second persisted flag:
- `inconsistent`: available != opening - posted receipts. Highest priority, regardless of amount.
- `no_charge`: opening = zero, coherent journal, no payment assumed.
- `unpaid`: positive opening, zero posted receipts, coherent journal.
- `partial`: positive opening, some posted receipts, available still positive, coherent journal.
- `covered`: positive opening, posted internal receipts equal total, available zero, coherent journal.

The word **covered** refers to internal receipt records, NOT actual external banking/payment-provider settlement or legal financial discharge. Reversal automatically removes a receipt from the posted sum; no separate mutable coverage state to drift. This milestone introduces **no new financial write behavior**, unlike an external refund API.

## Executed LC tests on BOTH targets

| Test | Observed result |
|---|---|
| LC-01 | Initial positive exact two-charge order = `unpaid`, zero posted; PASS ×2 |
| LC-02 | Posted strict partial receipt = `partial`, exact remaining; PASS ×2 |
| LC-03 | Concurrent exhaustion of 3.00 with three accepted receipts = `covered`, zero available; PASS ×2 |
| LC-04 | Additional synthetic order: two receipts fully cover; reverse one becomes `partial`, reverse last becomes `unpaid`, second reversal 409; PASS ×2 |
| LC-05 | Zero-charge synthetic order = `no_charge`, never spuriously covered; PASS ×2 |
| LC-06 | Generic PG conformance, 11 previous financial cases, all v1.2g multi-charge cases, 390×844 Chromium real create, zero browser errors, identical IR/OpenAPI digests; PASS ×2 |
| LC-07 | Synthetic prior eight-field TypeSpec contract without new opt-in compiled successfully with both jobs (marker `PROTOCOLIA_LEDGER_COVERAGE_LEGACY_OPTOUT_PASS`); **compiler compatibility PASS**, old-mode *runtime separately not re-executed* |
| LC-08 | Four additional invalid TypeSpec variants rejected with correct errors: ninth field but no flag, flag without field, flag without source-managed balance, wrongly typed field; original ten invalid multi-charge variants also rejected; PASS ×2 |
| LC-09 | Test-only privileged `psql` on disposable Compose altered `work_order.available` from 10.00 to 9.00; reconciliation returned `balanced=false`, `coverageState=inconsistent`, exact opening/available; restored balance and observed `unpaid`; PASS ×2 |

**Browser request keys observed in each job:** `["laborCharge","number","partsCharge","status","symptom","vehiclePlate"]`, no client-supplied opening/available, screenshot SHA-256 `9aaa08e013100ed1e903e04d89c302e4eca193c2a5ddcd6b2ab5fce4f11e1223`. Identical post-create screenshot bytes are not a substitute for UX accessibility certification.

## Test repair history

After initial full acceptance [#41154302484](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41154302484), a stricter positive control was added to compile the legacy eight-field TypeSpec variant. Its first fixture accidentally deleted a closing parenthesis when dropping the final decorator option; TypeSpec 1.17's diagnostic renderer then crashed with `RangeError: Invalid count value: -1`. [Run #41154616803](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41154616803) properly **FAILED** (not accepted). The fixture was corrected to retain `)`, without loosening any product compiler guard; final dual-target [#41154795377](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41154795377) **SUCCESS** and printed explicit legacy opt-out PASS ×2. Other earlier cancelled intermediate runs are development history, not evidence.

## Open work: v1.2h-S2+ and beyond

- **No mutable charge line items or controlled repricing**. A safe in-place change requires reviewed approval, audit, atomic compensation with already posted receipts, precise tax/discount policy and rollback.
- **No payment-provider settlement or authenticated webhooks**, refunds/credit notes, externally attested posted receipt, legally compliant invoice, production IAM, customer/workshop tenancy isolation or durable backup/restore.
- State `covered` is never an externally cleared-payment claim. No user or business-customer signoff. PR remains Draft; no changes to `main`, tags, stable releases or production deployments.

**Acceptance conclusion:** v1.2h-S1 internal exact coverage lifecycle is **VERIFIED ×2**. The full TL-14 financial workflow and issue #57 stay **PARTIAL / OPEN**.
