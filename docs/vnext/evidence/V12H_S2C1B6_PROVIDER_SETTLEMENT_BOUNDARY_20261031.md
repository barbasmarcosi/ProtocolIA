# S2c-1b6 — fixed provider-settlement proof boundary, verified

Date: 2026-10-31 UTC. Functional SHA `d4c9ff14195377f3c300653969214863781963e0`, base `5508b8946fb7d149583fb5acbebcc441563dac98`, [PR #73](https://github.com/barbasmarcosi/ProtocolIA/pull/73). Synthetic data only. TL-14 / issue #57 remains OPEN.

## Verified real CI (both independently generated targets)

- [S2b/S2c immutable exact itemized + browser/PostgreSQL #41187326729](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41187326729): **SUCCESS in NestJS and modular Spring**. Both job logs explicitly include `PROTOCOLIA_S2C1B6_PROVIDER_PROOF_PASS`, `PROTOCOLIA_S2C1B5_MOBILE_LOST_RESPONSE_PASS`, `PROTOCOLIA_S2C1B4_GLOBAL_KEY_PASS`, `PROTOCOLIA_S2C1B3_CAS_PASS` and `PROTOCOLIA_S2B_ITEMIZED_ALL_PASS`.
- [Legacy exact payment guard #41187326747](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41187326747): **SUCCESS in NestJS and modular Spring**, with independent generated apps, PostgreSQL and Chromium.
- [General quality #41187326708](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41187326708): **SUCCESS 5/5 jobs** (unit Python 3.11/3.13, schema runtime, contract/schema, artifact conformance).

## New generic generator invariant

`@fixedInitial("unverified")` is a framework-neutral TypeSpec property decorator compiled into canonical IR `fixedInitial=true`, `initial="unverified"`. The compiler refuses missing or invalid constants, ordinary orphan `@initial`, and mutable transitions/patches/deletion over a fixed field. Both generators emit a PostgreSQL `CHECK (provider_settlement_state = 'unverified')`; their HTTP create adapters inject the fixed value **only on the server**, rejecting even a matching client-supplied value with HTTP 400. The generic conformance fixture omits server-only fields instead of weakening the API contract.

## Executed adversarial oracle

1. Created a synthetic 3.00 work order in isolated PostgreSQL. A client POST forging `providerSettlementState="settled"` returned 400, did not create a receipt and left available balance unchanged. A second POST supplying even `"unverified"` returned 400 with no row.
2. Three independent exact 1.00 receipt POSTs with methods `cash`, `bank_transfer`, `card` returned 201; each HTTP POST/GET and direct PostgreSQL row retained `providerSettlementState="unverified"`.
3. A direct PostgreSQL UPDATE attempting `provider_settlement_state='settled'` failed the generated CHECK constraint.
4. The work-order reconciliation reported `coverageState="covered"` with available `0.00`, **while all three receipts remained externally unverified**. Thus internal coverage does not imply bank/card settlement.
5. A bank-transfer receipt's internal `posted -> reversed` transition returned 200, with provider state still unverified; internal coverage moved to `partial`. This does **not** execute or prove a provider refund.
6. Prior signed adjustments, CAS/ABA, global adjustment ID uniqueness, lost-response outcome lookup, mobile 390×844, immutable charge lines, ten-way receipt oversubscription and legacy finance remained green on both targets.

## Remaining work and exclusions

The system still has **no trusted external provider settlement**, authenticated callback verification, provider-level idempotency, actual refund/chargeback, legal credit note, tax/VAT, production IAM/tenancy, durable recovery or independent financial certification. This milestone is a **negative attestation** and a safety boundary, not a verified external-payment integration. Do not close TL-14, deploy production, process real funds or publish a stable finance tag.
