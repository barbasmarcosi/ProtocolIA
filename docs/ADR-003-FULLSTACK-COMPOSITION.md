# ADR-003 — Full-stack contract composition using maintained generators

**Status: PROPOSED FOR PILOT (architecture selected; integrations NOT verified).**  
**Revised:** 2026-10-12, aligned to the supplied [deep research assessment](FULLSTACK_RESEARCH_ALIGNMENT_20261012.md).  
**Basis:** [requirements](PRODUCT_REQUIREMENTS_FULLSTACK.md), [delivery gates](FULLSTACK_IMPLEMENTATION_PLAN.md), [ADR-002](ADR-002-JAVA-BACKEND.md).

## Problem and product boundary

ProtocolIA is NOT another generic Java, TypeScript, UI, or SQL generator. It owns a strict, versioned semantic contract, independent canonical IR, declared business capabilities/effects, and reproducible orchestration of external generators. Mature tools own commodity source generation. The resulting real software must enforce business rules, access control and persistence in handwritten application/domain code.

The existing Java 21 / Spring Boot 4 target and stock-change HTTP scenario are **verified for the bounded previous slice**, but this is not evidence that a new external backend, frontend, data store, OAuth2 or UI generator works. P4 is a separate frozen study and remains untouched.

**Blocking known mismatch:** the existing v0.2 OpenAPI emitter inherits bearerAuth and a 200 success response; the working Java demo implements Basic authentication and POST 201. No generated client should consume a misleading specification. Fix target-specific HTTP contract parity with regression tests before introducing downstream generators. Do not silently change v0.1 golden output.

## Decision: candidate stack and responsibilities

Versions below are **recommendations reported by the user-provided research dated 2026-10-12**, not dependencies installed or independently integration-tested. Every release, license and supported combination must be confirmed against upstream before pinning it in build files.

| Layer | Pilot selection | Status and rule |
| --- | --- | --- |
| Semantic source | ProtocolIA validated JSON contract, canonical IR | Only editable semantic source; existing v0.1/v0.2 compatibility protected |
| Public HTTP projection | OpenAPI 3.1, error schemas, operationId, securitySchemes and x-protocolia-* | One emitted profile for each truthful server security configuration, never user-maintained copies |
| Additional projections | JSON Schema 2020-12, ui-manifest.json, capability-manifest.json, generation-manifest.json | Deterministic projections of validated IR; no independently editable duplicate model |
| HTTP server generator | OpenAPI Generator **7.26.0**, spring generator | P0/G1 replacement candidate; delegatePattern=true, useSpringBoot4=true, useJackson3=true |
| Java runtime | Java 21, Spring Boot **4.1.1** target and manually controlled POM | Explicit app, domain, security and DB boundaries; generator owns only derived MVC/DTO interfaces |
| HTTP client generator | Orval **8.41.0** | G2 default candidate: one TypeScript client + TanStack Query hooks |
| Client alternate | Kubb **5.5.5** | Mandatory bounded G2 spike on the SAME fixtures, choose one; plugin extensibility may win |
| Client state/cache | TanStack Query | Do not also add RTK Query to the pilot |
| Forms | react-jsonschema-form (RJSF) **6.7.1** | G3 first-party pilot dependency; compile JSON Schema/form validators, preserve custom widgets |
| Application UI | React + TypeScript + Vite, handwritten shell/list/detail | UI fields/actions derived from ui-manifest; no claim automatic premium UX |
| Admin/framework optional | Refine Core as a *later* shell choice; API Platform Admin one PoC | Inferencer is heuristic and is NOT the deterministic compiler; do not impose both |
| Contract quality | Spectral **6.17.0** and oasdiff **1.11.7** | G0 gates; keep ProtocolIA custom semantic/capability-breaking diff |
| Behavioral API tests | Schemathesis **4.30.1** plus explicit JUnit/HTTP and browser E2E | G4 hard acceptance, bounded traffic on disposable instance |
| Authentication/authorization | Spring Security 7.1.x JWT/OAuth2 Resource Server/OIDC integration | G4 target; G1 already enforces existing capability policy, with allow/deny HTTP tests |
| Persistence | User-owned Spring JDBC/PostgreSQL/Flyway; Testcontainers | G5 or subsequent explicit pilot scope; do NOT infer SQL and auth from HTTP |
| Deployment | Existing Render path only after validation | No deploy-as-first-compiler; no paid API; avoid unnecessary GitHub Actions minutes |

**Scope exclusion:** Hasura, PostGraphile, PostgREST, Prisma/ZenStack, JHipster, Hilla, Wasp, Budibase, Appsmith, Directus, NocoBase and alternative ORM/UI stacks are reference architectures or future optional targets, not dependencies of this first Spring/React slice. Do not introduce TypeSpec as a second source of truth. Do not run Orval/Kubb/Hey API/RTK Query together as permanent dependencies.

## Architecture (target, NOT yet implemented)

    Human/agent proposal (untrusted)
        |
    ProtocolIA parser / semantic validation (versioned)
        |
    Canonical IR: Resource - Operation - Model - View - Capability - Effect
        |                    |                   |
        v                    v                   v
    OpenAPI 3.1       JSON Schema 2020-12   ui/capability/generation manifests
        |                    |                   |
        +-- Spectral          +-- RJSF forms      +-- UI resource/action composition
        +-- oasdiff
        +-- Spring OpenAPI Generator 7.26 -> generated Java API/DTO/delegate
        |                                        |
        |                                  user-owned domain and Spring Security
        |                                        |
        |                                   user-owned persistence
        +-- Orval OR Kubb -> generated TS client/TanStack Query hooks
                                    |
                             user-owned React app
                                    |
                 Real HTTP/E2E + Schemathesis + authorization tests

