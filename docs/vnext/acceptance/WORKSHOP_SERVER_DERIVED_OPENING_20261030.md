# v1.2f — Immutable server-derived exact opening/available, no client balance DTO

2026-10-30. Additive acceptance freeze (v1.2e evidence is unchanged).

**New opt-in contract:** `@reconcileExact(..., chargeSource, true)`. The final boolean indicates **serverOnly** for the opening/available fields; it is valid only with a typed, nonnegative, immutable exact-decimal chargeSource. The TypeSpec HTTP CREATE request must **omit both** derived fields; the compiler must reject a request that includes either. Server creates both with the exact source string, before transaction insert and without JS floating point. Existing `@reconcileExact` without the flag remains backward compatible.

## Acceptance cases

- **SO-01:** Construct customer + vehicle + order with only laborCharge (e.g. `"10.00"`); API 201, GET reports `openingBalance=available="10.00"`, reconciliation balanced.
- **SO-02:** A malicious client adds either or both balances to the POST body (even if equal to source): 400 and no row; cannot assign independently.
- **SO-03:** A request with invalid/missing chargeSource or a JSON number rather than decimal string: 400, zero persistence.
- **SO-04:** generated mobile UI hides both balances from the create form and does not submit them; user enters only source charge.
- **SO-05:** ten competing `"1.00"` posts against `"3.00"` yield three commits, seven 409 conflicts, no overpay or lost update. Reversal is one-time and exact.
- **SO-06:** all previous core 11 payment cases, generic DB conformance and contract/IR fingerprint parity remain passing on NestJS + modular Spring.
- **SO-07:** fail-closed negative TypeSpec: opt-in `serverOnly` without chargeSource, DTO including a balance, mismatched/invalid source should all be rejected at compilation.
- **SO-08:** source rules are framework-neutral, no literal workshop-specific Java/Nest logic or generated entity files.

The client-facing request must never accept or require derived balances. They remain DB-required, and the source is immutable after creation. Initial source is **only laborCharge**. A combined labor+parts/tax balance, negative line adjustments, real-world payment settlement, external customer signoff and production authorization/backups remain explicitly outside this deliverable; **issue #57 stays open**. All tests are synthetic, disposable and reproducible.
