# ADR-003 — Compose ProtocolIA into a real full-stack application

**Status:** PROPOSED — initial engineering hypothesis, not final selection; deep external integration research pending.  
**Date:** 2026-10-12.  
**Prior decisions:** [ADR-002 (Java backend)](ADR-002-JAVA-BACKEND.md), [existing architecture](ARCHITECTURE.md).  
**Requirements:** [Full-stack requirements](PRODUCT_REQUIREMENTS_FULLSTACK.md).  
**Delivery:** [Implementation plan](FULLSTACK_IMPLEMENTATION_PLAN.md).

## Context

The existing contract v0.2 and Spring target are operational, but backend HTTP behavior and exported OpenAPI are not fully aligned. In current source the OpenAPI emitter inherits a bearerAuth scheme and defaults to a 200 success response for every operation, while the Java example configures HTTP Basic and annotates POST with 201. Building a typed client or UI on contradictory API descriptions would propagate contract drift.

The Java target generates controllers that delegate to an explicit user-owned ContractHandlers implementation. Real stock-change HTTP tests passed on the existing in-memory vertical, but that does not demonstrate database persistence, generic forms, typed web clients or developer-time savings.

## Decision proposed for the first slice

**Keep ProtocolIA as the sole authority for contract semantics and effects/capabilities; use established tools for commodity client/UI/persistence work. Do not replace the working Java adapter before an independent parity spike.**

| Concern | First-choice candidate | Ownership and reason | Status |
| --- | --- | --- | --- |
| Source of truth | ProtocolIA versioned JSON contract + validated IR | ProtocolIA owns operations, models, capabilities, effects; no competing handwritten OpenAPI | EXISTING |
| API interchange | Deterministic OpenAPI 3.1 JSON with bounded x-protocolia-* extensions | Standard consumers; one canonical emission per target profile | FIX PARITY FIRST |
| Spring server | Existing Java 21 / Spring Boot 4 typed handler adapter | Least-risk path with working product evidence; keep business rules user-owned | EXISTING |
| TypeScript API and hooks | Orval with its TanStack Query target | Candidate established OpenAPI-to-client/hook generator; pinned CLI/config, no bespoke fetch generator | TO SPIKE |
| Web runtime | React + TypeScript + Vite + TanStack Query | Thin functional UX and declarative asynchronous state; avoid a generated app framework up front | TO IMPLEMENT |
| Form UI | Plain explicit React form first; assess RJSF/JSON Forms on one BookRequest | Prefer field/validation alignment; select schema-driven forms only after verifying JSON Schema compatibility and UX | EVALUATE |
| CRUD administration | React Admin or Refine | Evaluate **later**, only if resource metadata and auth mapping can be represented without duplicate sources of truth | DEFER |
| Database | PostgreSQL + Spring JDBC + Flyway + Testcontainers | Business transaction logic stays user-owned; migration is reviewed, not inferred from HTTP schema | SUBSEQUENT SLICE |
| Test/contract checks | Python unit tests; Maven/JUnit; Vitest/Playwright; OpenAPI lint/diff; Schemathesis candidate | Run real builds/API tests; no passing-by-snapshot alone | PHASED |
| Alternative Java server | OpenAPI Generator (Spring server) with delegate extension | Replace target only if feature parity, safe regeneration and complexity are no worse | REPLACEABILITY SPIKE |

Orval, RJSF, React Admin, Refine and OpenAPI Generator are **candidate integrations**, not claims of verified current-version compatibility, licensing suitability or functional integration. Deep research must validate releases, upstream maintenance, licenses, Boot 4/Jackson support, and CLI reproducibility before accepting the ADR. Exact versions belong in lockfiles and a reviewed toolchain manifest once chosen; never invent a version here.

### End-to-end boundary (proposed)

    [User/agent intent] --untrusted--> [ProtocolIA validated contract v0.2 / next version]
                                              |
                                  [Canonical IR + semantic policy]
                                              |
                                [OpenAPI 3.1 + JSON Schema]
                                       /                 \
                         [Java target adapter]       [Orval adapter]
                               |                            |
                       [Generated MVC, DTO,          [Generated TS client,
                         validation, security]        types, query hooks]
                               |                            |
                       [USER-OWNED service]         [USER-OWNED React screens]
                               |                            |
                       [Postgres + JDBC]            [TanStack Query cache]
                                       \                 /
                                       [Real HTTP API]
                                              |
                                [Independent contract/E2E checks]

Generated code and manifests live in dedicated output paths; services, migrations, screens, styling and domain tests are never generator-owned. The compiler does not execute untrusted JavaScript/SQL from contracts. The IR expresses **declared** effects; enforcement belongs to server-side Security/handlers and DB constraints/transactions.