**Generated output:** only under clearly marked disposable directories: Java target/generated-sources/openapi, web/src/generated/*, and generated manifests/schema in build output. All may be deleted/rebuilt. Avoid 'skipOverwrite' as an ownership strategy. **User-owned:** root POM, domain service/delegates, policies, reviewed DB migrations, React pages/components/styles, HTTP auth adapter and business tests. Build stage must stage new generated trees separately, validate and compile, then replace only generated paths; no silent overwrite, symlinks or unmanaged collisions.

## Normative semantic IR boundaries

- **Resource:** stable ID, model, identity field, list/detail/create/action operation references, permitted relationships.
- **Operation:** stable operationId, HTTP method and path, request/response type, query/path parameter schema, explicit success and error responses, resource role, capability requirement, declared effects.
- **View:** resource ID, list/detail/create/custom-action kind, field order, labels, required form fields/widgets, operator-owned customizations.
- **Capability:** business authorization name, separate from OAuth scopes and user roles; caller claim resolution comes from **trusted deployment mapping**.
- **Effect:** read/write declarations and dependencies; these are descriptive and not a substitute for atomic application/DB enforcement.

Examples of projections: x-protocolia-resource, x-protocolia-operation-role, x-protocolia-capability, x-protocolia-effects. Do NOT insert unsupported properties into v0.2 and silently bypass its strict validator. Add a versioned schema or validated sidecar first, then implement normalization, golden tests and compatibility rules. A UI manifest is the sole generated mapping of resource operations/fields; cache invalidation is explicit per resource/action or provably derived and tested, not guessed from PATCH paths.

### Target Books fixture

- createBook: POST /api/books, returns **201** and Book.
- listBooks: GET /api/books, bounded page/filter input, returns an explicit list/page envelope.
- getBook: GET /api/books/{isbn}, returns **200** and Book or 404.
- adjustStock: PATCH /api/books/{isbn}/stock, quantity 1..1000, returns **200** or 400/401/403/404/409.
- health: GET /health, public.

The current v0.2 Java generator does not support arbitrary query-param grammar or optional/null payload semantics. Do not claim list pagination or author?/publishedAt? propagation until **versioned grammar + Java/TS/form tests** prove it. Make array envelope and bounded controls explicit. Do not replace user-owned atomic stock logic with synthesized SQL. The change-of-contract pilot should eventually add an optional field only *after* optionality is supported end to end.

## Auth and completeness (must not be faked)

- Demo target currently uses HTTP Basic; emitted OpenAPI for this target MUST declare Basic. OAuth2/OIDC JWT target needs real issuer/audience/signature/expiry checks, a capability evaluator and an independently reviewed authority mapping; do not simply relabel bearerAuth.
- A protocol capability (e.g. catalog.books.adjust-stock) is NOT identical to OIDC scope (e.g. catalog.stock.write). Server policy maps trusted claims/roles/scopes to capabilities. Generated @PreAuthorize from raw OAuth scopes alone is insufficient to prove semantic authorization.
- From every operationId produce a required-operation manifest. Missing/501-only business delegate is a **failed completeness gate**, not a successful runtime. Direct HTTP allow/deny test for every protected capability, including anonymous and reader/write denial.
- Operation error schemas and status documentation must describe actual server error serialization. A syntactically valid spec does not prove behavior; independently check 400, 401, 403, 404, 409 and unexpected failures. Schemathesis supplements domain/concurrency tests, does not replace them.

## Selected alternatives and reversal criteria

1. **Spring OpenAPI Generator:** build isolated G1 candidate against G0 source-derived OpenAPI. Try only API/DTO/delegate artifacts and manual root POM. Compare actual Java 21/Maven/HTTP outputs with current ProtocolIA adapter. If parity, auth, regeneration, and completeness gates are equal-or-better with less maintenance, promote OpenAPI Generator. **Fallback:** retain proven ProtocolIA Java target and record the limitation. No automatic replacement based solely on reputation.
2. **Orval vs Kubb:** pin both *for isolated G2 spike only* and run same four operations / OpenAPI 3.1 fixtures. Inspect query hooks, error types, auth transport, generated drift, x-protocolia extensions and regeneration. Adopt ONE; if neither works use openapi-typescript + openapi-fetch, explicit TanStack Query integration.
3. **RJSF:** generate BookRequest forms from explicit JSON Schema and test Draft 2020-12 validator, required/invalid/unknown fields and custom actions. Retain handwritten widgets/screens if schema-driven forms degrade UX. Do not adopt JSON Forms simultaneously.
4. **Refine vs React Admin:** optional bounded PoC after UI manifest works. Refine Core may provide a shell; do not build ProtocolIA around Inferencer's sample-data heuristics or redesign contracts to appease API Platform Admin.
5. **DB-first:** excluded from initial Spring/React profile to avoid duplicated API/auth/business policy planes. May be separately designed as alternate target if product demand proves it.

## Exit gate and evidence

This ADR becomes **ACCEPTED** only after the source study's upstream facts/licensing are reviewed, the G0 parity fixture passes, and the G1/G2 spikes report real compilation and HTTP comparison. Subsequent forms/OIDC/regen gates remain rollout requirements, not falsely pre-certified integrations. Measure contract-to-green time, manually maintained code, diff amplification, generated-files determinism, the number of 501 operations, and failure rates. Proposed numeric targets in the study (such as 30% time reduction or 40% fewer manual plumbing lines) are hypotheses, not observed results or grounds for exaggerated claims.

P4 trials, cost accounting and frozen candidates are outside this decision. This ADR supersedes the **proposed full-stack sequencing** of its 2026-10-12 first draft; it does NOT retroactively change ADR-002 or the completed product stages.
