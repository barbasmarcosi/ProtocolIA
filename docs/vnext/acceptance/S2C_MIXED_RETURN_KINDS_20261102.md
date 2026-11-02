# S2c — mixed refund and chargeback review boundary (2026-11-02)

## Risk and behavior

The read-only comparator previously classified a single provider refund **plus** a
single provider chargeback for the same transaction as `returns_agree_unverified`
when their exact per-kind totals matched the locally recorded return journal.
Despite exact arithmetic, those are different financial return lifecycles;
matching them does not establish whether the customer has been compensated
twice or whether a legitimate partial refund and a distinct chargeback coexist.

The comparator now emits:

- `mixed_provider_return_kinds_require_review` when a single
  `(providerId, transactionId)` has both refund and chargeback events.
- `mixed_recorded_return_kinds_require_review` when a single receipt has
  both locally **recorded** refund and chargeback events (voided events excluded).

These are review warnings, **not fraud findings or proof of provider settlement**.
They are independent of capture mismatch, reversal, other return differences,
missing links, orphan provider transactions and same-kind event multiplicity.
The historical `multiple_*_return_events_require_review` codes still count
repeated events **within the same kind**, not across kinds.

A refund on one transaction and a chargeback on another transaction is not
a mixed-kind anomaly. A voided local chargeback does not contribute to the
local mixed-kind warning. The primary row classification preserves the
pre-existing precedence of more severe discrepancies; independent exceptions
remain available regardless of primary label.

## Reproduction

```sh
node --check packages/adapters/provider-statement-reconciliation.mjs
node --test tests/vnext/provider-statement-reconciliation.test.mjs \
  tests/vnext/provider-statement-multi-anomaly.test.mjs \
  tests/vnext/provider-statement-cli.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs
```

Tests cover matched provider/local kinds, mismatched capture with both
external kinds, missing links, orphan transactions, voided returns,
transaction isolation, CLI exit code 2 and signed-statement replay marker
consumption even on review-only (exit 2) results.

Before merging, inspect the complete S2c Node 22/24 CI, quality, S2a/S2b,
and generated NestJS/Spring PostgreSQL/HTTP provider CI on the final PR head.
Do not mark this acceptance complete until those checks pass.

## Limits

No independent onboarding or legal authentication of a payment provider,
no distributed replay, no persisted multitenant financial reconciliation, no
bank-cleared settlement, no actual refund or chargeback processing, and no
production authorization or backup guarantees. Keep TL-14 (#57) OPEN and
do not deploy, produce financial release tags or operate on real money.
