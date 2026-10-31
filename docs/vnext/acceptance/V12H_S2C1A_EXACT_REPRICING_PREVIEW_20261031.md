# v1.2h-S2c-1a — exact repricing preview / safe headroom (read-only)

Frozen 2026-10-31 local. Base: S2c-0 on main (`4ab322f2`); related TL-14 issue #57 stays OPEN.

## Policy

An item's original money rows must remain immutable. Actual repricing is a **separate future authorized append-only adjustment** with immutable actor/reason/amount/idempotency, lock order, audit and external settlement checks, never a generic PATCH to the parent totals, never replacement of original lines. This preview does not implement repricing.

A bounded read-only source-backed `@reconcileExact` can opt in to `adjustmentPreview` only for a single immutable exact line-source contract. A **single PostgreSQL statement** computes exact fixed-precision headroom in the current snapshot:

- `maxSafeDecrease`: current `available` (already excludes posted receipts) when both source and receipt journal are balanced, otherwise `0.00`. It is only an arithmetic ceiling; no refund or credit is authorized by the preview.
- `maxSafeIncrease`: declared maximal `chargeTotal` minus currently stored `chargeTotal` when balanced; otherwise `0.00`. A new operation must additionally check the 20-row limit, identity uniqueness, authorized reason, duplicate request, source integrity, transaction/locks and posted journal.
- `adjustmentPreviewEligible`: true only if source/journal reconcile and fewer than 20 charges are persisted. The computed headroom should also be zero when the row-count limit is exhausted. The preview cannot bypass the immutable 1–20 row bound.
- A zero-charge line is allowed at creation, but this preview cannot imply zero-value correction changes.
- The sums and headroom MUST use PostgreSQL `NUMERIC`, not JavaScript `Number`; the preview is **never authority to write** because it may go stale between reads/writes.
- Invalid opt-in without itemized source, missing declared max, or unreviewed metadata must fail closed in TypeSpec and in both generators. Non-opt-in scalar or generic ledger responses are unchanged.
- Validate against independently generated NestJS and Spring with disposable PostgreSQL: unpaid, partial, covered, zero-charge, 20-row exhausted, out-of-band source drift and restoration; returned exact values and Boolean behavior identical; no new financial mutations. Retain old finance, generic bounded details, Chromium 390×844 and general CI.

## Later S2c-1b (NOT in this milestone)

User-approved (business-defined) adjustment policy, append-only signed-money rows, status/rationale and immutable audit trail, exact idempotency and concurrency, discount/tax calculation, reversal/credit note semantics after posted receipts, responsible actor authorization and generated UI confirmation. Do not invent policy for already-settled cards/banks. No stable financial tag, production rollout or closing issue #57.
