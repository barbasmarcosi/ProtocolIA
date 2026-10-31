# S2c-1b6 — explicit boundary between recorded receipts and external settlement

Frozen scope: 2026-10-31, base `5508b8946fb7d149583fb5acbebcc441563dac98`. TL-14 / issue #57 remains OPEN.

## Problem and supported claim

The exact internal workshop ledger records `Payment.status=posted` and computes `coverageState=covered` when its *recorded* receipts exhaust the order balance. Neither field demonstrates that a card processor, bank transfer or payment gateway actually settled funds. In particular, `reversePayment` is an **internal ledger reversal**, not a provider refund. A generated app must not silently present internal coverage as independently verified external settlement.

## Contractual increment

The workshop TypeSpec `Payment` entity declares a persisted, server-initialized `@fixedInitial("unverified") providerSettlementState`. The reusable decorator is compiled into a fixed-value PostgreSQL CHECK and a strict server-only CREATE field in both adapters. It is absent from `PaymentRequest`, has no declared transition, PATCH or delete lifecycle, and cannot be changed to `settled` via a generated HTTP operation. The value is intentionally unverified for **cash, bank_transfer and card**: the platform has no trusted provider attestation, and cash is not evidence of a remote provider settlement. This is an **explicit negative attestation**, not a bank/payment integration, provider webhook, or verified refund. It does not change internal ledger accounting or monetary authorization.

## Executable acceptance (independent NestJS and modular Spring)

1. Compile the TypeSpec and assert the canonical IR contains `fixedInitial=true` and no provider-settlement mutation operation. Negative contracts must reject ordinary orphan `@initial` and any transition over a fixed field.
2. Create a synthetic order in disposable PostgreSQL. Forging `providerSettlementState="settled"` **or even `"unverified"`** on receipt creation must return HTTP 400, persist no receipt and leave the order balance unchanged. Direct SQL UPDATE to `settled` must fail under the generated CHECK.
3. Record exact 1.00 internal receipts using cash, bank_transfer and card; each POST/GET and SQL row must report `providerSettlementState="unverified"`.
4. Confirm that `coverageState="covered"` can coexist with unverified provider state, proving the two concepts are **not interchangeable**.
5. Reverse the bank-transfer receipt: internal coverage becomes partial, provider state remains unverified, and no provider refund is asserted.
6. Re-run all previous S2b/S2c financial, CAS, adjustment recovery, immutable itemized and legacy exact receipt tests, and all quality jobs.

## Exclusions and next work

No external provider credentials, callbacks, verified settlement, idempotency at a PSP, reconciliation of provider batches, refund/chargeback, tax or legal invoice, production tenant isolation or recovery are claimed. A future independently authenticated provider adapter must establish authoritative settlement evidence, append-only transitions, provider idempotency, concurrency and signature replay safety; the current unverified state must not be treated as a settlement receipt. No production deployment, financial stable tag or real funds.
