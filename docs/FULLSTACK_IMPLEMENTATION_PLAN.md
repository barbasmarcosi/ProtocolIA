# Full-stack implementation plan G0–G5 — ProtocolIA

**Status:** G0–G5 VERIFIED for the **bounded nonproduction full-stack Books pilot**, including scoped G4 JWT+DB integration, v0.4 field/operation evolution, regeneration, browser, persistence and independent Widgets codegen. **Not production-ready.**  
**Revised:** 2026-10-13. Source: [user-provided deep research and alignment notes](FULLSTACK_RESEARCH_ALIGNMENT_20261012.md).  
**Contract:** [requirements](PRODUCT_REQUIREMENTS_FULLSTACK.md). **Architecture:** [ADR-003](ADR-003-FULLSTACK-COMPOSITION.md). See [G5 verified pilot closeout](G5_CONTRACT_EVOLUTION_PROGRESS.md).  
**Supersedes:** the old full-stack sequence in this document; existing Stage 1–4 product evidence remains historical fact.

## Invariants and workflow

One Books vertical, no general-purpose app generator. Every implementation gate goes into a narrow reversible feature branch, with commit/command/toolchain version, exact fixture, negative tests, build status and observed errors recorded. Never edit frozen P4 candidates or invoke paid model APIs. Do not require GitHub Actions minutes when quota is unavailable: use equivalent local/container runs and state honestly what was not tested. Do not present "written" as "verified."

Order is a dependency DAG, not six independent deliverables:

    G0 Contract/IR/compatibility
        -> G1 Backend replacement spike and real runtime
        -> G2 Typed client: Orval vs Kubb
        -> G3 RJSF UI and resource manifest
        -> G4 JWT/capability + property-based/API/browser security checks
        -> G5 Stable regeneration, contract evolution, persistence and pilot

**Auth starts in G1** (existing Basic allow/deny); G4 upgrades to real OAuth2/OIDC and full enforcement tests. Keep G1 demo Basic separate from an OIDC deployment profile. Domain test coverage continues at every gate.

## G0 — Canonical contract, IR, parity and compatibility [P0, prerequisite]

**Inputs:** actual stock-change Books v0.2 fixture and Spring target behavior.
**Likely paths:** src/protocolia/core.py, src/protocolia/v02.py, src/protocolia/java_spring.py, src/protocolia/compatibility.py, tests/test_v02.py, tests/test_java_spring.py; new fixtures/openapi31/ and docs/toolchain.

**Tasks:** fix emitted authentication (Basic vs current bearerAuth) and documented successful responses (POST 201, GET/PATCH 200) and error schemas through explicit versioned/target profile; preserve v0.1 golden output. Define minimal typed IR extensions for resources, operation roles, views, business capabilities and effects, supported query arguments, and resource IDs without silently expanding current v0.2 grammar. Emit deterministic OpenAPI 3.1 + JSON Schema 2020-12 + ui-manifest.json, capability-manifest.json, generation-manifest.json. Add targeted fixtures for path/query params, arrays, required-vs-optional, nullable, enums, oneOf/anyOf/allOf, nested references, security, errors and vendor extensions, with intentionally unsupported cases **failing closed** instead of pretending Java support.

**Tools from study (pin after license/upstream verification):** Spectral 6.17.0 to lint emitted OpenAPI, oasdiff 1.11.7 to compare old/new specs, and ProtocolIA's own semantic capability/effect diff. No new user-editable OpenAPI file.

**Acceptance:** two compilations under pinned toolchain produce byte-identical owned output (diff zero); hostile/unsupported contract rejected without writes; real Java21/Boot4 HTTP tests prove schema + security + actual 200/201/400/401/403/404/409/501 behavior; Spectral pass; oasdiff catches prepared HTTP breaking fixtures; ProtocolIA diff catches capability/effect changes even if HTTP schema is stable. No unimplemented response counted as domain success. Generated Basic spec does not claim bearer. Existing regressions remain green.

**No-go / fallback:** if a credible parity projection cannot be produced without breaking historic grammar or hashes, isolate a versioned target profile and block downstream codegen. No silent rewrite of v0.1 compiler semantics.

