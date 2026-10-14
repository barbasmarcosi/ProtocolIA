# A14 — Typed, contract-derived list filtering (post-A13)

**Status:** implementation scoped; branch isolated from verified A13. Source freeze of A13 remains untouched.

## Customer demand

From the independently frozen A13 customer brief, C15 requires filtering tickets by site, state and due dates, with a correct total and pagination after filtering. The current `listPage` operation rejects all query parameters except `limit` and `offset`.

## Neutral contract abstraction

`@filterBy(queryName, propertyPath, comparison)` is only valid on a `@behavior("listPage", "Entity")` operation. Multiple filter decorators are allowed. Every declared filter must bind an optional, typed `@query` parameter in the same TypeSpec operation.

- `propertyPath`: a direct entity field, e.g. `status`, or exactly one trusted FK hop, e.g. `machineTag.siteCode` on Ticket → Machine → siteCode. No arbitrary SQL, subqueries, user-supplied paths, or multi-hop chains.
- `comparison`: `eq` on string/int32/date-time, `gte` or `lte` only on int32/date-time. The field and query parameter must have identical TypeSpec scalar types.
- The compiler fails closed on unsupported paths, unknown/duplicate query parameters, absent `@query` definitions, wrong scalar type, unrecognized operators, required filter values or use on non-list operations.
- IR carries neutral filter descriptions `{query,fieldPath,operator,type}`; adapters resolve trusted field/relation metadata and emit parameterized PostgreSQL predicates, including a one-hop `EXISTS` on the referenced table. Filter values are never treated as SQL identifiers.
- Filters combine with **AND**. Both `items` and `total` use identical WHERE constraints before `ORDER BY publicIdentity LIMIT/OFFSET`. Empty strings, impossible UTC values, unknown query args and invalid int32 return 400; absent filters keep exact A0–A13 behavior.
- Reader capability is reused, no cross-tenant authority implied. Listing remains bounded `limit` 1–50, `offset` 0–1000000.
- Generated React may initially show no filter editor; A14 server filtering is considered incomplete for C15 until a user can apply fields in the generated mobile UI.

## Acceptance

New **A14 separate fixture** derives the frozen A13 maintenance contract but adds: `siteCode` via `machineTag.siteCode` equality; `status` equality; `dueFrom` as `dueAt gte`; and `dueTo` as `dueAt lte`. The A13 original remains untouched, and its 13/16 acceptance result must never change retroactively.

Prove in both generated Spring and Nest:
1. Known fixture across two sites, two ticket statuses and three deadlines.
2. Query by site alone, state alone, date range and combined intersection.
3. Matched total and pagination, including zero matches and stable ordering.
4. Query injection and malformed date/unknown filter must yield 400 or return zero, not alter SQL.
5. Reader read and writer authority remain distinct, Spring/Nest HTTP results identical.
6. React responsive UI filter controls and Chromium behavior, without source edits per entity.
7. Existing A0–A13 tests still pass and prior A13 fixture/build hashes unchanged.

**No PASS until real generation and independent PostgreSQL+HTTP+Chromium logs.**

**Explicit non-goals:** arbitrary joins of multiple hops, full-text search, dynamic sorting, OR groups, aggregates, row-level security, production deployment, date-field expression evaluation, and complex multi-entity query language.
