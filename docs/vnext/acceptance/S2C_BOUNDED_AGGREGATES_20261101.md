# S2c — bounded exact financial aggregates (2026-11-01)

## Risk and invariant

The offline reconciliation comparator previously validated **each** decimal string
against PostgreSQL-compatible `NUMERIC(38, scale)` precision but did not bound
**sums**. Two individually valid near-maximum amounts could produce a total
outside the declared numeric domain, while still emitting a comparison report
with an apparently valid exact total. This is especially dangerous when
downstream operators compare the report against generated Spring/Nest
PostgreSQL `NUMERIC` values.

The comparator now fails closed with `unsupported aggregate precision`
whenever any sum reaches or exceeds `10^38` minor units (scale 0–6):
posted receipts; recorded returns per receipt, kind and globally; purported
captures per provider transaction and globally; purported refunds and
chargebacks per transaction, combined returns and globally. This is
**exact integer arithmetic** (`BigInt`), not floating point or truncation.

The largest representable amount remains accepted, including scale 2:
`999999999999999999999999999999999999.99`. The sum of two such amounts
is rejected. Overflow aborts the CLI before output and before any local
statement/event replay marker can be consumed. It does not mutate a
financial ledger or prove provider identity, actual settlement, tax correctness,
or the completeness of an externally supplied snapshot.

## Reproduction and merge gate

```sh
node --check packages/adapters/provider-statement-reconciliation.mjs
node --test tests/vnext/provider-statement-reconciliation.test.mjs
node --test tests/vnext/provider-statement-*.test.mjs
```

Required CI: S2c Node 22 and 24, quality, generated NestJS and Spring
PostgreSQL/HTTP provider preflight, and S2a/S2b finance regression gates.
Do not merge while relevant checks are pending or failing. Keep TL-14 #57
open. No deployment, stable financial release or real money operations.
