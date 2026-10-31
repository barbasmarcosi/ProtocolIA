# ProtocolIA v1.2g — bounded exact multi-charge ledger acceptance

**Date:** 2026-10-30 local / 2026-10-31 UTC. **Draft PR:** [#59](https://github.com/barbasmarcosi/ProtocolIA/pull/59), based on Draft [#58](https://github.com/barbasmarcosi/ProtocolIA/pull/58). No merge, tag, live production or shared DB changes. [Frozen acceptance](../acceptance/V12G_EXACT_MULTICHARGE_20261030.md) preceded functional implementation. [Issue #57](https://github.com/barbasmarcosi/ProtocolIA/issues/57) remains **OPEN**.

## Real observed evidence

**Final functional SHA:** `6897702e24f31c8bb9f7e2965c5722592d29b4ba`

- [Actions v1.2g matrix #41152843250](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41152843250): **SUCCESS ×2**, actual generated NestJS and modular Spring Boot, separate Docker Compose PostgreSQL, real HTTP, 390×844 Chromium, independent generic conformance.
- Earlier functional run [#41152568462](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41152568462) was also **SUCCESS ×2**; the final run covers an additional code guard and compiler-negative regression.
- Both jobs reported exactly the same TypeSpec contract hash `9bdd0846123a3a77910b1c8a5649c1a425a7e61e5d342ce58e7955c4ab46b0d2`, canonical IR hash `ed1525f4ca129501312ea599de385a185d6f8d7351d938a995ebae14e005f992` and OpenAPI hash `ac67d221b17dea6826ee1a2b1be69c5fd5817bcccea9e4d335b1f9eea26a54b0`.

## Implemented platform contract

This milestone extends the **existing** `@reconcileExact` optional `chargeSource` to accept **one exact field** (legacy mode) or a bounded comma-separated vector of **two to four distinct exact fields**. Example: `@reconcileExact("openingBalance","available","Payment","orderNumber","amount","status","posted","reversed","laborCharge,partsCharge",true)`.

Compiler produces canonical `chargeSources:["laborCharge","partsCharge"]` for a multi-source rule and preserves the historical `chargeSource` singleton for existing contracts. Both adapters compile a shared immutable validated source plan. The client does not create or modify `openingBalance` or `available`; the target servers compute their sum from validated immutable source fields, then revalidate aggregate precision, scale and range **before PostgreSQL INSERT**. Any spoofed opening/available body fields are HTTP 400.

- NestJS uses exact BigInt decimal minor units and deterministic decimal string emission. No floating-point sum.
- Spring Boot uses Java BigDecimal exact addition and validates the result before insertion.
- All sources must be required, non-null, nonnegative, exact decimal, with compatible scale/precision; computed/derived fields and mutable fields cannot masquerade as independent authoritative charges.
- No `WorkOrder`, `partsCharge`, `laborCharge` or application-specific logic was hard-coded in the generated runtime templates.

## Actual accepted cases on *both* engines

| Case | Tested operation | NestJS | Spring |
|---|---|---|---|
| MS-01 | `10.00 + 5.00 = 15.00`, GET and reconciliation | PASS | PASS |
| MS-02 | `0.10 + 0.20 = 0.30` exactly | PASS | PASS |
| MS-03 | `999999999999.99 + 0.01` overflow returns 400/no row; exact `999999999999.98 + 0.01` upper boundary persists | PASS | PASS |
| MS-04 | Negative, JSON numeric, missing and null parts charge return 400, no inserted record | PASS | PASS |
| MS-05 | Any client-supplied opening/available, including a matching value, rejected with 400 and no row | PASS | PASS |
| MS-06 | 11/11 previous financial tests including 10-way oversubscription (3×201 / 7×409), duplicate receipts, reversal and exact reconciliation | PASS | PASS |
| MS-07 | Ten invalid contract cases denied by compiler: unknown, wrong-type, self-alias, nullable, wrong-scale, negative-allowing, computed-source, duplicated, oversized list, spoofed CREATE DTO | PASS | PASS |
| MS-08 | Clean generated application, independent real PG conformance, mobile Chromium 390×844 with `laborCharge` and `partsCharge` inputs, no opening/available controls, observed POST excludes balances, zero browser errors | PASS | PASS |

**Actual browser request keys** in both job logs:
`["laborCharge","number","partsCharge","status","symptom","vehiclePlate"]`.
Screenshot SHA-256 for both browsers was `9aaa08e013100ed1e903e04d89c302e4eca193c2a5ddcd6b2ab5fce4f11e1223`. This screenshot is captured after creation and proves identical observed *post-create* browser output; the missing form controls and POST body were independently asserted in the browser test.

## Development failures and repair history

The initial dual-target CI at [#41152511847](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41152511847) failed at TypeScript compile because the per-operation validated `chargeNames` variable was not in scope during canonical IR serialization; fixed by reconstructing the normalized list from validated reconciliation metadata in emission. The first green run #41152568462 confirmed end-to-end interoperability. A final fail-closed rule then excluded calculated fields from the source vector at both compiler and adapter-plan stages; an explicit `computed-source` TypeSpec negative case was added and verified in final dual-target #41152843250. Earlier intermediate runs cancelled by Actions concurrency are **not** treated as PASS.

## Explicit non-goals / actual remaining product work

- **Only two-source monetary addition has been exercised as live HTTP/PG/browser business behavior**, although the compiler/adapter permits 2–4 sources. Do not claim 3/4-source runtime parity without specific tests.
- These are **fixed immutable scalar charges**. No dynamic part line items, price × quantity, taxes, discounts, inventory linkage or post-payment repricing are implemented by this milestone.
- Client-entered charges themselves are not externally attested; a caller may still submit a price without authorized invoice approval. The guarantee is that the opening balance is **exactly derived from submitted, validated declared charges**, not that those charges are commercially correct.
- No production payment gateway, webhook idempotency/settlement, true refunds, legal invoicing, multi-tenant production IAM, external backups, RPO/RTO recovery or independent workshop acceptance has been proven.
- Next technical focus: define bounded source-of-truth charge line items and the financial state machine (invoices/receipts/reversals/refunds) with transactional mutation, typed fee/tax and negative/compensation tests **before** expanding the supported domain.

**Conclusion:** exact bounded two-source initial money and existing debit/reversal/reconciliation **PASS ×2** in test; **TL-14 remains PARTIAL**. Do not merge or advertise full financial completion.
