# v1.2h-S2b — immutable exact charge lines (acceptance freeze)

Frozen 2026-10-30 local, before any S2b functional change. Base: merged v1.2h-S2a on `main` at `9cff111b`. Issue #57 remains OPEN.

## Business problem and authoritative source

A work order currently copies two immutable scalar amounts (`laborCharge`, `partsCharge`) into its server-derived exact opening balance. That is a safe bounded test, **not** itemized billing. The desired next step is **one atomic creation** of an order and **1–20 immutable, typed exact charge rows**. Every amount must come from validated authoritative row data, never from a client-supplied opening or available balance, hidden UI state, or a separately editable aggregate. Reuse the already existing canonical `@createDetails`, exact-decimal and `@reconcileExact` primitives; extend only the missing reviewed semantics. Never expose arbitrary SQL.

## Phase S2b-0 — close the unreviewed composition path (this PR)

- B0-01: a generic header/detail creation is rejected at adapter preflight if its parent also has an exact ledger reconciliation. A plain `@createDetails` contract is **not** automatically an approved financial charge-line contract.
- B0-02: also reject composition when the parent is a target of an exact receipt debit or reversal even if no reconciliation has been declared; a missing read endpoint cannot be used to evade the boundary.
- B0-03: preserve valid non-financial header/detail creation and existing exact-workshop receipt flows. Both Spring and Nest must invoke the same shared contract validator before emitting an app.
- B0-04: quality suite must pass on the feature branch; run generated PostgreSQL/HTTP/Chromium dual-target finance regression if changes affect finance runtime. Do not call documentation-only or compiler-only tests end-to-end acceptance.
- B0-05: no merging S2b-0 under a claim that charge lines already work. No version tag or deployment.

## Phase S2b-1 — required implementation, NOT yet claimed

- S2B-01: opt-in reviewed semantic link from one exact-ledger parent creator to one typed child detail entity. The child's immutable money unit/line total uses a declared portable fixed-precision decimal with explicit precision/scale; require a stable child identity and a restrictive parent FK. Bound rows at creation to 1–20 and reject empty, missing, null, extra, negative, overflow, duplicate identity and any parent-reference injection **before all writes**.
- S2B-02: derive openingBalance and available **on the server** from the **same** accepted charge lines, without binary float, second stored source-of-truth, or client-persisted total. For one row 0.10 and another 0.20, persisted and reconciled total is exactly 0.30. Sum, parent INSERT, detail INSERTs and audit must share one PostgreSQL transaction and roll back together.
- S2B-03: forbid standalone child POST, child PATCH/DELETE/reparent, generic parent amount mutation, and any replacement/append that would bypass authoritative line totals. Existing public read capabilities remain explicit. A route exists only if its behavior is demonstrably safe; no 501 stub.
- S2B-04: retain previous exact journal invariants: POST receipt and reverse first lock parent and freshly reconcile; any drift rejects with 409 and zero new receipt/audit, even during concurrent requests. Charge lines must stay unchanged when receipts are posted or reversed.
- S2B-05: enforce an explicit audited model for business-approved repricing in **a later milestone**, not a generic amount PATCH; no charge mutation/repricing in S2b-1. Source adjustment must eventually reconcile posted amounts and lock ordering in a separately frozen S2c spec.
- S2B-06: generated NestJS **and** modular Spring on isolated, real PostgreSQL and HTTP; assert rollback on malformed/duplicate rows and unexpected input, same IR and exact output, authorized/unauthorized reader/writer, legacy nonfinancial details, previous PG 11/11 and 10-way 3/7 financial concurrency.
- S2B-07: exercise generated React at mobile 390×844: add/remove charge rows before creation, no exposed opening/available in POST, no post-create charge-edit shortcut and zero JS errors.
- S2B-08: tests must verify both identity and money paths, including zero-charge policy, row precision, maximum boundary, overflow, mutation bypass attempts, stale-ledger rejection, and transactional audit. Record real run URLs, SHAs and explicit PASS/FAIL for each. Do not backfill claims from design.

## Explicit exclusions

No tax/discount policy, variable pricing, inventory stock-out, exchange rates, externally settled cards/banks, refunds, legal invoices, approved repricing, production tenant IAM, cloud backups, or actual customer signoff. `coverageState=covered` denotes **internal recorded receipts only**. Do **not** close TL-14 / issue #57, create a stable finance tag, or deploy production based on these phases.
