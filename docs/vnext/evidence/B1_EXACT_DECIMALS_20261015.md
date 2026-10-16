# B1 — Exact decimals (isolated and integration acceptance SUCCESS)
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

**Isolated acceptance at tested source commit `4cbfc62a13175e57fdb7f57d94601a6c3401ec2e`:**
- [Two-backend generated-runtime acceptance #38838670042](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38838670042): SUCCESS. Both NestJS and Spring Boot compiled and passed generated Docker Compose/HTTP/PostgreSQL tests, and a separate exact-decimal black-box probe. Nest additionally passed real Chromium at 390×780 and uploaded the mobile screenshot.
- [Quality #38838670116](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38838670116): SUCCESS on the same tested SHA.
- Black-box markers: `PROTOCOLIA_B1_EXACT_DECIMAL_HTTP_PASS` (both) and `PROTOCOLIA_B1_EXACT_DECIMAL_BROWSER_PASS` (Nest/Chromium; zero JS errors). Exact large values survived DB/server restart.

## Definitive acceptance and integration — 2026-10-15/16 UTC

- **Authoritative executable source:** `f394ad1a336f48c8e19cfaae3853d4838da56896`; full targeted acceptance [#38838983811](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38838983811) **SUCCESS** for generated NestJS and Spring Boot, both with disposable PostgreSQL. Includes direct-SQL NaN and overflow rejection, max/min inclusive boundaries, required/null/optional semantics, malformed decimal scale, percentage limits, preservation of `9007199254740993.1234` beyond JS safe integers and persistence across DB/app restart.
- The generated NestJS React UI passed **Chromium mobile 390×780**, demonstrating preservation of decimal strings and zero page errors. Screenshot retained in artifact [exact-decimal-mobile-generated, #12021090029](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38838983811).
- The targeted [quality gate #38838983918](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38838983918) is **SUCCESS** on the same source SHA.
- Promoted **strict fast-forward**, no force, to `independent/volunteer-evaluations` at that exact SHA. The official regression [volunteer evaluations #38839240737](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38839240737) **SUCCESS** on both generated Nest and Spring, including independent HTTP/PostgreSQL and Nest Chromium. The official [quality #38839240740](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38839240740) is also **SUCCESS** on the same SHA.
- Existing B1.1 enums and conditional-required fields are preserved. Repository naming caveat: the earlier conditional-required increment is named **B1.2** in `B1_2_CONDITIONAL_REQUIRED_20261015.md`; exact decimals are recorded separately here to avoid falsifying that history.

**Scope conclusion:** exact decimal CREATE/read/list, validation, React entry and PostgreSQL persistence are empirically verified in this generator profile. General decimal business arithmetic, decimal PATCH/atomic increments, in-place production schema evolution, SQL pre-coercion scale rejection and deployment of the decimal fixture to Railway are **not** implemented or claimed.

**Documentation-only follow-up:** any later documentation commit is not evidence that a later executable revision passed these runs; the source SHA above remains the precise tested baseline.

**Deployment:** the Railway UX9 demo and persistent Neon schema remain unchanged.
