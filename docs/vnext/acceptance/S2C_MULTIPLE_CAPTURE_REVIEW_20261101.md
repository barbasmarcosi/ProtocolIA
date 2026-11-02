# S2c — multiple capture events require independent review (2026-11-01)

## Risk and bounded behavior

The read-only comparator previously **summed every provider capture event** for
one `(providerId, transactionId)` and classified the receipt as
`amounts_agree_unverified` when the total equaled the internal receipt.
Two independently identified captures (e.g. 4.00 + 6.00 for a 10.00 receipt)
could therefore look indistinguishable from a single capture. Some providers
legitimately support partial/multiple captures; the comparator has no provider
contract establishing that semantics. It must **flag review, not assume fraud
or settlement**.

Now each provider transaction tracks its number of capture events separately
from exact BigInt totals. More than one capture event produces the independent
`multiple_capture_events_require_review` exception, including when another
exception (wrong total, reversal, over-return) takes primary precedence or
the external transaction is unmatched. When it is the only anomaly, the
primary classification also reflects this review requirement. A single
capture per independently linked transaction retains prior behavior.

The result remains `comparison_only_not_settlement_verification`. This
does not prohibit legitimate partial captures, deduplicate provider events
across statements, authenticate a provider, settle a bank transfer, or process
refunds. The existing event-ID replay gate continues to consume accepted
signed statements **even if the comparison has exceptions** (exit 2);
repeating the same signed events fails closed.

## Regression acceptance

```sh
node --check packages/adapters/provider-statement-reconciliation.mjs
node --test tests/vnext/provider-statement-multi-anomaly.test.mjs \
  tests/vnext/provider-statement-cli.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs
node --test tests/vnext/provider-statement-*.test.mjs
```

Required before merge: S2c Node 22/24, quality and both generated
NestJS/Spring PostgreSQL/HTTP provider-preflight gates plus S2a/S2b finance
regressions. Keep TL-14 #57 open; no production financial operations or
stable release tag.
