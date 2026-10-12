# Full-stack delivery plan — ProtocolIA

**Status:** Proposed executable backlog, pending final source-based integration research.  
**Date:** 2026-10-12.  
**Source docs:** [Requirements](PRODUCT_REQUIREMENTS_FULLSTACK.md), [ADR-003](ADR-003-FULLSTACK-COMPOSITION.md), [product evidence](PRODUCT_FIRST_PLAN.md).

## Execution policy

Build one **Books vertical** before creating a generic multi-resource platform. Every step happens on a narrow branch/PR, with an explicit rollback path. Merge only after the named acceptance checks actually run; record exact commits, commands and pass/fail results in docs/EXECUTION_STATE.md or a short per-slice result. If there are no free build minutes, use a reproducible local Docker/Render Free path and report coverage limits. Do not edit the frozen P4 study/harness or infer model-token savings.

## Gate G0 — fix the seam before adding downstream generators (P0, small)

**Files likely touched:** src/protocolia/core.py, src/protocolia/v02.py, src/protocolia/java_spring.py, tests/test_v02.py, tests/test_java_spring.py, examples/catalog-vertical/contract.json, new contract-parity tests.

Tasks: choose a documented **dev Basic** OpenAPI target profile matching current Java HTTP Basic; align emitted success codes (POST 201; GET/PATCH 200) and stable error response descriptions/schemas with actual handler behavior; preserve v0.1 contract compatibility by using an explicit target/profile option or versioned emission where necessary. Audit Spring error dispatch for 400/401/403/404/409/501. Check unknown JSON fields, empty ISBN/title, path bindings, status and response content.

**Acceptance:** OpenAPI validates; generated target's auth scheme matches the real test server; automated contract-to-HTTP checks demonstrate exact status codes and representative error bodies; Java21 Maven clean verify and existing Python regressions PASS. **No-go:** documenting Bearer against Basic, changing compatibility silently, skipping tests, or claiming a missing handler is working domain logic.

**Rollback:** leave existing Java target unchanged and block frontend codegen until an explicit per-target OpenAPI projection is available.

## Gate G1 — first real external typed client (P0, small)

**Files proposed:** adapters/client/orval/ (pinned config + invocation wrapper), generated/clients/books/ (disposable output), examples/books-web/ (Vite React TS app + package lock), tests/integration/ or examples/books-web/e2e/.

Tasks: check researched Orval version/license, choose one generated fetch client plus TanStack Query hooks, set stable operationIds, auth transport for demo, error decoder and generated/user-owned output separation. Keep one canonical OpenAPI output; don't maintain a second handwritten endpoint typing source.

**Acceptance:** clean node install/build and TypeScript typecheck, real client create/read/adjust HTTP tests, 401 and 403 negative assertions and 400 response behavior, and no generation-time edits to handwritten UI/service files. **No-go:** client silently accepts status/schema mismatch, runtime mock server substituted for HTTP, license/update strategy unresolved.

**Fallback:** openapi-typescript + openapi-fetch, with explicit TanStack Query hooks; do not run two client generators indefinitely.

## Gate G2 — usable Books web slice (P0, medium)

**Files proposed:** examples/books-web/src/pages/Books*, components/BookForm*, src/api/, frontend tests; extend contract in examples/stock-change/protocolia/contract.json or create a dedicated versioned Books full-stack example without changing the frozen stock-change comparison.

Tasks: display list, detail, create and stock adjustment. Show validation, pending, errors, 401/403 and empty states. Add listBooks operation with a supported envelope; limit initial listing semantics explicitly. Define query cache keys and invalidation after successful write. If adding pagination/filters, first make a versioned query-parameter model and test Java/TS parity. Do not fake pagination by silently truncating.

**Acceptance:** Playwright (or equivalent actual browser E2E) connects to running generated Spring API. Create appears in list; direct detail correct; stock change refreshes list and detail; invalid form cannot submit; server validates independently; read-only viewer cannot PATCH through direct HTTP. Test a nontrivial error state. **No-go:** screenshot-only acceptance, fake REST fixtures, stale cached stock or UI-only permission enforcement.

**Fallback:** manually-authored small React forms/screens with reusable generated HTTP client; schema-driven RJSF/JSON Forms spike remains optional.

