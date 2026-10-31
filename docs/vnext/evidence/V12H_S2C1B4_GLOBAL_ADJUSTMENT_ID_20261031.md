# S2c-1b4 — globally unique correction IDs within a generated exact journal

Date: 2026-10-31 (UTC). Functional SHA: `9777c11a2de3ae30073fe25baca8b8d3ad595dea`.
Source: `examples/vnext/workshop-itemized-guard`; synthetic workshop records, disposable PostgreSQL. Issue #57 stays OPEN.

## Security boundary

The previous generated exact correction journal had only `PRIMARY KEY(parent_id, adjustment_id)`. The same client correction identifier could therefore be accepted against a *different* order, despite being rejected when retried against the original order. This is a cross-parent replay risk for an identifier that the mobile composer deliberately preserves after ambiguous network outcomes.

The generator now emits `UNIQUE(adjustment_id)` in addition to the existing composite PK. This is enforced by PostgreSQL on every journal write, including direct SQL, not by a pre-check in the browser or a race-prone `SELECT`. Existing generated NestJS and Spring HTTP adapters both map the resulting PostgreSQL `23505` to HTTP 409; the signed correction function runs journal insert, exact parent balance update and audit in a single transaction, so a failed unique insert cannot leave a partial financial mutation.

**Scope:** uniqueness is per *generated journal table*, not globally across unrelated tables or providers. This is an internal correction ID, **not** an external PSP/bank settlement idempotency key. The generated fresh schema is verified; no upgrade migration of a populated production ledger is claimed.

## Executed evidence

- [Generated itemized dual-target CI #41178593876](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41178593876) — **SUCCESS** on NestJS and modular Spring. The real PostgreSQL/HTTP/Chromium script now checks: (a) correction ID accepted on order A; same ID on order B rejected with HTTP 409, zero B journal/audit rows, both balances unchanged; (b) direct PostgreSQL duplicate insert rejected; (c) new ID on B succeeds; (d) ten simultaneous requests on ten different orders with the *same* ID produce **exactly one 201 and nine 409**, with a single 0.01 total increase and only four audit field events for the winner. All previous itemized, signed-correction, stale-reviewed-snapshot, ABA and mobile checks remain in the same executable suite.
- [Legacy receipt/reversal guard CI #41178593937](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41178593937) — **SUCCESS** in both independently generated backends with isolated PostgreSQL.
- [Quality CI #41178593875](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41178593875) — **SUCCESS**; [push quality #41178591002](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41178591002) — **SUCCESS**.
- `tests/vnext/financial-itemized.test.mjs` asserts the exact journal-wide unique DDL. All generated application code still comes from TypeSpec and shared adapters; no per-workshop handwritten runtime patch.

## Not yet implemented

There is no durable lookup of an adjustment's committed outcome after a lost response; a duplicate returns 409 without revealing whether the earlier write succeeded. External provider settlement reconciliation, provider-specific idempotency scope, verified webhook signatures, true refunds/credit notes, tax/legal policy, production IAM/tenancy and backup recovery remain out of scope. Do not call this an external settlement, close TL-14, issue a stable finance tag or deploy production.
