# Full-stack product requirements — ProtocolIA

**Status:** Requirements accepted and exercised for the bounded Books G0–G5 pilot (2026-10-13). Generalization, production, P4 economics, P5/P6 remain OPEN.  
**Date:** 2026-10-12 (revised after supplied deep integration study).  
**Scope:** Contract-to-software only (not the P3 executor or frozen P4 benchmark).  
**Related:** [Architecture decision](ADR-003-FULLSTACK-COMPOSITION.md), [reordered G0–G5 plan](FULLSTACK_IMPLEMENTATION_PLAN.md), [research alignment and upstream references](FULLSTACK_RESEARCH_ALIGNMENT_20261012.md), [existing product evidence](PRODUCT_FIRST_PLAN.md).

## 1. Problem and outcomes

ProtocolIA currently compiles strict v0.1/v0.2 JSON contracts and supports a working Java 21 / Spring Boot 4 API. Its typed business-handler boundary, safe regeneration and a stock-change maintenance example have been exercised. The **bounded v0.4 pilot now does** produce a usable typed React client, list/form/actions, and a real PostgreSQL-backed end-to-end test application from one versioned contract, as recorded in [G5 closeout](G5_CONTRACT_EVOLUTION_PROGRESS.md). This does not generalize to arbitrary services or a production deployment.

Target: A developer can describe a **supported** resource in one versioned contract, generate an actual API/typed frontend/forms with reproducible commands, implement explicit domain behavior in user-owned code, and demonstrate real HTTP operations, authorization and safe regeneration. A separate persistent profile must prove persistence before that claim can be made. The contract is a specification, not a substitute for implementing domain invariants, UX decisions or database design.

## 2. Functional requirements (acceptance-oriented)

