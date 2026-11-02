# S2c — independent provider return-event visibility (2026-11-01)

## Failure mode and scope

The offline comparator retained only a single primary classification per receipt.
When an optional internal return journal was absent, an external refund or
chargeback could disappear from `exceptions[]` if an earlier branch selected
`capture_amount_mismatch` or `internal_reversal_requires_review`. The amounts
remained in the report, but a machine consumer of exception codes could miss
a second financial concern.

Also, two distinct provider refund events (or two chargebacks) could sum to
the locally recorded return amount and receive `returns_agree_unverified`
with zero exceptions. A provider might legitimately permit partial returns;
without a provider-specific lifecycle contract this requires operator review,
not an automatic fraud or settlement conclusion.

## Contract

- Preserve the existing primary `rows[].classification` precedence for
  mismatched capture, reversed receipt and return-kind mismatch.
- Add independent `external_return_requires_review` whenever provider returns
  exist and no internal return journal was supplied, including when another
  classification wins. Do not emit a duplicate of the primary classification.
- Count external refund events and chargeback events **separately** per provider
  transaction. More than one event of either same kind emits
  `multiple_return_events_require_review`, even if the exact sum agrees with
  the local return journal. One refund plus one chargeback is not a repeated
  same-kind event.
- For unmapped provider transactions, preserve `unmatched_external_transaction`
  and separately expose external returns and repeated same-kind events.
- Preserve exact BigInt arithmetic, deterministic exception order, no input
  mutation, no false bank-clearing authority and existing signed replay
  consumption. A review exception yields CLI exit 2, not 0.
- This does not authenticate provider identity, establish settlement, prove
  the statement is complete, or execute any refund/chargeback.

## Reproducible checks

```sh
node --check packages/adapters/provider-statement-reconciliation.mjs
node --test tests/vnext/provider-statement-reconciliation.test.mjs \
  tests/vnext/provider-statement-multi-anomaly.test.mjs \
  tests/vnext/provider-statement-cli.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs
node --test tests/vnext/provider-statement-*.test.mjs
```

Before merge: S2c Node 22/24, quality and both generated NestJS/Spring
PostgreSQL/HTTP gates including S2a/S2b must pass. TL-14 issue #57 remains
open; no production payments, financial tags or deployments.
