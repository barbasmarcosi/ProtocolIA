# UX4 — Contract-authorized server-paged relation selection (2026-10-15)

## Scope and source of truth

An entity's `listPage`, `get`, and optional `queryPage` operations are authored in TypeSpec and compiled into the canonical IR. Both NestJS and Spring Boot share the query-plan semantics. React does not infer a new read capability, expose unspecified columns, or filter only the first 50 records while representing it as global search.

The generic component `packages/adapters/modular/templates/web/src/PagedReferencePicker.jsx` is copied into both generated web outputs. For related resources larger than the previous first-page limit (50), it provides server pages of 25, navigation and counts, a debounced and abortable text query, keyboard options, Escape handling, empty/error/loading states, authorized GET hydration of saved off-page references, and immutable foreign-key storage. It is used by both creation and compare-and-swap reassignment. Smaller lists retain the mature Radix Select.

The `@queryFilter("name","contains")`, `@queryFilter("badge","contains")`, and `@queryFilter("rank","contains")` examples demonstrate case-insensitive substring search on only explicitly declared string fields. Each query remains protected by its contract read capability. The SQL query plan allowlists identifiers at generation time and parameterizes values; `!`, `%`, and `_` in submitted text are escaped as literal characters using `ILIKE ... ESCAPE '!'`.

## Automated evidence

- Full isolated two-adapter generated-app validation: [run #38792714442](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38792714442), **SUCCESS**.
- NestJS: compiled TypeSpec and IR, generated backend/frontend, Docker Compose and real PostgreSQL conformance, independent HTTP API/permission probe, Chromium generated UX probe.
- Spring Boot: generated independently from the same TypeSpec, Docker/PostgreSQL conformance, independently frozen HTTP oracle.
- Separate functional contract family: `tests/vnext/a14-query.test.mjs` uses **FacilitySearch** (Site, Machine, Ticket) and asserts query plans, authorized SQL safety, invalid filter rejection, and Nest/Spring parity.
- Chromium generated-app pass marker includes `pagedRelationOver50: true`, `pagedReassignment: true`, `offPageHydration: true`, `clientJavascriptErrors: 0`. Tests seed only fictional parents and guards, select an item after the first 50, persist it, reassign to another off-page reference, then recover its label via authorized GET.
- [Visual evidence artifact from successful run](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38792714442): generated desktop listing/detail and picker desktop/mobile. Images were opened and visually inspected. First mobile version occupied the full viewport with one result; after review it was replaced with an adaptive bottom sheet. The updated image presents the search controls, matching item and paging controls without a large empty screen.

## Boundaries and honest limitations

- `ILIKE '%...%'` is parameter-safe but may need `pg_trgm` or an explicitly authorized indexing/search policy for large production datasets. The present bounds remain the contract's `offset <= 1,000,000`.
- The metadata currently allows at most one declared `queryPage` operation per entity. For forms, persisted off-page selection labels are hydrated; arbitrary **table summary** references may still display the public key if no readable label was loaded.
- This does not close server-authoritative `YYYY-MM` format validation, task-driven workflow design, advanced destructive-action confirmation, structured field-error mapping, or all application-specific business rules marked unsupported in the independent acceptance freeze.
- Green code/build/browser tests are not a blanket 10/10 UI rating. New generated domains still require usability and assistive-technology review; no firefighter-identifying data was used.

## Release discipline

This evidence was produced on an independent feature branch. The work is eligible for fast-forward into `independent/volunteer-evaluations` after removing its temporary staging workflow. `main` and PR #52 must remain unchanged. Railway should be pointed only at a commit that has passed the independent branch integration gate.
