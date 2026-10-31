# S2c-1b3 — atomic reviewed-ledger compare-and-swap

Date: 2026-10-31 (UTC). Functional SHA: `cd014403ccf9c5a6443e707546cb86f32a622b52`.
Scope: generated itemized workshop example, synthetic identities/money, disposable PostgreSQL and mobile Chromium. TL-14 issue #57 remains open.

## Risk and precise contract

S2c-1b2 already re-read a source-backed reconciliation during mobile *review*, and the signed adjustment PostgreSQL function already enforced financial integrity under a parent row lock. But another authorized user could post/reverse a receipt or append a signed correction between the browser review and the user's final confirmation. The old function would accept a still-valid delta despite the displayed after-total becoming stale. That is a consent/snapshot TOCTOU gap, not necessarily an overpayment.

S2c-1b3 adds **five nonauthoritative, required, exact reviewed expectations** to the TypeSpec adjustment request: `expectedOpening`, `expectedAvailable`, `expectedPostingCount`, `expectedReversedTotal`, `expectedAdjustmentCount`. The journal-backed reconciliation now projects `adjustmentCount`. Compiler and OpenAPI preflight reject missing or malformed contract shapes. Generated Nest and Spring validate exact wire strings and bounded counts; they do not trust these values as the source of money.

After locking the parent row, the generated PostgreSQL function re-reads the *whole* reconciliation in a fresh READ COMMITTED statement and compares all five expectations before any journal, charge or audit mutation. A stale expectation returns **HTTP 409**. Posting count and immutable journal count are monotonic under this contract; reversed total is nondecreasing, so a +0.10/-0.10 correction or a posted/reversed receipt cannot silently return to an old approval merely because opening/available returned to their old amounts (ABA).

The mobile 390×844 two-stage composer sends the exact values from its verified review. Any rejected/unknown POST outcome blocks replay, exposes an explicit reconciliation refresh, requires a new review, and preserves the same adjustment ID across that refresh. The backend remains authoritative. No automatic replay.

## Executed independent evidence

- [S2c/S2b generated PostgreSQL/HTTP/Chromium CI #41175082482](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41175082482) — **SUCCESS, NestJS + modular Spring**. Both logs contain `PROTOCOLIA_S2C1B3_MOBILE_CAS_PASS`, `PROTOCOLIA_S2C1B3_CAS_PASS`, prior `PROTOCOLIA_S2C1B2_MOBILE_ADJUST_PASS`, and `PROTOCOLIA_S2C1B1_ADJUST_ALL_PASS`. Browser deliberately approved +0.02, another authorized session committed +0.01, stale browser POST got 409, no stale journal row appeared; fresh manual review + preserved ID succeeded with correct 1.08 final amount. No browser page errors.
- Same run: ten concurrent -1.00 adjustments against a 3.00 order **with one shared approved snapshot** gave exactly **one 201, nine 409** (new stricter consent rule). A compensating +0.10/-0.10 sequence returned to the old monetary balance but stale approval was 409 with no extra journal/audit rows. Posted/reversed receipt returned to original available but old approval was 409, again without extra journal/audit.
- [Previous receipt/reversal drift-safe real CI #41175082363](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41175082363) — **SUCCESS, both targets**, including existing ten-way receipt oversubscription and source drift guards.
- [General quality CI #41175082481](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41175082481) — **SUCCESS, all five jobs**. [Push quality #41175078908](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41175078908) also passed.
- `tests/vnext/financial-itemized.test.mjs` adds compiler-negative cases for missing/optional expectations and floating-point reviewed balances, plus SQL CAS assertions. Both generated applications came from the same TypeSpec/IR, without handwritten generated application patches.

## Boundaries and remaining work

This is **optimistic concurrency for a human-reviewed internal signed correction**, not bank settlement, external provider idempotency, legal credit notes/refunds, tax compliance, multi-tenant production IAM, or financial certification. The reviewed counts/decimal DTOs have explicit finite bounds; unsupported extreme historical receipt totals fail closed rather than silently rounding. The browser's adjustment ID persists through its explicit refresh, not across every possible navigation/device failure. External payment provider identity, durable recovery, true refunds, tax and production isolation are still unproven. Keep #57 OPEN, no stable finance tag and no production deployment.
