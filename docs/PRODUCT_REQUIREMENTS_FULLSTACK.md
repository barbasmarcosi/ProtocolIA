# Full-stack product requirements — ProtocolIA

**Status:** Proposed baseline for implementation; decisions still subject to the external integration research.  
**Date:** 2026-10-12.  
**Scope:** Contract-to-software only (not the P3 executor or frozen P4 benchmark).  
**Related:** [Architecture decision](ADR-003-FULLSTACK-COMPOSITION.md), [delivery plan](FULLSTACK_IMPLEMENTATION_PLAN.md), [existing product evidence](PRODUCT_FIRST_PLAN.md).

## 1. Problem and outcomes

ProtocolIA currently compiles strict v0.1/v0.2 JSON contracts and supports a working Java 21 / Spring Boot 4 API. Its typed business-handler boundary, safe regeneration and a stock-change maintenance example have been exercised. It does **not** yet produce a usable typed React client, list/form UX and persistent end-to-end application from one contract.

Target: A developer can describe a **supported** resource in one versioned contract, generate a real API and typed frontend with a reproducible command, implement explicit domain behavior in user-owned code, and demonstrate real HTTP operations, authorization, persistence and safe regeneration. The contract is a specification, not a substitute for implementing domain invariants, UX decisions or database design.

## 2. Functional requirements (acceptance-oriented)

| ID | Requirement | Minimum observable acceptance |
| --- | --- | --- |
| FR-01 | Versioned, deterministic source contract and canonical API description | Same pinned inputs produce byte-identical OpenAPI and owned artifacts; invalid/unknown grammar fails closed. |
| FR-02 | Single canonical operation, type and capability model | Every emitted operation has stable operationId, method/path, request, response, explicit success/error statuses, effects and capability. |
| FR-03 | HTTP specification/runtime parity | OpenAPI security scheme and statuses match **deployed target behavior**; test GET 200, POST 201, PATCH 200, 400/401/403/404/409 as relevant and unimplemented 501. |
| FR-04 | Working Java API with explicit domain handler | Generated controller/DTO/validation/security invoke user-owned typed business implementation; no shadow controller or pretend business success. |
| FR-05 | Safe repeatable regeneration | Generator never silently overwrites or deletes user-owned files, altered generated files or unmanaged collisions; removed owned artifacts have verified manifest ownership. |
| FR-06 | Generated typed TypeScript HTTP client | External maintained generator consumes emitted OpenAPI; compile and execute GET/POST/PATCH against a real backend, including error handling. |
| FR-07 | Readable working web app | React app displays a Books list, Book detail and Create form, and can adjust stock; loading/empty/error/validation states work. |
| FR-08 | Client-side query/cache consistency | After create/stock adjustment, affected list/detail queries refresh deterministically; stale results or failed writes are never presented as success. |
| FR-09 | Bounded resource listing and filter/pagination semantics | No silent unbounded collections or truncated lists. Declare and validate query parameters and page response semantics before calling listing production-ready. |
| FR-10 | AuthN/AuthZ aligned across layers | API enforces permissions server-side. UI affordances are advisory; anonymous/read-only users cannot write even by direct HTTP call. |
| FR-11 | Persistence with repeatable changes | PostgreSQL and explicit schema migration strategy; transaction and concurrency semantics tested in disposable DBs before claiming persistence complete. |
| FR-12 | Extensible but minimal UI metadata | Support a bounded declared resource-to-operation mapping and field ordering/labels; custom domain screens remain user-owned, not overwritten. |
| FR-13 | Reproducible external adapters | Pin versions and generation configs; record exact commands, tool versions, hashes and generated/user-owned boundaries. |
| FR-14 | OpenAPI/contract change governance | Lint specs, compare breaking changes and regenerate/compile backend and frontend in an isolated workspace before accepting changes. |
| FR-15 | Honest evidence | Mark results as PROPOSED / IMPLEMENTED / VERIFIED / BLOCKED; only call a behavior verified after observed builds and HTTP/DB tests. No productivity or cost claims without valid measurements. |

## 3. Non-functional requirements

- **Security:** least-privilege capabilities, no public writes, fail closed on unsupported semantics, authenticated server-side checks, safe credentials and logs; demo Basic auth is development-only. No implicit production IAM readiness.
- **Correctness:** validations and declared response codes are not sufficient: negative HTTP tests, error serialization and concurrency/rollback tests are mandatory.
- **Compatibility:** migrate contract versions explicitly; keep v0.1/v0.2 behavior stable unless a versioned contract change or documented fix with regression tests.
- **Portability and maintainability:** no model provider needed for validation/generation/build; adapters call third-party tools through pinned, replaceable CLIs or local packages; do not fork upstream libraries without demonstrated need.
- **Operational cost:** prefer no-cost local/free validation; do not consume GitHub Actions minutes or paid APIs without explicit need. Tool updates have deliberate review.
- **Developer experience:** one documented command for reproducible generation, and simple commands for build/test/run; messages explain unsupported constructs without fabricating implementations.
- **Traceability:** link requirements, ADRs, acceptance tests and verified commit/deployment evidence. Docs describe intended behavior distinctly from delivered code.

## 4. First supported vertical: Books

**Operations to deliver:** createBook (POST /api/books), listBooks (GET /api/books), getBook (GET /api/books/{isbn}), adjustStock (PATCH /api/books/{isbn}/stock). Base models: Book, BookRequest and StockAdjustment. Add a page/list envelope and query/filter grammar only after verifying generator/backend/client support. Public health is a separate GET /health.

**Roles:** anonymous health-only; catalog.read read-only; catalog.write allows mutation, with explicitly defined read access policy (do not assume write implies read). The existing demo viewer is read-only by generated capabilities. Authorization must be checked at HTTP level.

**Domain policies (implemented by handwritten code, not inferred from OpenAPI):** ISBN unique, missing ISBN 404, duplicate 409 without mutation, title/isbn not blank, stock nonnegative, adjustment quantity 1..1000, integer overflow 409, atomic concurrent changes. Persistence and transaction isolation must be chosen and tested, not synthesized from an HTTP schema.

**User journey:** open Books, see a bounded list, open a detail, create valid Book, receive field errors for invalid input, adjust stock, see updated detail/list without manual reload; direct denied write returns 403. No mock HTTP responses in acceptance runs.

## 5. Not in scope for initial slice

- General website/page design generation, visual brand/design systems, arbitrary workflow designers or conversational UI synthesis.
- Automatic derivation of safe SQL, transactions, constraints, indexes or authorization from API paths.
- Full admin-platform integration, CRUD on arbitrary domain entities, complex nested/optional/enum wire models before supported semantics are proven.
- SSO/OIDC production infrastructure, deployments with live customer data, paid platforms, multi-tenant access, generic arbitrary-code execution.
- Modifications to P4 frozen tasks, harness or claims of reduced model tokens/USD.

## 6. Release gate

A vertical is **DONE** only if (a) contract/OpenAPI is validated and parity-checked, (b) Java + frontend clean builds pass, (c) real authorized and unauthorized HTTP end-to-end tests pass, (d) list/create/stock UI actually works against that backend, (e) regeneration preserves changed handwritten code, and (f) all unsupported features remain explicit. Anything short of this is partial implementation.

## 7. Change control

New requirements get an ID, proposed contract/version change, relevant acceptance test, and decision log entry. An ADR can be revised following the deep integration study; never silently convert a proposed stack into an accepted architectural commitment.