## G1 — OpenAPI Generator as real Spring API boundary [P0, prerequisite]

**Candidate versions from study:** Java 21, Spring Boot 4.1.1, OpenAPI Generator 7.26.0, flags delegatePattern=true, useSpringBoot4=true, useJackson3=true (reconfirm upstream support/licensing).
**Paths:** experiments/openapi-generator-spring/ for initial spike; later examples/books-backend/ with user-owned pom.xml, src/main/java application/domain/security/delegate and target/generated-sources/openapi/.

**Tasks:** from exactly the G0 OpenAPI, generate *only* API interfaces/controllers/models/delegate boilerplate, using pinned CLI/config. Never make OpenAPI Generator owner of root POM or business code. Map actual user-written Book create/get/list/adjust handler and existing atomic stock logic to real generated delegates, without handwritten shadow HTTP controller. Add operationId -> delegate completeness report and fail if any operation only returns 501.

**Acceptance:** Java21 Maven clean verify, authenticated/anonymous/read-only write checks; actual HTTP request and response shape/code parity, strict unknown-field 400, ISBN missing/duplicate 404/409, stock overflow 409 and 8 parallel stock increments exact total; all required operationIds served by real delegates, no false 501 success. Regenerate twice -> same output; modified user-owned domain code byte-for-byte intact; no file ownership collision. Compare build/test/maintenance surface against the working ProtocolIA generator honestly.

**Decision:** promote upstream generator only if non-regressing and easier to maintain. **Fallback:** keep existing ProtocolIA java-spring/0.4, report failed hypotheses and continue other gates using its truthful OpenAPI. No endless generator customization.

**G1 observed 2026-10-12:** bounded v0.3 Books experiment **VERIFIED** with OpenAPI Generator 7.26.0, Java 21 / Spring Boot 4.1.1, 7/7 JUnit incl 5 real HTTP tests, deterministic regeneration, manifest/auth parity and Render Free LIVE. **Default promotion intentionally HELD**: user-maintained integration code increased and broader corpus/ROI remains unproven. See [G1 evidence](G1_OPENAPI_GENERATOR_EVIDENCE.md).

## G2 — Generated client + typed query/hooks [P1, prerequisite for UI]

**Implemented G2:** Orval **8.41.0 SELECTED** (sole generator dependency for `examples/books-web`). Kubb was tested as an isolated alternative using *published independent package releases*: CLI 5.8.0; plugin-ts 5.0.6, plugin-fetch 5.5.7, plugin-react-query 5.2.1. Original uniform Kubb 5.5.5 was not installable. See [G2 evidence](G2_TYPESCRIPT_CLIENT_EVIDENCE.md).
**Paths:** adapters/client/orval/ and experiments/kubb-spike/ as temporary candidates; examples/books-web/ Vite+React+TS with pinned package manager lock; src/generated/api and src/api/http.ts user-owned.

**Tasks:** test both candidates on identical G0 OpenAPI 3.1 corpus: four Book endpoints plus mixed valid/invalid payloads, arrays/refs/errors/capability extensions. Verify auth transport, typed error handling, URL params, React/TanStack Query hooks, query-key stability, invalidation and diff amplification from a small compatible change. Generate one client after a documented decision.

**Acceptance:** clean package install, TypeScript typecheck zero errors, tests call *real* Spring API for list/get/create/adjust (no mock-only acceptance); 400/401/403/404/409 handled predictably, create and adjust invalidate list/detail; generated code deletable/recreated, handwritten HTTP adapter untouched; select ONE generator with published reason.

**Fallback:** openapi-typescript + openapi-fetch and user-owned TanStack Query glue if Orval and Kubb both fail the supported corpus. RTK Query Codegen only for a separate application already on Redux.

**Observed G2 acceptance (2026-10-12):** both candidates generate/typecheck on the same v0.3 OpenAPI; Orval-only `examples/books-web` builds with pinned `package-lock.json` and `npm ci`, preserves user-owned HTTP/cache files after regen, checks capability and invalidation manifests, and passes a real loopback G1 Java 21/Spring Boot 4.1.1 API test for paging, 201/400/401/403/404/409 and 8 parallel increments. **Not completed in G2:** full React/Vite browser UI (G3), comprehensive OpenAPI evolution/diff amplification, runtime equivalence of Kubb and Orval, or production identity/persistence. Exact evidence and source SHA in [G2 report](G2_TYPESCRIPT_CLIENT_EVIDENCE.md).

