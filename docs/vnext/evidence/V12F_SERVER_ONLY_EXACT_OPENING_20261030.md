# v1.2f — Server-only, source-derived exact opening balances

**Date:** 2026-10-30 local / 2026-10-31 UTC. **Draft PR:** [#58](https://github.com/barbasmarcosi/ProtocolIA/pull/58). **Issue:** [#57](https://github.com/barbasmarcosi/ProtocolIA/issues/57), **still OPEN**. **Acceptance frozen first:** [WORKSHOP_SERVER_DERIVED_OPENING_20261030.md](../acceptance/WORKSHOP_SERVER_DERIVED_OPENING_20261030.md).

## Verified real dual-engine execution

Functional SHA **`5c15657d56f4694b581e3b720c9937581a4494e1`**. [GitHub Actions #41149861215](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41149861215) **SUCCESS**: both **NestJS and modular Spring Boot**. General quality [#41149861136](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41149861136) and [#41149866310](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41149866310) **SUCCESS**.

Both targets rebuilt the same independent workshop-payment contract; generic `npm run app:test` passed against disposable PostgreSQL, then a separate isolated Docker Compose/PG instance executed the independent finance and 390×844 mobile Chromium tests. No per-entity handwritten generated Java, NestJS, SQL or React was added.

## Portable contract semantics

Optional `@reconcileExact(..., chargeSource, true)` uses the new `serverOnly` flag. In this mode, the two **persistent, required** exact-decimal fields named by `openingField` and `availableField` are excluded from the TypeSpec CREATE DTO and from generated UI CREATE controls/payloads. The compiler refuses a CREATE DTO that includes either. Each generated runtime rejects any raw body carrying either field, even when the value equals the charge. It derives both from the explicitly declared required, immutable nonnegative exact-decimal `chargeSource`, and validates/writes the values with the ordinary exact-decimal field rules. It never computes money through JavaScript floating-point conversion.

The non-`serverOnly` default remains backward compatible with the already-proven v1.2e source-bound API. UI-only `serverDerived` metadata excludes the two controls and JSON payload keys, but leaves ledger values visible on persisted records. Generic conformance does not forge derived fields in fixtures. No generated runtime contains a literal business-name test for `WorkOrder` or `laborCharge`.

The source is currently the single immutable `laborCharge` field; no parts/tax totals are implied. The order DELETE operation is deliberately absent in the immutable journal profile.

## Observed frozen acceptance

| Gate | Observed outcome (both Spring and NestJS) |
| --- | --- |
| SO-01 valid order POST with only `laborCharge="10.00"` | **PASS** — persisted `openingBalance=available="10.00"`, reconciled |
| SO-02 inject both balances or only one, including correctly matching amount | **PASS** — 400, no row |
| SO-03 send numeric JSON instead of decimal wire string | **PASS** — 400, no row |
| SO-04 real 390×844 Chromium CREATE | **PASS** — no create-openingBalance/create-available controls; the POST excludes both keys, creates `OT-MOBILE` with `"8.25"` balances |
| SO-05 10 simultaneous distinct `"1.00"` payment requests against `"3.00"` | **PASS** — exactly 3 × 201 and 7 × 409; balance zero, no phantom rows |
| SO-06 all original 11 payment guards, reversal and generic HTTP/PG conformance | **PASS** |
| SO-07 unsafe TypeSpec bindings and request spoofing rejected before generation | **PASS** five executable variants: missing field, wrong type, self alias, nullable source, spoofed CREATE DTO |
| SO-08 framework-neutral behavior and same generated UI/browser result | **PASS** |

**Browser evidence (both jobs):** `PROTOCOLIA_SERVER_ONLY_MOBILE_PASS` with `viewport="390x844"`, `browserErrors=0`, actual POST `requestKeys=["laborCharge","number","status","symptom","vehiclePlate"]`. Both screenshots have SHA-256 **`9aaa08e013100ed1e903e04d89c302e4eca193c2a5ddcd6b2ab5fce4f11e1223`**. The image hash proves byte identity of these two observed captures only; it is not a visual accessibility certification.

**Financial evidence (both jobs):** `PROTOCOLIA_V12D_EXACT_PAYMENT_GUARD_PASS`: 11/11 prior PG scenarios pass with `parallelCommitted=3`, `parallelConflicts=7`, `reversedExact=true`, `reconciled=true`, `overspendDenied=true`. Canonical IR SHA-256 **`814d14bc7486b4ea72050ca2ded1a3a402b3dc6b3e1521489e6884a94d9859bc`** is identical between targets. The five TypeSpec negative test markers are identical, independent of backend.

## Diagnostic corrections, not hidden

- Early TypeScript CI compilation caught a strongly typed `unknown` field-name lookup in compiler validation. The DTO validator was amended to use explicit strings and to inspect the full TypeSpec operation list, **not** a partially collected IR whose order depends on declaration order.
- A negative probe using an empty TypeSpec decorator literal triggered an unrelated TypeSpec/Babel diagnostic rendering `RangeError: Invalid count value: -1` before the project could issue its own diagnostic. That syntactically abnormal negative fixture was replaced by a valid but insecure nullable charge field. No runtime guarantee was waived.
- The final CI with PostgreSQL and real Chromium passed in both engines. Earlier cancelled/failing CI runs are development history, not counted as acceptance.

## Remaining scope and reasons issue #57 stays OPEN

This only **derives balances from a single declared source field**. It does not calculate `laborCharge + parts + taxes - discounts`, support modifications to billed charges with locked receipts, guarantee provider/payment-network idempotency, implement real refunds or legal invoicing, validate multi-tenant isolation, prove production backup/restore or obtain independent customer sign-off. The next stage should specify a generic **bounded, typed, exact multi-charge source** and test its decimal arithmetic, upper bounds, transactional mutation and rollback in both backends, preserving all existing independent acceptance suites.

No merge, release, live deployment, tag rewrite, shared DB change or cleanup of divergent branches occurred. **PRs #55, #56 and #58 remain Draft; `main` remains frozen.**
