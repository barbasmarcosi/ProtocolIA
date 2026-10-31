# v1.2c — Taller Ledger workshop business-acceptance evidence

**Date:** 2026-10-30 UTC. **Source:** [frozen requirements and explicit gaps](../acceptance/WORKSHOP_LEDGER_BUSINESS_BRIEF.md), committed **before** the TypeSpec contract and executable tests. These are project-owner-inspired scenarios, not signed acceptance by an independent workshop customer.

**Functional SHA:** [`f9bec77e3`](https://github.com/barbasmarcosi/ProtocolIA/commit/f9bec77e3ec3e9964b79f5690d4288b512646a8d). **CI:** [two-target real PostgreSQL/Chromium workflow #41084878066](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41084878066) — **SUCCESS both**. Quality workflows [#41084878216](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41084878216) and [#41084888681](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41084888681) — **SUCCESS**.

## What was built without per-entity handwritten application code

`examples/vnext/workshop-ledger/contracts/main.tsp` contains four entities: Customer, Vehicle, WorkOrder and Payment. They have three restrict foreign keys, 16 CRUD operations, a typed filtered work-order page, two state transitions, an audit feed and health. Payments and labor charges use `@encode(string)` and exact decimals, with a payment-method enum. The complete Nest and Spring implementations, PostgreSQL schema, HTTP and generated React are emitted by the existing pipeline, not hand-edited.

**Identical contract SHA-256:** `6595cb3eada3b7081975147cbc01caa5415cb85bb7cca02c7365f4dbc6a7a9e2`; **identical IR SHA-256:** `0c9a0cf5e3fff2f1bcdbea50fc54ff4a24bfe9949a7fd456817c497014bc7549` across both adapters.

## Actual observations on disposable isolated databases

| Frozen case | Modular Spring + PostgreSQL/Chromium | NestJS + PostgreSQL/Chromium |
|---|---|---|
| TL-01 customer creation, unique identifier | PASS | PASS |
| TL-02 mobile vehicle-parent selector, FK and restrict delete | PASS | PASS |
| TL-03 work order with exact `"14990.25"` labor charge | PASS | PASS |
| TL-04 guarded `opened → underway → finished` | PASS | PASS |
| TL-05 server audit status history and denied reader audit access | PASS | PASS |
| TL-06 exact `"1000.10"` payment, valid methods; invalid decimal, method, FK fail | PASS | PASS |
| TL-07 duplicate receipt 409, UI list and reload persistence | PASS | PASS |
| TL-08 contract-filtered status query | PASS | PASS |
| TL-09 payment and order restrict parent deletes | PASS | PASS |
| TL-10 reader HTTP + UI denied writes | PASS | PASS |
| TL-11 real 390×844 Chromium customer/vehicle workflow, 0 JS errors | PASS | PASS |
| TL-12 identical TypeSpec/IR, clean generated app + generic DB conformance | PASS | PASS |
| **Total supported scoped business cases** | **12/12 PASS** | **12/12 PASS** |

Both job logs emit 12 distinct `PROTOCOLIA_V12_WORKSHOP_CASE_PASS TL-nn` markers, plus an extra `TL-07-REFRESH` marker, and final `PROTOCOLIA_V12_WORKSHOP_BLACKBOX_PASS` with `finalStatus="finished"`, `paymentAmount="1000.10"`, `browserErrors=0`, all three FK flags true. Generic `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS` precedes the independently written workshop-specific runner.

The tests used synthetic identifiers and random, isolated Docker Compose project and PostgreSQL volumes, generated demo credentials, no external service and no retained customer data. The browser runner cleans up its database in `finally`. No changes to `main`, published builds, shared databases or production.

## Debugging history, not concealed

- Initial matrix [#41083828235](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41083828235) generated both applications successfully but found a **test-fixture generator defect**: generic `conformance.mjs` used arbitrary text for required enum `Payment.method`, correctly rejected by both generated backends with `400 invalid_choice`. Corrected generic fixture to use a value from canonical `field.choices`, without weakening the domain.
- The next matrix [#41084330068](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41084330068) reached the browser. The UI correctly used a human-readable accessibility label `Cliente sintético` for a customer reference; the oracle incorrectly searched for the aria-hidden identifier `C-001`. Corrected test selection to use the accessible label and then assert `data-selected-key="C-001"` rather than changing the UI.
- Final #41084878066 passed in both engines, confirming neither correction weakened the business assertions.

## Explicitly unsupported / remaining

| Frozen business demand | Truthful status |
|---|---|
| TL-13 PDF quotes/receipts and Excel import/export compatibility | **UNSUPPORTED** in this generated workshop profile |
| TL-14 exact `labor + parts − receipts` balance, prevention of overpayments, refunds, double settlement | **UNSUPPORTED**; **recording** decimal payments is not financial reconciliation |
| TL-15 per-workshop isolation, production identity/security, durable backup/restore | **NOT VERIFIED** in this disposable demo-auth profile |
| TL-16 automated external delivery and user-owned Google Drive backup | **UNSUPPORTED** |

No application-level tenant isolation, real-money settlement guarantee, externally controlled acceptance, live deployment, accessibility audit or production recovery claim follows from the results. Missing requirements must not be inferred from CRUD-like primitives.

**Classification: four-resource TypeSpec → generated Spring/Nest PostgreSQL/React workflow, bounded TL-01...TL-12 PASS ×2; TL-13...TL-16 open/unsupported. PR #56 remains Draft, stacked on Draft PR #55, `main` and the v1.0.0 tag untouched.**
