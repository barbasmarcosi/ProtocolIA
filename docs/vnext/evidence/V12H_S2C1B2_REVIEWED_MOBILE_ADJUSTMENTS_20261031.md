# S2c-1b2 — authorized mobile correction UX evidence

Date: 2026-10-31. Functional SHA `045fec89953d52db59d87be75e354d720d2c0ef6`.

## Real CI, both generated applications

- [Generated itemized finance, signed corrections, mobile PostgreSQL/HTTP/Chromium #41169552541](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41169552541) **SUCCESS NestJS + Spring**. Individual logs include `PROTOCOLIA_S2C1B2_MOBILE_ADJUST_PASS nestjs`, `... modular-spring`, `PROTOCOLIA_S2C1B1_ADJUST_ALL_PASS` for both targets, and `PROTOCOLIA_S2B_ITEMIZED_ALL_PASS` for both targets.
- [Previous exact receipt and reversal regression #41169552718](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41169552718) **SUCCESS NestJS + Spring**, including existing ten-way receipt concurrency.
- [General quality #41169552487](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41169552487) **SUCCESS all 5 jobs**. [Push quality #41169549065](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41169549065) also SUCCESS.

## Executed browser oracle, 390×844 Chromium

For each independently generated app, a signed-in manager opened the legitimate order detail and the contract-derived correction composer. The browser entered +0.05 and the required reason against a synthetic 1.00 line, then:

1. Confirmed **no immediate financial POST** was available before the review stage.
2. Clicked review, which re-read the source-backed reconciliation, showed exact 1.05 before/after impact, checked viewport containment, and proved the backend still held 1.00 (zero mutation on review).
3. Clicked the *second* explicit confirmation; intercepted the actual authenticated `POST /api/work-orders/OT-UI-ADJUST/adjustments` and confirmed **HTTP 201**.
4. Independently read PostgreSQL-backed HTTP state: exact `chargeTotal=1.05`, `available=1.05`, reconciliation `balanced=true`. The immutable charge source was not rewritten; no browser page exceptions.
5. Re-ran the source drift tests, signed POST capability and 409/idempotency/race tests, prior itemized fixtures and mobile checks in both targets.

The UI is permitted only if the user has independent `adjustExact` capability, reviewed opt-in and ledger-read permission. Amount parsing is BigInt fixed decimal, not floating point. Review is informational; the PostgreSQL procedure still rechecks the source under lock at write time. 400/401/403/409 errors are shown without automatic resubmission; the signed adjustment ID remains stable on unknown outcomes. The post-apply success notice now persists across reconciliation remount.

## Known limitations

The correction is **not** a statutory invoice/credit note, customer approval, refund settlement, tax/VAT calculation, external bank/card provider confirmation, production identity/role-hardening, backup/recovery or independently certified tamper-evident ledger. The correction preview is not a promise that the write will succeed. The PR adds a bounded UI for the already-reviewed S2c-1b1 operation, **not** an external finance product launch. Keep TL-14 issue #57 OPEN, do not stable-tag finance or deploy production.