## G3 — Schema-driven Books UI and explicit resource manifest [P1]

**Candidates:** RJSF 6.7.1 and tested JSON Schema Draft 2020-12 validator; React/Vite/TanStack Query. Refine Core and API Platform Admin deferred optional PoCs, not core dependencies.
**Paths:** examples/books-web/src/features/books/, src/protocolia-ui/, src/generated/schemas/; a versioned resource/UI manifest schema in ProtocolIA.

**Tasks:** render a Books list and detail from declared resource identity, operation roles and field order; generate Create form from BookRequest JSON Schema with required/blank/numeric validation; render "Adjust stock" action from StockAdjustment schema; choose labels and display fields explicitly. UI owns layout/widgets/styles but not HTTP types. Preserve custom components. Report loading/empty/error/permission states, and refresh cache after successful mutations.

**Acceptance:** real browser E2E (Playwright or equivalent) against the G1 running app; create a book, list/detail it, adjust stock and observe list/detail refresh; invalid form and server-side invalid payload both blocked, 401/403 correctly presented; form schema consistent with server; UI generated standard fields without per-field handwritten plumbing. UI metadata cannot grant server capabilities.

**No-go:** relying on Refine Inferencer sample-data heuristics as contract compiler, mock-only screenshots, stale stock, automatic SQL/auth inferred from form or unbounded list falsely described as paginated. If RJSF cannot implement the needed UX securely, retain manually owned form and document why.

**G3 acceptance observation — 2026-10-12:** Bounded Books UI **VERIFIED**
at source `eeff8a628ca9a3487ef6a9b50b9797425c4a4f96` with generated Orval hooks, RJSF 6.7.1/AJV2020
simple BookRequest and StockAdjustment JSON Schema, ui-manifest-driven
list/detail fields, strict TS/Vite, **3/3 real Chromium Playwright tests**
against isolated Spring Boot 4.1.1, Render Free LIVE and independently
verified public /health. See [G3 evidence](G3_BOOKS_UI_EVIDENCE.md).
This does **not** close generic 2020-12, production auth or DB gates.

## G4 — Trusted capability mapping, OAuth2/OIDC and full API tests [P1]

**Candidates:** Spring Security 7.1.x Resource Server, Schemathesis 4.30.1.
**Paths:** backend user-owned security config and capability evaluator, manifest mapping in deployment config, explicit negative HTTP/JUnit suites and disposable Schemathesis runner.

**Tasks:** keep protocol capability names separate from OAuth scopes. Validate real JWT signature, iss, aud, expiry and missing/forged tokens; implement trusted mapping (role/scope/claims -> capabilities), review @PreAuthorize enforcement with generated delegate boundary. For EVERY protected operation write positive+negative tests; ensure Basic demo profile cannot be confused with bearer production target. Run Schemathesis with bounded traffic against isolated test server; retain explicit concurrency/business invariant tests. No live production DB/write tests.

**Acceptance:** every declared capability has allow/deny coverage; missing or tampered JWT rejected; no UI-only enforcement; generated server cannot silently lose authorization on regen; test positive, negative, malformed and 4xx/error behaviors; Schemathesis produces reproducible result and passes supported contract (any discovered defect fixed or explicitly blocked). No default 501 for implemented operations.

**Fallback:** do not claim deployed OIDC support. Keep demonstrably safe local/dev Basic only, label pilot blocked from public production.


**G4 bounded pilot evidence (2026-10-12):** a separate JWT/Bearer profile
for the Books v0.3 contract builds under Java21/Boot4.1.1 and passes
**7/7 JUnit real JWT/HTTP/method-gate tests**. A bounded provider-free
Schemathesis 4.30.1 GET-only run reported **2,263 generated cases over 3
operations PASS**, with exact-head verification PASS as recorded in
[G4 evidence](G4_JWT_SCHEMATHESIS_EVIDENCE.md). This is an isolated,
health-marker-only deployment, **not production OIDC, not mutating fuzz
coverage, and not a security audit**. G4 remains open for real-issuer rollout.

