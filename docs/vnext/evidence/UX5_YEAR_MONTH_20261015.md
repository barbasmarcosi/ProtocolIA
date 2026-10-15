# ProtocolIA UX5 — Authoritative year-month formats and safe release migration

**Date:** 2026-10-15  
**Contract source:** standard TypeSpec `@pattern("^[0-9]{4}-(0[1-9]|1[0-2])$")`  
**Scope:** ProtocolIA generator, not handwritten VolunteerEvaluations logic

## Implemented

- Standard TypeSpec `@pattern` -> canonical `IrField.pattern`, without inventing a redundant ProtocolIA decorator.
- Only the anchored, portable `YYYY-MM` subset is accepted. Unsupported expressions fail closed at the TypeSpec compiler and both adapters.
- NestJS, Spring Boot, shared generated React and PostgreSQL enforce the same bounds. Both backends reject malformed creation bodies and period filter values; the browser input remains ergonomic rather than authoritative.
- TypeSpec request models and entity models declare the same pattern. A separate FacilitySearch fixture tests adapter/schema generality.
- The `diffContracts` evolution engine recognizes only `undefined → supported year-month pattern` with all other field constraints unchanged. Existing patterns cannot be weakened or replaced.
- `validateOpenApiEvolution` permits only the exact expected request, entity and query-parameter validation changes. Unrelated API drift remains blocked.
- `additiveSql` emits stable `ADD CONSTRAINT ... NOT VALID` and `VALIDATE CONSTRAINT`. These execute in versioned, transactional migrations preserving all user data; invalid historical rows fail the transaction.
- The production Dockerfile generates UX4 from an immutable contract snapshot in `deployment/volunteer-evaluations/releases/ux4`, then runs official ProtocolIA `evolve` to build the current app while keeping the original SQL baseline and adding V2.

## Independently observed proof

- [Full generated Nest/Spring/PostgreSQL/Chromium + real release evolution — SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38799511956)
- [Five generated UX captures](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38799511956/artifacts/12003607573)
- [Generated-only first release compilation/HTTP parity — SUCCESS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38797455878)
- Real PostgreSQL probe: an existing invalid month causes migration failure and transaction rollback with the records intact; after simulated correction, constraints validate successfully and new malformed inserts fail.
- A generated NestJS application is built using the immutable UX4 baseline, evolved to UX5, started with the preserved baseline + versioned migration, and tested in Docker/PostgreSQL. The Spring-generated application independently passes the frozen HTTP oracle.
- Before release, a read-only Neon check counted 3 evaluation rows and 1 leave row, with **zero** invalid periods. No identifying values or credentials were inspected or published.

## Boundaries

This is not general arbitrary regex support, full business scoring, field-level structured error responses, row-scoped authorization, or proof of usability for every generated domain. Any further runtime schema changes must follow the same source-frozen, additive migration process. Railway is pinned to the last approved SHA; actual UX5 live deployment must be verified separately before stating that the upgraded release is live.

Historical records must never be silently deleted, rewritten or exported during schema evolution.
