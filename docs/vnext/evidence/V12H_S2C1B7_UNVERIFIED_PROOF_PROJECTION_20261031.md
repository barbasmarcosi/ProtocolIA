# S2c-1b7 — exact unverified external-proof projection: dual-engine evidence

Date: 2026-10-31 UTC. Functional SHA `1f1141a82729bc647b65282e4362511478dd901e`, base `864a10e8ddd7d53d5e8c0d10b3d187bf4e3be4a2`. [PR #74](https://github.com/barbasmarcosi/ProtocolIA/pull/74). Synthetic data only. TL-14/#57 remains OPEN.

## Real GitHub Actions (both independently generated applications)

- [S2b/S2c itemized exact PostgreSQL/HTTP/390px Chromium #41190836481](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41190836481): **SUCCESS NestJS and modular Spring**. Both job logs include `PROTOCOLIA_S2C1B7_UNVERIFIED_PROJECTION_PASS`, previous `PROTOCOLIA_S2C1B6_PROVIDER_PROOF_PASS`, `PROTOCOLIA_S2C1B5_MOBILE_LOST_RESPONSE_PASS`, and `PROTOCOLIA_S2B_ITEMIZED_ALL_PASS`. The frozen TypeSpec/SQL negative tests pass before independent app generation.
- [Legacy exact finance and drift-safe receipts #41190836483](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41190836483): **SUCCESS NestJS and modular Spring**. Both logs include `PROTOCOLIA_V12D_EXACT_PAYMENT_GUARD_PASS` with 11 cases, 3 accepted / 7 conflicts on ten concurrent 1.00 requests against 3.00, exact reversal and reconciliation.
- [General quality #41190836495](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41190836495): **SUCCESS 5/5 jobs** (unit Python 3.11 and 3.13, schema runtime, contract/schema, artifact conformance).

## Observed bounded claims

1. The optional TypeSpec `unverifiedProofField` must bind to a mandatory `@fixedInitial("unverified")` child field; missing, wrong or mutable bindings fail compilation. A tampered canonical IR fails the independent SQL planner. Legacy contracts without this opt-in remain valid.
2. A single PostgreSQL MVCC reconciliation query returns `unverifiedPostedTotal` and `unverifiedPostingCount` as JSON strings; no JavaScript floating-point arithmetic or additional money writes. With three synthetic 1.00 receipts (cash, bank transfer, card), the order is internally `covered` while the unverified total is exactly `3.00`, count `3`. Direct SQL corroborates the sum.
3. Internal reversal of the bank-transfer receipt moves the order to `partial` and the unverified projection to `2.00`, count `2`; `reversedTotal=1.00`. This is not a provider refund.
4. Generated mobile Chromium at 390×844 displayed the `2.00` and `2` proof boundary, including an explicit statement that internal coverage does not prove bank/card settlement or refund. Existing two-step corrections, stale CAS/ABA denial, lost-response lookup, immutable adjustment journal, and finance regressions passed on both adapters.

## Exclusions / next work

No independently authenticated payment-provider callback, signature validation, provider idempotency or replay protection, verified bank/card clearing, real refund, chargeback, legal credit note, tax, production IAM/tenancy or durable backup. The `unverified` field is a truthful *absence-of-proof* state, not external settlement certification. No production deployment or stable financial tag.
