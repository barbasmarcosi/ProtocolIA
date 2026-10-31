# S2c-1c4c — signed synthetic lifecycle HTTP, both generators

Date: 2026-10-31. Base `main`: `4826dcf9126264cfe81430ac6f3ec7373188fc36`. Issue [#57](https://github.com/barbasmarcosi/ProtocolIA/issues/57) stays **OPEN**.

## Functional increment

Both generated runtimes now expose `POST /api/_protocolia/provider/sandbox/lifecycle-observation` under the existing **demo-only, disabled-by-default** sandbox gate. Unlike the candidate ingress, this endpoint appends a *reported* lifecycle observation against a previously authenticated immutable receipt candidate; it does **not** create a new receipt association.

The request uses the existing raw-body HMAC-SHA256 envelope with server-pinned provider identity `sandbox_provider`. It requires exactly one of each signed header, a configured 32-byte sandbox key, a fresh timestamp, `application/json` and a bounded raw body. It is deliberately not an authenticated bank callback and cannot be enabled outside demo mode.

Signed body format (canonical, exact ASCII bytes and property order; no whitespace, duplicate keys, extra fields, JSON numbers or alternative serialization):

```json
{"version":"lifecycle-observation.v1","candidateEventId":"evt_http_link_12345678","receiptId":"PAY-HTTP-LINK","orderId":"OT-HTTP-LINK","amount":"1.25","sequence":"3","phase":"reported_success"}
```

`candidateEventId` references the immutable initial candidate for this receipt, not a second claim. The amount is an exact decimal **string** with two fractional digits in this bounded workshop fixture; the sequence is a positive integer **string**, with PostgreSQL enforcing 1..2147483647. Accepted phases are `reported_pending`, `reported_success`, `reported_failure`, `reported_reversal`. They are reports, **not verified settlement states**.

The canonical SQL function generated from TypeSpec/IR verifies the provider, candidate, receipt, order, amount, posted status and unique receipt sequence transactionally. A replay of an existing identical event returns HTTP 200, a new event returns 202, an unknown candidate returns 404, and contradictory or already-occupied identities return 409. Invalid canonical payloads return 400 and invalid HMAC/timestamps return 401. The journal is append-only, with composite foreign keys and immutable envelope digest; events may arrive 3→1→2 without applying any financial state transition.

## Reproducible verification

The existing [provider-envelope workflow](../../../.github/workflows/v12h-s2c1c0-provider-envelope.yml) runs for both `nestjs` and `modular-spring` on this change. It regenerates each target from `examples/vnext/workshop-itemized-guard` and runs the unchanged exact-finance and PostgreSQL acceptance plus:

```bash
node --test tests/vnext/provider-envelope-inbox.test.mjs
node scripts/vnext/probe-provider-inbox.mjs <generated-app>
node scripts/vnext/probe-provider-http.mjs <generated-app>
```

The HTTP probe exercises 10 concurrent deliveries of one lifecycle event (expect one 202, nine 200), out-of-order sequences 3→1→2, sequence collision, wrong provider/candidate linkage, receipt/order/amount mismatch, duplicate JSON keys, added `settled` claims, forged version, numeric/invalid/overflow sequences, tampering, stale signatures and idempotent replay after an internal receipt reversal. PostgreSQL assertions require exactly three observations, no rejected-event inbox fragments, unchanged exact order balances and `provider_settlement_state='unverified'`.

**Evidence status:** implementation and tests added; GitHub Actions outcome must be inspected independently before any merge. No external provider requests, real refunds, financial settlement, production deploy or stable financial tag.

## Remaining TL-14 gates

Provider-specific independently verified settlement authority and monotonic causality, durable recovery/reconciliation and provider-specific signing-key management; real refunds, reversals and chargebacks with exact ledger treatment; production tenant isolation/IAM, backup/recovery and independent business acceptance. A synthetic `reported_success` must **never** be interpreted as cleared funds.
