# Taller Ledger — real-world automotive workshop acceptance brief (v1.2c)

**Frozen before code:** 2026-10-30. This brief models workshop needs previously raised by the project owner (clients, cars, performed jobs, payment methods, financial reporting, documents and backups); it is **not** formal signoff from a workshop customer. It must not be redefined merely to make a generated app pass. All test data are synthetic.

## Business scenario

A single workshop registers customers, vehicles, service jobs and receipts of payments. A vehicle belongs to a customer; a work order to a vehicle; a payment to an order. The shop needs stable identities and accurate amounts, while a read-only employee cannot modify data.

## Acceptance claims / scoring

**Executable supported slice**, checked with fresh TypeSpec-only generation (zero handwritten generated backend/React/SQL), both Spring and NestJS, real disposable PostgreSQL:
- **TL-01** Customer `C-001` can be registered, retrieved and duplicates return 409 without overwriting.
- **TL-02** Vehicle `AA123BB` can be linked to that customer; nonexisting customer FK is rejected, and customer cannot be deleted with a vehicle attached.
- **TL-03** Order `OT-001` can be linked to the vehicle, with exact `laborCharge = "14990.25"`; invalid vehicle FK is rejected.
- **TL-04** Order state starts `opened`, only `opened → underway → finished` is valid; forbidden out-of-order transition 409 and final persistence.
- **TL-05** Order state transitions are recorded with actor, before and after in server audit data; users without audit capability cannot read audit feed.
- **TL-06** Authorized payment `PAY-001` for `OT-001` records exact JSON-string money `"1000.10"` and a constrained method; invalid decimal, invalid method and missing order FK are rejected without persisting.
- **TL-07** Repeated payment identity returns 409; valid payment survives order navigation and refresh.
- **TL-08** Work-order list can be filtered by status with typed, server-side query; unsupported fields do not silently become unrestricted SQL filtering.
- **TL-09** Delete work order is rejected while a payment references it; delete vehicle is rejected while orders reference it.
- **TL-10** Reader can read but cannot create, transition or take write actions; HTTP bypass yields 403.
- **TL-11** Generated mobile UI at 390×844 permits login, create customer, create vehicle selecting that customer, inspect persisted data, and discover navigation for all four resources.
- **TL-12** Both targets compile from byte-identical canonical TypeSpec/IR, start against real PostgreSQL, pass generic multi-entity conformance and close isolated test containers.

**Required business capabilities but explicitly NOT yet claimed**:
- **TL-13** Real quote/remito PDFs and Excel import/export with compatible field mapping; not replaced with a plain HTML view.
- **TL-14** Exact order balance `labor + parts − valid receipts`, no overpayments, refunds or double settlement under concurrency.
- **TL-15** Per-workshop user isolation with fine-grained financial roles, production authentication and durable backups/recovery.
- **TL-16** Automatic customer-visible receipts and synchronized backups to user-owned Google Drive.

A system that passes TL-01...TL-12 is **a real functional bounded skeleton**, **not** a financially complete workshop system. The unsupported TL-13...TL-16 must be classified UNSUPPORTED, not PASS or silently implemented by custom per-entity code. See normative [product requirements](../00_PRODUCT_REQUIREMENTS.md).

## Integrity rules

- Money must use PostgreSQL exact decimal, TypeSpec `decimal` plus `@encode(string)`, and JSON string, not JavaScript floating-point arithmetic for financial settlement.
- Strict referential integrity; failed writes do not create orphans.
- No live data, customer PII, cloud infrastructure changes or paid services used in CI.
- Real logs per target: preserve exact commit SHA, Actions URL, PASS/FAIL/NOT RUN by test ID, observed SQL/HTTP/browser outcomes.
- The initial oracle is project-authored from a realistic brief. External customer scoring remains open.

**Planned contract:** `examples/vnext/workshop-ledger/contracts/main.tsp`.
**Planned runner:** `.github/workflows/v12-workshop-ledger-acceptance.yml`, separate matrix to avoid increasing runtime/cost of the already-proven CommunityArchive suite.