### Contract and OpenAPI parity requirements

1. Define operationId, success status and **documented error schema** for each supported operation. Existing Java convention maps POST to 201, GET/PATCH to 200; provide explicit statuses only through a validated/versioned contract extension if implemented. Do not change historical v0.1 semantics implicitly.
2. Make securitySchemes reflect the **actual configured deployment profile**. Near-term dev target is HTTP Basic; its OpenAPI must describe Basic. Longer-term bearer/OIDC requires a separately working server adapter and explicit opt-in, not relabeling Basic as Bearer.
3. Keep capability as x-protocolia-capability and effects as x-protocolia-effects in OpenAPI. These are metadata, **not** automatic standard OpenAPI scope enforcement. No client-side authority.
4. Validate request/response schema parity (closed objects, bounded constraints and path bindings). A generated consumer may not assume unsupported optional/nullable/enum fields work in Java.
5. Generate a typed client against the **exact OpenAPI emitted for that running API**. Regenerated client must compile and interoperate at real HTTP level, with 401/403/4xx decoded predictably.
6. For UI resources, choose an explicitly validated mapping between resource, list/get/create/update operationId, label fields, field order and query invalidation. Initially keep this in a versioned sidecar; later move into validated x-protocolia-ui extensions only if requirements justify a contract version change.
7. Effects alone cannot identify client cache keys; invalidation rules must be explicit or deterministically mapped to declared resources with tested behavior.

### Future listing/pagination profile (not implemented)

The v0.2 contract currently has path params but no general query parameter grammar or response-array shortcuts accepted by the Java generator. A scalable Books list needs an explicit response envelope such as BooksPage(items: Book[], nextCursor: string?) or an equivalent supported representation, and bounded query params, with nullability semantics decided before implementation. **Do not put an unsupported optional field in v0.2 and claim it works.** The first slice may start with a finite test dataset and a required BookList.items array, but cannot advertise scalable pagination until query support exists. Paging/filtering belongs to API design and user-owned service/DB query semantics, not automatically derived SQL.

### Persistence and security

PostgreSQL tables/indexes/transactions are a separate explicit design. A stock adjustment must be atomic under concurrency, with overflow prevented and repeat-key semantics specified if retries are supported. Migrations are reviewed and run against disposable DBs before any production DDL; Flyway must not auto-modify unknown environments. Use server-enforced capability checks and tests for anonymous/read-only/writer paths. Environment Basic credentials remain demo-only; production identity, TLS, token lifecycle and CSRF/session strategy require a separate ADR.

## Alternatives considered; decision gates

- **OpenAPI Generator Spring server:** strong baseline, but could duplicate or replace the existing controller templates. Execute a controlled spike with the *same* OpenAPI, same handler interface, Boot 4/Jackson compatibility and Maven/HTTP tests; prefer the alternative only if it passes equal gates with less owned code and no regeneration/security regression.
- **openapi-typescript + openapi-fetch:** smaller, composable alternative to Orval, especially if Orval output conflicts with desired cache/runtime policy. Prefer it if the client/hook generator proves unmaintainable or semantically unreliable; cache hooks would then be explicitly maintained or generated separately.
- **Hey API / Kubb / RTK Query Codegen:** verify current support/maintenance and compare their codegen output in research; do not stack multiple clients in the application.
- **React Admin / Refine / JHipster / Hilla / Appsmith / Budibase / Directus / Hasura and related frameworks:** potentially useful for admin portals or model/database-driven products, but adoption now would import extra schema/authorization/runtime assumptions before the ProtocolIA-to-OpenAPI seam is trustworthy. Evaluate after a functioning minimal slice; do not promise no-code domain UX or SQL from an HTTP contract.
- **TypeSpec as canonical IDL:** reconsider only if ProtocolIA contract versioning/type semantics become significantly harder than interoperating with TypeSpec. No dual canonical model at launch.

## Architecture decision acceptance and reversal

The ADR becomes ACCEPTED only after the ongoing source-based research records compatible, maintained, license-suitable choices **and** the first bounded spike proves actual generation, TypeScript compilation and HTTP interoperability without unsafe edits. At that point write exact tool versions/configuration to the repo. If Orval fails, use the minimal openapi-typescript + openapi-fetch route. If Spring OpenAPI Generator fails, preserve the current Java adapter and document the failed spike. If schema-driven forms do not preserve domain UX, keep user-owned React forms and test them.

Do not count the frozen P4 benchmark as evidence for this ADR and do not merge experimental artifacts into the product build.
