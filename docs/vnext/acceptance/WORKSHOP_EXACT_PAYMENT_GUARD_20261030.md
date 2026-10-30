# v1.2d — Exact workshop receipt guard (frozen scope before implementation)

**Date:** 2026-10-30. **Parent:** v1.2c Draft PR #56. **Source:** financial gap [#57](https://github.com/barbasmarcosi/ProtocolIA/issues/57). This is a **scoped application of pre-existing `@debitExact` / `@reverseExact` / `@reconcileExact` primitives**, not a new arbitrary financial rules engine.

## Model

- A workshop order has a **configured** exact-decimal `openingBalance` and `available` ceiling (currency-agnostic monetary units, scale 2). For valid test fixtures they initially agree and equal the existing `laborCharge`. **This version does not automatically prove or enforce equality at order creation**, nor calculate parts+taxes. A business user who deliberately supplies mismatched amounts can still create an inconsistent opening balance. Record that as an OPEN critical product gate, not full financial correctness.
- Payments are durable append-only journal rows with `@debitExact("WorkOrder","available","orderNumber","amount")`, positive `decimal` amount encoded as a JSON string; payment status server-initialized `posted`. The parent row is atomically debited in the same DB transaction as insert. If insufficient available balance or duplicate identity, the insert fails and nothing changes.
- A posted payment can move once to `reversed` through `@reverseExact`, which atomically restores the original amount and audits the status. No payment deletion, amount patch or reference reassignment is exposed.
- `@reconcileExact` reads `openingBalance`, remaining `available`, posted and reversed receipt amounts from a single PostgreSQL snapshot and reports whether the **configured** ledger balances. It is not a financial certification.
- Three unchanged parent foreign keys Customer→Vehicle→WorkOrder→Payment (restrict).

## v1.2d acceptance cases (real independent HTTP/Postgres)

| ID | Mandatory observation |
| --- | --- |
| PG-01 | New order with configured opening/available `"10.00"` creates and reconciles balanced with zero posted |
| PG-02 | Payment `"3.10"` persists and reduces parent available to `"6.90"`, same reconciliation snapshot |
| PG-03 | Overpayment `"6.91"` returns 409; neither child nor parent changes |
| PG-04 | Invalid zero amount and JSON number monetary value return 400 with no mutation |
| PG-05 | Duplicate receipt returns 409 and does not double debit |
| PG-06 | Ten concurrent **distinct receipt IDs** for `"1.00"` each against `"3.00"`: exactly 3 commits and 7 conflicts, available `"0.00"`; all 3 durable |
| PG-07 | Invalid/missing reference returns 400; no orphan |
| PG-08 | Reader cannot post/reverse; direct HTTP 403 (UI hiding not a security boundary) |
| PG-09 | A successful reversal restores the exact original amount, preserves receipt with `reversed` and reconciles |
| PG-10 | Repeating reversal returns 409, no second credit; reversing and posting a new payment reuses capacity safely |
| PG-11 | Generated contract, IR, Java/Nest and PostgreSQL agree with no handwritten per-entity generated files |
| PG-12 | Cross-engine observed semantics, amounts, statuses and concurrency decisions match; no floating-point math in the probe |

## Mandatory negative classification

- **OPEN:** System does not force `openingBalance = available = laborCharge + parts` for every newly created order. The generator can guard spending against configured `available`, **not** the correctness of that configured value.
- **OPEN:** Cross-currency, tax, refunds with external payment providers, real banking idempotency/retries, tenant-scoped auth, live backups, PDF/Excel and regulatory invoicing.
- **NOT RUN until CI verifies:** All PG gates. A successful generated compile is not evidence of ledger safety.
- A separate, type-safe generalized initial-balance rule must be designed and implemented before claiming the entire TL-14 requirement or closing issue #57.

**Independent output:** `examples/vnext/workshop-payment-guard`, distinct from the v1.2c frozen fixture. Both adapters must consume identical TypeSpec and pass actual disposable Compose/PostgreSQL tests. Exact SQL behavior comes from existing shared validated adapters, not hand-written app-specific source.