| ID | Requirement | Minimum observable acceptance |
| --- | --- | --- |
| FR-01 | Versioned, deterministic source contract and canonical API description | Same pinned inputs produce byte-identical OpenAPI and owned artifacts; invalid/unknown grammar fails closed. |
| FR-02 | Single canonical operation, type and capability model | Every emitted operation has stable operationId, method/path, request, response, explicit success/error statuses, effects and capability. |
| FR-03 | HTTP specification/runtime parity | OpenAPI security scheme and statuses match **deployed target behavior**; test GET 200, POST 201, PATCH 200, 400/401/403/404/409 as relevant and unimplemented 501. |
| FR-04 | Working Java API with explicit domain handler | OpenAPI Generator 7.26.0 is the P0 replacement candidate (Java 21, Boot 4.1.1, delegates, Jackson 3), with the existing verified Java target as fallback. One generated HTTP controller/DTO layer invokes user-owned real delegates; no shadow controller or pretend business success. |
| FR-05 | Safe repeatable regeneration | Generator never silently overwrites or deletes user-owned files, altered generated files or unmanaged collisions; removed owned artifacts have verified manifest ownership. |
| FR-06 | Generated typed TypeScript HTTP client | Compare Orval 8.41.0 and Kubb 5.5.5 on identical fixtures, select ONE; compile and execute list/get/create/PATCH against a real backend with typed errors, auth and cache invalidation. |
| FR-07 | Contract-driven working web app | React displays Books list/detail, an RJSF (candidate 6.7.1) schema-driven Create/Adjust form, and loading/empty/error/validation/permission states; verify against real HTTP, not mocked screenshots. |
| FR-08 | Client-side query/cache consistency | After create/stock adjustment, affected list/detail queries refresh deterministically; stale results or failed writes are never presented as success. |
| FR-09 | Bounded resource listing and filter/pagination semantics | No silent unbounded collections or truncated lists. Declare and validate query parameters and page response semantics before calling listing production-ready. |
| FR-10 | AuthN/AuthZ aligned across layers | API enforces permissions server-side. UI affordances are advisory; anonymous/read-only users cannot write even by direct HTTP call. |
| FR-11 | Persistence with repeatable changes (separate supported profile) | PostgreSQL and explicit reviewed migrations when persistent support is claimed; transaction/concurrency/rollback tested on disposable DBs. DB-first tools do not enter the Spring core pilot. |
| FR-12 | Typed resource and UI metadata | Validated IR represents Resource, Operation, View, Capability and Effect. Derived ui-manifest maps list/detail/create/actions, identity field and order/labels; UI customization is user-owned, never overwritten. |
| FR-13 | Reproducible external adapters | Pin versions and generation configs; record exact commands, tool versions, hashes and generated/user-owned boundaries. |
| FR-14 | OpenAPI/contract change governance | Spectral 6.17.0 lint + oasdiff 1.11.7 breaking diagnostics + ProtocolIA semantic capability/effects comparison; regenerate/compile backend and frontend in isolation before accepting changes. |
| FR-15 | Honest evidence | Mark results as PROPOSED / IMPLEMENTED / VERIFIED / BLOCKED; verify observed Java/TS/browser/API results at exact commit. No productivity or cost claims without matched actual measurements. |
| FR-16 | Canonical contract and IR projections | One versioned semantic source emits deterministic OpenAPI 3.1, JSON Schema 2020-12, ui-manifest.json, capability-manifest.json and generation-manifest.json; none becomes a second editable contract. |
| FR-17 | Real backend operation completeness | Required operationId manifest matches implemented delegates; no required operation is 501-only; no fake stub success and no shadow controller. |
| FR-18 | Disposable generated trees | Java API/models, TypeScript client/hooks and normalized form schemas live in regenerable trees; after a second generation byte-diff is zero and user-owned files remain byte-identical. |
| FR-19 | OpenAPI 3.1 conformance corpus | Fixtures exercise required/optional, nullable, arrays, enums, oneOf/anyOf/allOf, refs, security, errors and x-protocolia-*; unsupported target semantics reject explicitly rather than silently degrading. |
| FR-20 | Schema-driven forms | BookRequest and StockAdjustment JSON Schemas produce functional RJSF create/action forms with actual required-field validation, custom user-owned presentation and real HTTP submission. |
| FR-21 | Server-side capability evaluation | Business capabilities remain distinct from OAuth scopes/roles. Every protected operation has allow+deny tests; OAuth2/OIDC target validates issuer, audience, signature and expiry before public deployment. |
| FR-22 | Bounded API property testing | Schemathesis 4.30.1 candidate runs against an isolated actual server, with bounded request budgets; keep explicit auth/concurrency/domain tests alongside it. |
| FR-23 | Contract evolution propagation | Once optional/null semantics work, a compatible field addition propagates through Java type, TS client, JSON Schema, UI field and contract tests without modifying manual code. |
| FR-24 | Externally managed tools | Verify actual upstream release, support and license before pinning exact toolchain. Orval/Kubb spike and Spring alternative must be reported PASS/FAIL, not presumed to work from documentation alone. |
| FR-25 | Generated client invalidation semantics | Successful writes refresh correct resource list/detail query keys, while errors never update UI as successful; mappings must be declared or demonstrably derived, not inferred from HTTP effect alone. |


## 3. Non-functional requirements

- **Security:** least-privilege capabilities, no public writes, fail closed on unsupported semantics, authenticated server-side checks, safe credentials and logs; demo Basic auth is development-only. No implicit production IAM readiness.
- **Correctness:** validations and declared response codes are not sufficient: negative HTTP tests, error serialization and concurrency/rollback tests are mandatory.
- **Compatibility:** migrate contract versions explicitly; keep v0.1/v0.2 behavior stable unless a versioned contract change or documented fix with regression tests.
- **Portability and maintainability:** no model provider needed for validation/generation/build; invoke third-party tools through pinned, replaceable CLIs. Separate disposable generated directories from user-owned root POM, domain/delegate, UI, HTTP auth adapter and reviewed migrations. No skipOverwrite preservation shortcuts or unjustified upstream forks.
- **Operational cost:** prefer no-cost local/free validation; do not consume unavailable GitHub Actions minutes or paid APIs. Research's GitHub Actions pipeline is a target design, not proof that paid/minute-constrained CI has run. Tool updates have deliberate review.
- **Developer experience:** one documented command for reproducible generation, and simple commands for build/test/run; messages explain unsupported constructs without fabricating implementations.
- **Traceability:** link requirements, ADRs, supplied research, acceptance tests and exact verified commit/deployment evidence. Proposed study version pins and numerical ROI targets are NOT observed results.