## G5 — Reproducible regeneration, evolution and completed pilot [P2]

**Paths:** adapters/toolchain manifest, generated-owned paths, fixtures/contract-evolution/, examples/books-backend/ user-owned migrations, Testcontainers E2E, docs/EXECUTION_STATE.md.

**Tasks:** staged regeneration into disposable trees -> contract lint/diff -> backend and frontend generation -> format -> Java compile/HTTP tests -> TS typecheck/browser tests -> Schemathesis -> idempotence and output ownership check -> replace generated trees only after passes. Exercise at least one added field and operation; publishedAt optional is a target *only after* optional/null wire model compatibility is implemented. Track contract change propagation to Java DTO, client hook/type, form schema/field, UI manifest and tests with zero manual-file edits. Review PostgreSQL/Flyway migrations and exercise persistence/restarts/concurrent updates in disposable DB if persistent pilot is in scope. CI uses pinned actions locally/free first; Render deploy only after equivalent green checks.

**Acceptance:** fresh clone can generate real working backend + client + UI; 100% pilot required operations actually implemented; 0 default 501; 0 unauthorized writes; 0 changed user-owned files after regenerate; two successive generations zero diff; all intentional breaking fixtures flagged; HTTP/browser/authorization/DB tests green at the **exact SHA**; evidence includes versions, input hashes, commands, observed run IDs, failures and build costs where measured. Second small resource reuses machinery before claiming generic multi-resource support.

**Fallback/no-go:** if regeneration is unstable or a generator upgrade changes semantics, pin last good tools and leave pilot incomplete. If DB or OIDC gates fail, report partial demo instead of a production-ready full-stack product. Frozen P4 untouched.

### G5 final supported-pilot closeout — 2026-10-13

The earlier isolated v0.3 PostgreSQL 16/Flyway pilot remains historical
evidence; PR #49 adds **one integrated, regenerated v0.4 Books slice** with
real PostgreSQL, signed-JWT authentication, Orval, React/RJSF and browser
verification. **Accepted** at executable source `941e9a8c33e0900a8867c362a774b6ff2c8f24d5` and
Render Free deployment `dep-db6pgquk1f9s73b1f3rg` (LIVE). Regeneration stages Java,
Orval, JSON Schema, UI/capability manifests into an owned tree; two full
runs are byte-stable and negative ownership/compatibility tests pass.
`publishedAt` and new PATCH `renameBook` flow through the contract to
the real application, its tests and user-owned persistence. The independent
Widgets resource is generated with the same engine. Historical G3 v0.3
frontend is separately rebuilt. Results: **221 Python tests (1 skipped)**,
**11/11 JDBC/Basic JUnit**, **8/8 signed JWT+PostgreSQL JUnit** and
**5/5 Chromium Playwright**. Details, limitations, repairs and exact commands
are in the [G5 closeout evidence](G5_CONTRACT_EVOLUTION_PROGRESS.md).

**G5 accepted for the supported nonproduction pilot, not for arbitrary
generated software nor production operations.** Durable managed deployments,
external IdP, backup/restore, P4 measured superiority, P5 independent adoption
and P6 stable v1 remain separate follow-on gates.

## Measurement and product decision

Measure contract-to-green time, manual source touched/added (exclude generated files), repair count, drift of generated output, diff amplification, successful operation coverage, security failures, human intervention, and actual runtime/tool cost if known. Deep research suggests *targets* such as 30% faster pipeline, 40% less manual plumbing, 80% automatically represented CRUD fields, and 100% operation/security coverage. **Those are proposed targets, NOT observed improvements or promises.** Favor real use, evidence and honest negative results over a large new benchmark framework.

**Definition of DONE:** truthful source contract -> generated OpenAPI/JSON Schema/manifests -> actual Spring generated API with user-owned domain -> ONE typed TS client + hooks -> working RJSF Books UI -> independently tested auth/invariants -> reversible/idempotent regeneration. Persistence/production auth are DONE only when their individual G4/G5 gates pass.
