# B1 — Exact decimals (isolated acceptance pending)
## Semantic contract
TypeSpec `decimal` must be annotated with both `@encode(string)` and
`@exactDecimal(precision,scale,min?,max?)`; min/max are canonical decimal
**strings**, never JavaScript numbers. The IR carries `type:"decimal"` and
`decimal:{precision,scale,min?,max?}`. Precision ranges 1–38, scale 0–precision.

## Generation
- React preserves user-entered base10 strings and uses a mobile decimal keyboard;
  it never performs `Number(...)` coercion.
- Nest validates canonical strings via a base10 grammar and `BigInt` integer-scaled
  comparison, passes string values to parameterized PostgreSQL statements, and reads
  PostgreSQL NUMERIC values as strings.
- Spring validates with `BigDecimal`, binds SQL parameters as `BigDecimal`, and
  serializes results as decimal strings without scientific notation.
- PostgreSQL uses `NUMERIC(p,s)`, exact numeric limits, and a rejection CHECK for
  NaN/Infinity. Direct SQL integer overflow/range errors are exercised separately.
- The two adapters reject malformed IR and verify that HTTP OpenAPI represents
  these fields as JSON strings.

## Important boundary
PostgreSQL `NUMERIC(p,s)` **rounds excessive fractional digits before CHECK
constraints can observe them**. Strict no-rounding semantics are guaranteed on
generated HTTP write paths by validation before binding. Arbitrary SQL clients
with direct write privileges can still request scale coercion. Production deployments
should restrict direct table mutation; a separate raw-input staging design is required
to forbid such SQL rounding universally. No existing Neon schema was migrated.

## Acceptance
Fixture: `examples/vnext/exact-decimals`.
Compiler negative tests: `tests/vnext/exact-decimals.test.mjs`.
PostgreSQL/HTTP/Chromium oracle: `scripts/vnext/probe-exact-decimals-http.mjs`.
CI: `.github/workflows/vnext-b1-exact-decimals.yml`.

**Status:** Code committed in an isolated implementation branch; no completion
claim until both runtimes, PostgreSQL, Chromium and quality checks pass on
the exact same SHA. The Railway UX9 demo remains pinned and unchanged.
