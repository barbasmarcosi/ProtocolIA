# S2c-1b1 — authorized, exact signed adjustment POST: dual-engine acceptance evidence

Functional SHA: `7b0ac099b747e9818509860273c2f7cd42c20583`, tested 2026-10-31. Frozen scope: [S2c-1b1](../acceptance/V12H_S2C1B1_AUTHORIZED_SIGNED_ADJUSTMENTS_20261031.md). Disposable synthetic PostgreSQL/HTTP/Chromium; no production payment or user money operations.

## Actual completed CI

- [Generated NestJS and modular Spring exact itemization + signed HTTP adjustment #41165995776](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41165995776): **SUCCESS both**. Detailed job logs contain `PROTOCOLIA_S2C1B1_ADJUST_ALL_PASS nestjs` and `... modular-spring`.
- [Legacy exact finance S2a and mobile #41165995784](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41165995784): **SUCCESS both**; existing source drift-safe receipt, reversal, 10-way concurrency and browser UI retained.
- [General quality #41165995747](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41165995747): **SUCCESS all five jobs**. Also [push quality #41165992583](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41165992583) SUCCESS.

## Verified semantics

A typed TypeSpec `POST /api/work-orders/{number}/adjustments` is bound to `adjustExact` and separate `orders.adjust` capability. Body accepts only `{adjustmentId,delta,reason}` with 8–64-byte identity, string-encoded signed base-10 money (precision=14, scale=2) and 12–240-character reason; the authentication subject supplies the actor. Spring and NestJS use the same generated PostgreSQL function. It locks the parent, freshly reconciles immutable source lines + signed correction journal + posted receipt ledger, enforces count/limits and forbids decreasing available below zero. Exactly one transaction appends the immutable correction, updates chargeTotal/openingBalance/available and writes four audit entries.

Tests run against both independently generated applications:

- Actual +0.20 and -0.10 adjustments on an order with posted 1.00 receipt; exact resulting money and `coverageState=partial`.
- Audit actor came from verified session, exactly eight audit field rows for two adjustments; unchanged 2.00 and 1.00 original charge lines.
- Same adjustment ID replay: HTTP 409, unchanged money and no duplicate journal or audit.
- Negative input: numeric rather than string amount, three-decimal fraction, zero amount, invalid length, blank reason, client-forged actor, parent/order source and monetary fields, overflow, 404 missing parent.
- Reader lacking correction capability: HTTP 403.
- Full coverage: exactly reducing remaining available succeeds, another reduction receives 409; subsequent positive increase re-opens partial balance.
- Ten simultaneous -1.00 corrections against 3.00 available: **3 × 201 and 7 × 409**, no negative money. Five simultaneous retries of the same adjustment ID: **1 × 201 and 4 × 409** with exactly one journal entry.
- Post-write reconciliation is consistent, and privileged direct UPDATE of original signed journal data remains denied by PostgreSQL trigger.
- Prior 390×844 Chromium detail and preview checks, source-drift, original receipt concurrency, reversal and multi-charge legacy financial regression remained green.

## Boundaries not validated or implemented

The correction API does **not** create legal credit notes, execute refunds, alter externally captured bank/card settlements, calculate taxes/discount policy, provide payer consent or add a customer-facing correction editor. The React money preview remains read-only. A duplicate ID is intentionally rejected (409) rather than silently returning the first result. Production tenant IAM, privileged DB role hardening, backups, ledger tamper-evidence and independent financial audit remain open. It is a **reviewed internal exact adjustment**, not a production billing certification or provider-level settlement. Do not close TL-14 / issue #57, stable-tag finance or deploy production.