## Gate G3 — persistent, safe data (P1, medium/large)

**Files proposed:** examples/books-backend/custom/ (user-owned Spring service/repository), src/main/resources/db/migration/ or equivalent separate user-owned migration path, Testcontainers integration tests and deploy config.

Tasks: design Books table, unique ISBN, stock bound/check, idempotency decision, atomic SQL adjustment and 409 overflow behavior. Wire PostgreSQL via JDBC, Flyway reviewed migrations, local compose/Testcontainers setup. Define transactional semantics and isolation; never infer them from CRUD paths. Maintain explicit environment staging and no production DDL by default.

**Acceptance:** full end-to-end after restart; collision/no mutation; transaction rollback; concurrent adjustment exact total; negative/overflow; disposable Postgres migrations from zero; no unrestricted DB credentials. **No-go:** in-memory-only evidence marketed as persistence, SQL generated without review, overwriting a real DB.

**Fallback:** keep the in-memory vertical labeled demo and defer persistence; do not weaken domain guarantees.

## Gate G4 — evaluate replacement of owned Spring plumbing (P1, small spike)

**Files proposed:** experiments/openapi-generator-spring/ (or similar isolated path), docs/ADR-003-FULLSTACK-COMPOSITION.md appendix.

Tasks: pin official OpenAPI Generator release and supported Spring/Java/Jackson options; generate from the exact same G0 OpenAPI; connect a handwritten business delegate without a second controller; test Java21/Boot4 compilation, validation, authorization, statuses, JSON strictness, regenerate without custom-source loss, concurrency against same domain handler. Count and inspect owned customization and update surface, not LOC alone.

**Acceptance:** equal Maven + HTTP/security suites and reproducible generation. Record comparison with current ProtocolIA adapter, version, command, commits, gaps and license. **Decision:** replace only if it yields equal-or-better semantic parity, safer regeneration and lower maintenance. Otherwise retain current adapter and close spike with a documented negative result.

## Gate G5 — generalize carefully, publish a supported profile (P2, medium)

**Files proposed:** versioned resource/UI/query metadata schema, docs/API_PROFILE.md, adapter configs, golden fixtures/compatibility tests, generated/user-owned path policy.

Tasks: only after Books succeeds, extract minimal validated resource-to-operation mapping and explicit cache invalidation. Evaluate RJSF/JSON Forms and one admin framework against actual UI quality. Define project version matrix, software bill of materials/licenses, update policy, compatibility diff and contract-owned metadata migration. Publish a single command that generates backend/client and a working example without requiring unreviewed hooks or silent code overrides.

**Acceptance:** a *second* deliberately chosen resource reuses the same framework without copying endpoint-specific generator internals; regenerated artifacts deterministic; handwritten domain/UI work survives changes; unsupported metadata fails closed; clean fresh-clone setup works. **No-go:** introducing generic DSL/ORM/page builders without a second working consumer.

## Sequencing, research handoff and risks

1. **Start engineering with G0 now.** It is a verified source-level mismatch independent of whether Orval or a different client generator wins the study.
2. Incorporate the ongoing deep research into ADR-003: maintained upstream versions and release dates, licenses, Spring Boot 4 options, Orval vs Hey API/Kubb/openapi-typescript, RJSF/JSON Forms compatibility, admin framework tradeoffs, official source references. Promote PROPOSED to ACCEPTED only after this review and G1 spike.
3. No more than one alternative to an adopted tool in a spike at a time; do not invest in frameworks before a real user story. Keep P4 frozen and separately reported.

**Effort bands are relative, not productivity estimates:** G0 small; G1 small; G2 medium; G3 medium/large; G4 small isolated spike; G5 medium. Highest technical risks: OpenAPI/runtime security/status drift, optional/enum/null mapping, pagination contract expansion, hidden generated-file ownership collisions, authorization inferred on client, migrations/concurrency, and upstream tool version breakage. Each has an explicit gate and fallback above.

## Definition of done for the initiative

A new developer starts from a pinned clean checkout, validates a Books contract, generates/rebuilds a backend and typed web client, runs the application and demonstrates CRUD subset + stock change with correct auth/error semantics; persisted form if G3 is claimed complete. E2E assertions and reversible regeneration are independently repeatable. Anything less is recorded as an incomplete gate, not as a finished application generator.
