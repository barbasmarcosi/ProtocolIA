# S2c-1c3b — signed sandbox HTTP receipt candidate, no settlement

Date: 2026-10-31. Base `main` `d1715f2cffa0b7f17df50dfffa3a7d1ffbcd0c32`. Issue #57 (TL-14) remains OPEN.

## Scope and authority

Both independently generated NestJS and Spring targets now accept an **opt-in, disabled-by-default, demo-only** `POST /api/_protocolia/provider/sandbox/receipt-candidate`. This is an authenticated **synthetic receipt candidate**, not a bank settlement webhook. It reuses the existing HMAC-SHA256 raw-byte verifier and server-pinned `sandbox_provider` identity. The trusted signing key comes only from server configuration. No client-provided provider name, actor, status, or settlement state is accepted.

After verifying the signature, the endpoint requires an exact ASCII canonical JSON body, in this fixed order and without extra keys, duplicate keys, whitespace or alternate encodings:

```json
{"version":"receipt-candidate.v1","receiptId":"PAY-HTTP-LINK","orderId":"OT-HTTP-LINK","amount":"1.25"}
```

Receipt and order IDs are restricted to 1–128 ASCII letters, digits, underscores and hyphens. Amount must be an exact, positive decimal **string** with two fractional digits, at most 12 integral digits and no leading zeros. Neither JavaScript binary floats nor a Java floating-point type participates in the write. Strict raw-body matching prevents ambiguous duplicate JSON keys or reserialization discrepancies; it intentionally narrows the accepted sandbox protocol.

The generated endpoint invokes `protocolia_record_provider_receipt_candidate`, which locks the existing receipt and atomically checks receipt identity, order, amount, `posted` status and `unverified` proof before linking an immutable provider envelope. The database key is `(trusted provider,event ID)`, independent of signing key ID. Response outcomes: 202 newly stored; 200 identical replay; 404 missing receipt; 409 mismatched, reversed, previously unbound or conflicting event; 400 malformed claim; 401 invalid/stale signature; 503 transient database retry. No provider settlement status, receipt balance, or audit record is changed by this operation.

## Executable acceptance

`scripts/vnext/probe-provider-http.mjs` now exercises both routes against independently generated applications and disposable PostgreSQL in the existing provider CI matrix. The signed candidate test asserts 10 parallel requests produce exactly **1 × 202 and 9 × 200**, verifies the persisted receipt/order/amount, then checks forged/mismatched/reversed/missing receipts, altered signature, expired timestamp, unknown schema version, numeric rather than string amount, duplicate keys, extra `settled` key, invalid decimal scale, zero amount, replay with changed claim and an already unbound digest-only event. Rejected claims must leave no candidate and no new envelope; source money and `provider_settlement_state='unverified'` remain unchanged. The old digest-only ingress and HMAC tests remain in the workflow.

**Evidence status: VERIFIED on functional SHA `ec817843ec50ffe84a338b04ae05e18d1385c51c` (2026-10-31).**

- [Signed provider HTTP, inbox, generated PostgreSQL and cross-language HMAC CI #41212128593](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41212128593): **SUCCESS** on independently generated NestJS and modular Spring. The actual HTTP probe asserts `PROTOCOLIA_S2C1C3B_SIGNED_RECEIPT_HTTP_PASS` for both; 10-way concurrent delivery, tamper/replay, malformed payload and no external settlement.
- [General quality #41212128558](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41212128558): **SUCCESS**.
- [Exact drift-safe receipts #41212128541](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41212128541): **SUCCESS**.
- [Immutable itemized finance #41212128561](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41212128561): **SUCCESS**, NestJS and modular Spring.

This is a **sandbox candidate proof only**, not production provider acceptance or a verified external settlement.

## Remaining blockers

A synthetic HMAC signer is not a real bank or card provider. Production ingress must be separately contracted with provider-specific identity and rotation, a durable provider settlement state machine, independently verified settlement authority, out-of-order handling, reversals/chargebacks/refunds, retention and privacy policy, production IAM and customer acceptance. Do not mark a receipt externally settled, close #57, publish a stable finance tag or deploy production on this milestone.