## 4. First supported vertical: Books

**Operations to deliver:** createBook (POST /api/books), listBooks (GET /api/books), getBook (GET /api/books/{isbn}), adjustStock (PATCH /api/books/{isbn}/stock). All four must have real delegates and response/error schemas in the truthful OpenAPI; list query/filter/page semantics require an explicit supported grammar before being described as scalable. Base models: Book, BookRequest and StockAdjustment. Add a page/list envelope and query/filter grammar only after verifying generator/backend/client support. Public health is a separate GET /health.

**Roles/capabilities:** anonymous health-only; catalog.read read-only; catalog.write allows mutation with explicit read mapping (do not assume write implies read). The initial Basic demo remains development-only. Target business capabilities (e.g. catalog.books.adjust-stock) map to trusted OAuth/JWT scopes/roles on the server; the client is never the authorization boundary.

**Domain policies (implemented by handwritten code, not inferred from OpenAPI):** ISBN unique, missing ISBN 404, duplicate 409 without mutation, title/isbn not blank, stock nonnegative, adjustment quantity 1..1000, integer overflow 409, atomic concurrent changes. Persistence and transaction isolation must be chosen and tested, not synthesized from an HTTP schema.

**User journey:** open Books, see a bounded list, open a detail, create valid Book, receive field errors for invalid input, adjust stock, see updated detail/list without manual reload; direct denied write returns 403. No mock HTTP responses in acceptance runs.

## 5. Not in scope for initial slice

- General website/page design generation, visual brand/design systems, arbitrary workflow designers or conversational UI synthesis.
- Automatic derivation of safe SQL, transactions, constraints, indexes or authorization from API paths.
- Full admin-platform integration, CRUD on arbitrary domain entities, or claiming optional/null/enum support before a valid Java/TS/schema fixture proves it. Refine Core/API Platform Admin remain optional PoCs; Inferencer is not the contract compiler.
- Full production IdP/SSO tenant administration, deployments with live customer data, paid platforms, multi-tenant access, generic arbitrary-code execution. A bounded OAuth2/JWT Resource Server pilot IS in scope at G4, not full production identity operations.
- Modifications to P4 frozen tasks, harness or claims of reduced model tokens/USD.

## 6. Release gate

A vertical is **DONE** only if (a) G0 contract/IR/OpenAPI/JSON Schema/manifests pass deterministic checks, Spectral and oasdiff/semantic diff gates, (b) G1 real generated Java API and all required delegates compile and pass HTTP tests without 501, (c) G2 ONE external TS client is selected after Orval/Kubb spike and typechecks, (d) G3 schema-driven RJSF Book forms and list/detail work on real HTTP and invalidate queries correctly, (e) G4 server-side authorizations have positive+negative tests, OAuth2 target verified when claimed, and bounded Schemathesis passes, and (f) G5 regeneration makes zero changes outside disposable generated paths, with contract-change propagation and reproducibility verified. Persistence is DONE only after independent PostgreSQL/Testcontainers verification. Anything short of this is partial implementation.

## 7. Change control

New requirements get an ID, proposed contract/version change, relevant acceptance test, and decision log entry. An ADR can be revised following the deep integration study; never silently convert a proposed stack into an accepted architectural commitment.
