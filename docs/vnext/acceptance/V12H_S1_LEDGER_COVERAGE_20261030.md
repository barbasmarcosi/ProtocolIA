# v1.2h-S1 — Snapshot-derived exact ledger coverage

**Frozen before implementation** (2026-10-30 local). Stacked from Draft PR #59; no main/PR #55–#59 edits or merge. This is a **narrow, honest financial-lifecycle projection**, not settlement or refund accounting.

## Contract opt-in

Optional final `lifecycle?: valueof boolean` flag on `@reconcileExact(..., chargeSource?, serverOnly?, lifecycle?)`, default absent/false = legacy eight-field reconciliation response. When true, the response must include a **ninth required string field `coverageState`**, and the contract must declare `serverOnly=true` and an exact source vector. Invalid opt-ins, partial DTOs, wrong response shape or unsupported status must fail at **TypeSpec compilation**. Canonical IR includes `lifecycle:true`, and both adapters derive the same result entirely in the **existing single PostgreSQL reconciliation SELECT** (one MVCC statement).

## State semantics

Only registered, posted internal receipts count. This is **not** proof of payment settlement, bank credit, legal invoice status or bank refund.
- `inconsistent`: persisted available is not exactly opening less currently posted receipts (takes precedence; never claim healthy coverage when books disagree)
- `no_charge`: opening is zero and ledger balances
- `unpaid`: positive opening, posted receipts total zero, and ledger balances
- `partial`: some, but not all, positive opening covered by currently posted receipts, and ledger balances
- `covered`: positive opening, currently posted receipts equal opening, available exactly zero and ledger balances

A reversed receipt exits the posted set. Thus a covered order automatically returns to partial or unpaid without mutating a second status column. No ambiguous `paid`/`settled` wording.

## Required independent acceptance

- LC-01 create order with positive labor+parts, initial `unpaid`, exact zero posted
- LC-02 pay a strict partial amount → `partial`, correct remaining
- LC-03 pay remainder → `covered`, available zero; overspend rejected; concurrent 10-way 3×201/7×409 → `covered`
- LC-04 reverse posted partial after full coverage → `partial`; reverse the last posted receipt → `unpaid`. Repeat reversal returns 409, state unchanged
- LC-05 zero-charge order → `no_charge`, no spurious `covered`
- LC-06 cross-target canonical IR, OpenAPI, actual HTTP/PostgreSQL, 390×844 Chromium, previous MS-01..05 + 11 PG tests
- LC-07 default opt-out legacy eight-field snapshots preserved in independent contracts
- LC-08 compile-invalid: ninth field without opt-in, opt-in without ninth field, opt-in without serverOnly or charge source, wrongly typed coverageState
- LC-09 mismatched state detection from intentionally corrupted **disposable** PostgreSQL fixture, if fixture-level direct SQL is safely accessible; otherwise mark BLOCKED rather than invent proof

No new stored state, new payment processor, variable-length parts, tax policy, fee, discount, billing edit, refunds, credit notes, external transfers, production identity/backup/tenancy or legal finance certification. Issue #57 remains OPEN; v1.2h-S2+ may address *approved* financial writes after separate acceptance freeze.
