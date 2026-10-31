# S2c-0 — Source-backed exact ledger drift detection (acceptance freeze)

Baseline: merged S2b-1 on `main` at `41067ed6`. Scope: read-only cross-check and fail-closed financial mutations before proposing any repricing contract. Issue #57 stays open.

## Problem

The receipt journal can be internally balanced even when a privileged/out-of-band PostgreSQL mutation changes an immutable `ChargeLine` while leaving the order's `chargeTotal`, `openingBalance`, `available` and payment journal unchanged. For S2b-1, `balanced=true` meant journal consistency only. An itemized finance contract must also reconcile its **persisted, authoritative child rows**.

## S2c-0 invariants

- S2C0-01: only an explicit reviewed `@createDetails(..., chargeAmountField, chargeTotalField)` attached to an exact reconciled parent enables source aggregation; regular nonfinancial details and scalar exact charge sources retain their existing semantics.
- S2C0-02: a single bounded query snapshot for reconciliation checks **both**: the existing journal invariant (`available = openingBalance - postedTotal`) **and** `1 <= count(chargeRows) <= 20`, `SUM(chargeRows.amount) = parent.chargeTotal`, `parent.openingBalance = parent.chargeTotal`. Use PostgreSQL `numeric` and validated IR identifiers; no JS floating point, unreviewed dynamic SQL or client-controlled expression.
- S2C0-03: `balanced` is false and lifecycle `coverageState` is `inconsistent` on any mismatch; existing eight/nine response keys and other coverage states are unchanged. `difference` continues to mean **available-minus-journal-expected**, so it may be zero on a source-only mismatch (not a false total-drift indicator).
- S2C0-04: for new receipt POST and receipt reversal, acquire the existing parent `FOR UPDATE` lock and then read a fresh `READ COMMITTED` reconciliation snapshot. If any source/journal drift is found, return HTTP 409 with no new receipt/reversal state/audit/balance mutation. A direct source row cannot be mutated via generated HTTP.
- S2C0-05: proof on **both generated NestJS and modular Spring** using isolated real PostgreSQL and HTTP: valid line sums, privileged direct update, insert, delete, and parent charge-total alteration each produce `inconsistent`, block a new receipt with zero writes, then restoring the data re-enables valid receipt; previously green 10-way 3/7 concurrency and once-only reversal must remain green.
- S2C0-06: preserve TypeSpec generator, React mobile and legacy single-/multi-scalar financial and generic bounded-detail conformance; run general quality, actual financial workshop on both engines and the S2b itemization suite without regressions.

## Explicit non-goals and risk

This is a **detection** barrier, not approved repricing or prevention of a privileged database administrator from making out-of-band changes. A separate S2c-1 requires a contract-governed, authorized repricing workflow with idempotency, journal-amount policy, auditable positive/negative adjustments, stable lock order, transaction isolation and external settlement considerations. A privileged DB actor could still race an in-flight transaction unless DB permissions and mutation privileges are separately locked down. No tax/discount/refund/credit notes, billing provider, stable financial tag, production launch, or closing #57.
