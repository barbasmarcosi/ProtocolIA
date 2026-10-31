# S2c-1b5 — committed internal adjustment outcome recovery

Date: 2026-10-31. Parent: S2c-1b4 on `main` `f8ec1e301e88b018f0abb3f96cd13df9019423b8`. TL-14 / issue #57 stays **OPEN**.

## Failure model and guarantee

A server may commit an authorized adjustment, then the HTTP 201 response can be lost. The mobile client cannot safely infer that a failed network request means no financial write occurred. It MUST NOT blindly replay the request with a new ID. A repeated POST with the same journal-wide unique ID continues to return 409; it is **not** an external payment-provider idempotency key.

A new explicit, contract-declared, read-only operation `lookupExactAdjustment` at `GET /api/work-orders/{number}/adjustments/{adjustmentId}` looks up an already-committed immutable journal row. It returns `{adjustmentId,delta,reason,status:"committed"}` with the exact PostgreSQL NUMERIC amount as a JSON string. There is no side effect. HTTP 404 means **no committed matching row was observed at that instant**, not proof that a delayed transaction cannot subsequently commit. The client must never interpret 404 as authorization to retry automatically.

## Authorization, privacy, exactness

- Same independent nonpublic `orders.adjust` capability as the write; a read-only employee must receive HTTP 403. Authentication is enforced in both generated adapters, not only the UI.
- Lookup requires exact **parent identity, adjustment ID and authenticated writer actor**. A globally unique ID from another order or another actor is not exposed or claimed as this user's result.
- Unknown, malformed, mismatched or not-yet-committed records must not return a fabricated success. PostgreSQL uses bound parameters, no dynamic client SQL. Sensitive GET responses set `Cache-Control: no-store`.
- The generated React mobile composer preserves the original ID and submitted exact delta/reason on an uncertain outcome, offers a **separate explicit read-only check**, and compares all three values before announcing a matching committed correction. It does not silently retry a financial POST.
- A verified journal outcome is **only** a locally recorded internal correction. It is not an invoice, bank/card settlement, refund, tax credit, external PSP receipt or legal evidence of payment.

## Required acceptance

1. TypeSpec compiler and both generators fail closed on an unbound or unauthorized lookup. The stock JHipster adapter reports the behavior unsupported.
2. Independent NestJS and Spring apps generated from the same TypeSpec pass real PostgreSQL HTTP: committed exact decimal, missing ID, wrong parent, different actor, invalid ID, reader 403 and no additional audit/journal rows. Unique-key race winner is discoverable only under the winning parent.
3. Chromium at 390×844 executes a real adjustment POST, deliberately loses the HTTP response **after** server HTTP 201, then verifies the original committed row with an explicit GET and zero additional journal rows.
4. Existing S2b itemization, S2c signed adjustments, stale-snapshot CAS/ABA, global-key concurrency, payment/reversal concurrency and general quality remain green in both targets.
5. No merge without observed green CI; no production deployment, stable financial tag, live data or external financial operation.

## Known limits

The lookup is a point-in-time database read, not a guarantee about a concurrent uncommitted request; there is no external provider acknowledgment or true refund workflow. Cross-tenant IAM, customer-visible receipts, legal credit notes, payment-provider webhook signatures and production backup/recovery are still outside this increment.
