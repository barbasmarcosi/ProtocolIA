# v1.2h-S2a — fail-closed exact receipt mutations on inconsistent ledgers

Frozen before functional modifications, 2026-10-30 local. Successor to Draft PR #60; no unsafe production mutations. **This does not add line items**: it closes a newly discovered integrity prerequisite.

## Threat and rule
`@reconcileExact` already reports `balanced=false` / `coverageState=inconsistent` for a payment ledger whose persisted available differs from opening minus its posted receipts. Previously, independently authorized `@debitExact` and `@reverseExact` might still mutate that inconsistent ledger. This is unacceptable for future charge-change functions.

Where an exact reconciliation plan exists for the debit parent, all `@debitExact` receipt creation and `@reverseExact` transitions MUST:
1. Begin the existing real PostgreSQL transaction and lock the parent balance row `FOR UPDATE` **before** reading the journal and before changing payment state or balance.
2. Query the *existing* generated reconciliation snapshot on that same transaction connection, in a **new READ COMMITTED statement after acquiring the lock**. Deny with HTTP **409** when not balanced. Deny missing referenced parent with the current public API semantics.
3. If balanced, proceed with pre-existing guarded atomic debit or once-only reversal, and commit state, balance, audit together. Any denial rolls back without partial receipt/state/audit. Reuse plan from validated canonical IR; no WorkOrder-specific runtime code or new trust-boundary bypass.
4. For two concurrent requests, parent lock must serialize mutation and the statement-after-lock reads must see the latest committed receipt journal. In particular preserve the previous exactly 3 committed / 7 conflicted race of 10×1.00 over 3.00.
5. For a reversing request, the check **must precede** the payment status flip, because after a flip the current balance legitimately lags the new posted total until credit. Do not infer the pre-transition state from mutable client input.
6. Both generated NestJS and modular Spring, independent PostgreSQL/HTTP/Chromium, same canonical IR. No user-supplied balance or access escalation.

## Executable acceptance
- DG-01: introduce a test-only privileged mismatch on a disposable database (`available` drops from 10.00 to 9.00, no receipts). Reconciliation `inconsistent`. A valid amount receipt must return 409; GET new receipt 404; no extra audit/ledger row, available 9.00.
- DG-02: with a posted 3.00 receipt, introduce mismatch on disposable PG. Valid reverse must return 409; receipt still posted, unchanged available and snapshot; after correction, reversal succeeds exactly once, reconciles to `unpaid`.
- DG-03: absent or unknown balance references retain 400/404 semantics (do not leak new 500).
- DG-04: 11 previous payment/overpay/concurrency/reversal cases (including 10 competing POST, exactly 3 successes) remain passing, plus MS-01..MS-05 and LC-01..LC-09 and all compiler negatives, in both backends.
- DG-05: existing standalone valid `@debitExact` / `@reverseExact` consumers without `@reconcileExact` remain unaffected, not globally blocked.
- DG-06: real PostgreSQL same isolation, audit/HTTP/Chromium 390×844; test only permitted synthetic resources and throwaway Compose.
- DG-07: authorization check and capability gates unchanged. No compensating repair endpoint; discrepancy demands trusted operator repair and replay.

This milestone is a correctness/safety guard on *recorded* receipts; NOT provider-verified settlement, refunds, repricing, dynamic line-item charges, tax/legal invoicing or production readiness. Issue #57 remains OPEN.
