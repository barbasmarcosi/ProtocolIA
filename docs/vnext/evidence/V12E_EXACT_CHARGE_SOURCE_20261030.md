# v1.2e — Source-bound initial balances: witnessed evidence

**Date:** 2026-10-30 (UTC). **Context:** stacked [Draft PR #58](https://github.com/barbasmarcosi/ProtocolIA/pull/58), partial [issue #57](https://github.com/barbasmarcosi/ProtocolIA/issues/57). The additive [CS acceptance amendment](../acceptance/WORKSHOP_EXACT_CHARGE_SOURCE_20261030.md) was frozen before the final integration run. The earlier [v1.2d evidence](V12D_EXACT_WORKSHOP_PAYMENT_20261030.md) remains authoritative for its earlier commit.

**Verified functional commit:** `4ab4cd7f61cd43227f69371e9ec989e135446eed`.
- **Real dual-engine matrix:** [#41095976944](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41095976944) **SUCCESS** (NestJS + modular Spring Boot, generated fresh from the same source TypeSpec, disposable real PostgreSQL).
- **General quality:** [#41095976906](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41095976906) and [#41095986610](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41095986610) both **SUCCESS**.
- TypeSpec 1.17.0; both emitted the same compiled contract SHA-256 `464029bcce8bf8d75f8584abaeaa4a25810e965fde4d089ad0aaa60e586de26a`, canonical IR SHA-256 `ca47c806858213a52e81dca767d5b74087f455121f74d0b9da6de6e1047f238c`; exact-output OpenAPI SHA-256 `778e31d572b051fbbe46fb34ed7b0220b17f75512a0a581eddb5646b9c6124c8`.

## New general semantic guarantee

`@reconcileExact` now accepts an **optional, source-declared `chargeSource`**, validated at compile time and independently by the shared adapters. The source must be a required non-null nonnegative exact decimal of matching scale/compatible precision, not an identity, computed field, or mutable through another operation. In the workshop contract that source is `laborCharge`, but **nothing in generated Spring or Nest code refers to that business-specific field name**.

For contracts opting into this extra condition:
- The generated server validates `openingBalance = available = chargeSource` with exact base-10 decimal arithmetic during **CREATE**, prior to INSERT, and rejects contradictory client requests with 400.
- After successful validation it uses the source's exact string as both persisted balances, rather than treating other client-supplied duplicate strings as independently authoritative.
- The order DELETE route was removed from this financial-ledger contract, as allowing destructive removal of the payable parent could undermine immutable journal traceability. No domain-specific generator edits were made.
- `@debitExact`, `@reverseExact`, `@reconcileExact` and actual PostgreSQL transactions continue to provide bounded safety after opening.

## Observed cases

| Case | Requirement | NestJS | Spring Boot |
|---|---|---|---|
| CS-01 | CREATE with `laborCharge="10.00"` but `openingBalance=available="20.00"`: 400 and no row | PASS | PASS |
| CS-02 | CREATE with unequal opening/available balances: 400 and no row | PASS | PASS |
| CS-03 | Correct `"10.00"` charge, balances persisted equal and reconciliation balanced | PASS | PASS |
| CS-04 | All earlier 11 PG cases including 10-way concurrency, rollback, exact reversal | PASS | PASS |
| CS-05a | Compiler rejects source that does not exist | PASS | PASS |
| CS-05b | Compiler rejects source field of wrong type | PASS | PASS |
| CS-05c | Compiler rejects self-referential source | PASS | PASS |

The Nest job emitted `PROTOCOLIA_EXACT_SOURCE_COMPILE_REJECT_PASS missing/wrong-type/self-alias`, `PROTOCOLIA_CHARGE_SOURCE_PASS CS-01..CS-04` and `PROTOCOLIA_V12D_EXACT_PAYMENT_GUARD_PASS` with `passedCases=11`, `parallelCommitted=3`, `parallelConflicts=7`, `reversedExact=true`, `reconciled=true`. Spring's complete job and run succeeded under the same negative/positive assertions; the previous generic DB conformance step also succeeded.

Both apps continue to have zero business-specific Java/Nest/SQL code. All DBs are disposable with randomized credentials, no customer data.

## Limits, deliberately explicit

**This is SOURCE-BOUND validation, not yet fully derived UI/DTO.** The generated CREATE form and request **still require opening and available as separate submitted fields**. They cannot be forged to differ from `laborCharge`, but the user must still enter them, which is redundant and poor UX. The next step is a **server-managed initial balance sourced from charges**, omitted from user input and computed automatically. A single source `laborCharge` does **not** represent parts, tax, fees or discounts. Nor does this confirm externally signed customer acceptance, regulatory accounting, live production recovery, real provider webhook idempotency or cross-tenant authorization.

**Issue #57 remains OPEN.** Classification: **scoped source-bound exact balance and debit safety PASS ×2**, source-only initial derivation and multi-charge accounting **NOT IMPLEMENTED**.
