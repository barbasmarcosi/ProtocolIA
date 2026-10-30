# v1.2d — Exact checked workshop receipts: real PostgreSQL acceptance

**Date:** 2026-10-30 UTC. **Parent:** v1.2c Draft PR #56. **Financial issue:** [#57](https://github.com/barbasmarcosi/ProtocolIA/issues/57). **Scope frozen before implementation:** [WORKSHOP_EXACT_PAYMENT_GUARD_20261030.md](../acceptance/WORKSHOP_EXACT_PAYMENT_GUARD_20261030.md).

**Authoritative real CI:** [GitHub Actions #41088807245](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41088807245), **SUCCESS both NestJS and modular Spring Boot**. General quality [#41088807538](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41088807538) and [#41088815420](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41088815420): **SUCCESS** (five normal quality jobs). Functional commit `a3144eaac10a84b3fbd52b92254a045ba9ac2645`.

## Generation and isolation

The new independent application `examples/vnext/workshop-payment-guard` keeps all four customer/vehicle/order/payment entities. Workshop-specific TypeSpec alone adds the pre-existing, reusable general semantics `@debitExact`, `@reverseExact`, `@reconcileExact`: a posted payment decrements the parent order's configured nonnegative balance in the same transaction as its durable insert; reversal is one-time, audited and credits exactly the original debit; reconciliation reports one PostgreSQL MVCC snapshot. Payment deletion is intentionally absent. **No per-entity Java, Nest, SQL, React edits**.

**Both targets emitted identical contract SHA-256** `398447dd29a01519962d176c1ae97d1eb9baed4c0f120ed6574ffa3a20e2c7a2`; identical canonical IR SHA-256 `474c50de1309770b54cf155529fcd86819f7ace6336399547d8b7f4d2dcc8af8`; identical OpenAPI SHA-256 `8e029fec82958cabb59d44572b1b8ea9a7e9dea54be25810edc03bab6beddbee`. Standard TypeSpec 1.17.0, Node 24, Java 21 for Spring.

Each CI target generated a new app, passed generic `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS` on isolated PostgreSQL, then spun up a **second** disposable random-named Docker Compose PostgreSQL instance for the independent financial oracle. All tests use synthetic records and random demo credentials; `down --volumes --remove-orphans` cleans up. No production data, live payment provider, real bank or hosted service.

## Observed scenario results

| Case | Mandatory transaction/safety result | NestJS | Spring Boot |
| --- | --- | --- | --- |
| PG-01 | Order opening/available `"10.00"`, initial ledger balanced, zero postings | PASS | PASS |
| PG-02 | Post `"3.10"` as string, available exactly `"6.90"`, snapshot matches | PASS | PASS |
| PG-03 | Post `"6.91"` denied 409, parent/child unchanged | PASS | PASS |
| PG-04 | Zero amount and JSON numeric amount denied 400 with no rows | PASS | PASS |
| PG-05 | Repost same receipt key denied 409, no double debit | PASS | PASS |
| PG-06 | Ten simultaneous `"1.00"` distinct receipts against `"3.00"` | **3 × 201 + 7 × 409** | **3 × 201 + 7 × 409** |
| PG-07 | Missing order reference rejected, no orphan row | PASS | PASS |
| PG-08 | Reader direct POST/reversal denied 403 | PASS | PASS |
| PG-09 | One reversal restores exact `"3.10"`, persists `reversed`, balances | PASS | PASS |
| PG-10 | Second reversal denied 409; new payment can reuse restored capacity; overage denied | PASS | PASS |
| PG-11 | Canonical TypeSpec/IR semantics and no journal delete bypass | PASS | PASS |
| PG-12 | Compare independent real target outputs, contract/IR fingerprints and cases | **PARITY PASS** | **PARITY PASS** |

Both target job logs contain **11 individual `PROTOCOLIA_V12D_FINANCE_CASE_PASS PG-01..PG-11` markers**, followed by `PROTOCOLIA_V12D_EXACT_PAYMENT_GUARD_PASS`. Shared observation: `overspendDenied:true`, `parallelCommitted:3`, `parallelConflicts:7`, `reversedExact:true`, `reconciled:true` and the same IR hash. PG-12 is a **cross-job comparison of those observed results**, not a twelfth in-process log marker.

All financial amounts are sent and read as exact decimal JSON strings and compared by integer minor units; the test never sums money with JavaScript floating-point.

## False starts corrected transparently

- First compile/DB run [#41088395452](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41088395452) detected a **generic conformance cleanup bug**: it wrongly expected 204 when deleting a parent with an **immutable, still-present financial journal child**. The generated PostgreSQL/HTTP implementation correctly rejected deletion with 409. The framework-independent `packages/cli/conformance.mjs` test was fixed to check live referenced child fixtures at each hierarchy level and expect restrict conflict, without adding a business-specific exception.
- One preliminary source revision fixed the financial test's decimal regular expression (a literal double backslash); no financial condition was waived.
- Final dual-engine run #41088807245 is green after these corrections.

## **Blocking financial gap: issue #57 MUST remain open**

**`openingBalance`, `available`, and `laborCharge` are separately supplied fields in the generated WorkOrder creation form and API. No declarative invariant yet forces `openingBalance = available = laborCharge + validated parts/taxes`.** The atomic debit prevents overspending **the supplied available balance**, but it cannot tell if a manager configured it incorrectly. Even a consistent reconciliation later may only prove consistency against an incorrect opening balance. This is not end-to-end financial correctness.

Unimplemented/not verified: source-of-truth charge calculation; derived starting balance with DB and API enforcement; refund/void processor integration; paid invoices; real gateway idempotency; multi-tenancy and production identity; backups; Excel/PDF; accessible UI flows of new financial operations; hosted reliability. No releases or production changes, no merge of Draft PRs #55/#56/#58.

**Truthful milestone: scoped PG-01..PG-11 PASS ×2 + PG-12 cross-target parity PASS; transactional overpayment guard and exact reversal proven for a correctly configured opening balance, full issue #57 OPEN.**
