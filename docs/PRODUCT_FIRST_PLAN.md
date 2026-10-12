# Product-first plan (ProtocolIA)

**Decision — 2026-10-11:** pause expansion of P4. Preserve its frozen study and
three exploratory artifacts. An HTTP PASS on manually implemented shadow
controllers does not establish value for ProtocolIA.

## Goal

From one typed contract, generate a real Spring Boot API with records, routes,
validation, auth and *one* controller. The developer supplies only business rules
through a typed handler interface. Never invent domain transactions or claim
success from code that returns 501.

## Four steps, no research bureaucracy

1. **Use the output (active):** generate a typed ContractHandlers port, invoke
   it from the generated MVC adapter, and ship a catalog CRUD example. Test
   determinism, non-destructive regeneration, Maven clean verify and real HTTP.
2. **Make it reliable:** address real Spring Boot 4 defects and boundary cases
   exposed by the example (auth, validation, JSON strictness, error status,
   and supported response status). Maintain fail-closed unsupported semantics.
3. **Make it pleasant:** provide one clear generation/run flow; simplify repeated
   manual work only when it causes actual developer friction. Avoid parallel
   handwritten APIs.
4. **Decide whether it is valuable:** compare development and maintenance
   effort against direct code and existing generators with honest, measured
   successful tasks. If no concrete advantage appears, narrow or replace the
   approach rather than build additional benchmark ceremony.

## Exit policy

A stage is complete only with working executable output, tests that genuinely
run, and representative HTTP behavior. Track failures as engineering work and
fix them directly. Keep a single concise status here, rather than generating
multiple master plans. No paid APIs or changes to the frozen P4 protocol.

### Stage 1 state — COMPLETE (2026-10-11)

Generated Java target `java-spring/0.4` now emits typed
`ContractHandlers` and the one generated MVC controller delegates to the
implementer-owned bean. A missing bean preserves HTTP 501. The catalog
example implements domain semantics in one service class, not a second API.
Regeneration preserves custom code and rejects modified generated files.

**Observed evidence on Render Free** (no paid provider API or GitHub Actions):
- Branch code commit `786cc15159be88d79968f263da2f2561eafd3480`.
- Real pipeline: contract validation -> 11 generated files -> 7/7 Python
  generator unit tests -> Java 21, Maven 3.9.11 `clean verify` **BUILD SUCCESS**.
- JUnit/SpringBoot HTTP integration test: **1 run, 0 failures/errors**, covering
  public health, unauthenticated 401, create 201, read 200/404, duplicate 409
  without mutation, negative stock 400, whitespace 400, malformed JSON 400,
  unknown-property JSON 400.
- Executable JAR SHA-256:
  `71a824c40394ee58fb329d891e820c14aaef904a994d662bc896d7cb78957da5`.
- Render service `srv-db5v0tt9fdbs73e7fddg`, deploy
  `dep-db5v28ad0e5s738q8hh0`: **LIVE**. Independently requested
  `https://protocolia-product-catalog-dev.onrender.com/health` ->
  `{"status":"UP"}`.
- First Render attempt had a container-registry metadata stall; a Docker base
  digest pin resolved it. This was infra, not a failed generated application.

**Stage 2 — supported regeneration and access-control hardening (2026-10-11)**

- Contracts may **add or remove models and generated files** across successive
  java-spring/0.4 generations. Preflight verifies the hashes and paths of all
  previously owned files, rejects handwritten collisions, tampered manifests,
  modified generated files and symlinks; stale *owned* files alone are removed.
  Handwritten business services are never managed or deleted.
- The optional demonstration viewer receives only non-public capabilities
  attached to **GET operations with no write effect**. It is unable to create
  catalog records even with valid credentials.
- Real Render evidence (separate disposable **Free** service
  srv-db5v9ovlk1mc73bc45fg): **12/12 Python generator tests PASS**,
  **4/4 inventory-template regression tests PASS** and **1 Java 21/Spring Boot 4
  end-to-end HTTP test PASS**, including a viewer read-200 / write-403 check.
  Maven clean verify **BUILD SUCCESS** without skipping tests. Java artifact
  SHA-256: ec2c9032bb1617f3298228f62458eb23b9519cbfc6b208e0e2ea9177ba2ebca5.
- This is a practical **incremental milestone within Step 2**, not a claim of
  comprehensive Java semantics. Unknown JSON properties/invalid JSON remain
  400 in the sample; POST uses target-level HTTP 201 convention because v0.2
  contracts do not declare per-operation success codes.

Known limits: an **old java-spring/0.3 ownership manifest cannot be silently
upgraded in place**: use a new output directory and consciously migrate custom
code. Multi-file regeneration checks all ownership before writing and updates
the manifest last, but cannot promise an atomic transaction against a sudden
process/filesystem failure. Optional/null and enum model support still fail
closed. Demo Basic authentication is not production identity.

### Stage 3 — one-command Java project initialization (2026-10-11)

The new CLI `protocolia init-java CONTRACT --out DIRECTORY` composes
contract validation, deterministic generated Spring artifacts, protected
regeneration, and **one user-owned starter service** in a single command. The
starter implements the generated typed `ContractHandlers` interface
and explicitly returns 501 for every unimplemented method. There is **no
shadow controller** and no simulated business success.

On repeated initialization ProtocolIA retains modified user code byte-for-byte,
regenerates only owned files, and reports that the developer may need to
update interface methods after a contract change. Unsafe symlinks and custom
path collisions fail before generated output is modified. The CLI prints
next-step compilation instructions and the README includes local startup
instructions without embedding secrets. No model/API provider or scripting
framework is needed.

**Measured completion (free Render, 2026-10-11/12 UTC):** generator Python
tests 12/12, old inventory generator regression tests 4/4, new CLI tests
7/7. Real Java 21/Maven 3.9.11 builds of **two separate applications**
both pass `mvn clean verify` without skipping tests: (1) newly initialized
`StarterHandlers` app's HTTP test checks unauthenticated 401 and
authenticated unimplemented 501, (2) the actual catalog business handler's
integration test exercises working CRUD and viewer read/deny-write. Deployment
`dep-db64002jnfac73cb38og` is **LIVE** in the disposable free Render service
`srv-db63vvijnfac73cb36jg`, with an external `GET /health` returning
`{"status":"UP"}`. The final catalog runnable JAR SHA256 is
`210b8458bd3cc55c1777fdde5a3b2c62734b1c8f2f783d6ab648a3aa8869e588`.
The original P4 task, verifiers, and experimental artifacts were not changed.

Validation: fresh generic CLI scaffold compiles as a real Java 21/Spring Boot 4
service and HTTP-smoke-tests unauthenticated 401/authenticated unimplemented
501; the already implemented catalog application is separately rebuilt and
its real HTTP domain tests run. Unit tests cover CLI invocation, idempotent
regeneration, changed contracts and path safety. These are *product tests*,
not P4 benchmark comparisons.

**Stage 4 next:** on an actual subsequent feature/change request, compare the
time and edited code required with plain Spring Boot and an existing generator.
Keep the comparison deliberately small and measurable; if this workflow adds
no development benefit, rethink the product rather than enlarge the harness.

### Stage 4 — one genuine maintenance task (2026-10-11/12 UTC)

**COMPLETED, narrowly scoped.** Added atomic, authenticated stock restocking
(`PATCH /api/books/{isbn}/stock`) using both ProtocolIA and a separate
direct Spring Boot app. Same HTTP tests passed for both (3/3 JUnit tests,
`mvn clean verify` PASS; 23/23 Python generator regressions PASS).
ProtocolIA required editing **one contract and one custom Java handler**,
adding **20 handwritten Java lines**; direct required editing a controller,
repository and request DTO, adding **30 handwritten feature Java lines**.
Generated route/DTO/validation/auth reduced boilerplate, but contract-edit
effort is not captured by Java LOC. Direct seed required **separate baseline
normalization** of security and incompatible pre-existing tests, excluded
from the feature delta. Its first run masked a 409 overflow error as 403;
fixed that specific direct-app error and verified both again.

**Decision:** modest maintenance-boilerplate reduction, not a measured
developer-speed/cost saving. No matched model sessions or reliable coding
times; no statistical winner. See [short result](../examples/stock-change/RESULTS.md)
and [both code paths](../examples/stock-change/README.md). Keep the scope
small and pursue only usability or contract coverage gaps justified by real
stories. P4 remains frozen/open.

## Full-stack direction — proposed, 2026-10-12

The next proposed product work is documented as [acceptance-oriented requirements](PRODUCT_REQUIREMENTS_FULLSTACK.md), [ADR-003 (full-stack composition, PROPOSED pending deep research)](ADR-003-FULLSTACK-COMPOSITION.md), and [G0–G5 delivery gates](FULLSTACK_IMPLEMENTATION_PLAN.md). Start with OpenAPI/runtime HTTP parity, then prove a real external typed client and working React Books slice before generalizing. This extends the completed Stage 1–4 product engineering evidence; **it does not reopen or alter the frozen P4 study**. The research may revise tool selection, but not silently erase recorded acceptance criteria.

### 2026-10-12 — Deep-research alignment supersedes the original proposed gate order

The [revised ADR-003](ADR-003-FULLSTACK-COMPOSITION.md), [full-stack requirements](PRODUCT_REQUIREMENTS_FULLSTACK.md), [research alignment record](FULLSTACK_RESEARCH_ALIGNMENT_20261012.md) and [revised G0-G5 plan](FULLSTACK_IMPLEMENTATION_PLAN.md) are the **current source of truth for FUTURE full-stack implementation**. The old sequence proposed on 2026-10-12 was explicitly revised: G0 IR/OpenAPI/compatibility → G1 OpenAPI Generator backend parity spike → G2 Orval vs Kubb and ONE TS client → G3 RJSF and UI manifest → G4 trusted OAuth2 capability mapping and Schemathesis → G5 safe regeneration and integrated pilot. The completed Stage 1–4 findings above are historical evidence, not invalidated by changing the future plan. Candidate versions and expected gains come from a supplied study and are **not implementations or successful integration tests**; ADR remains PROPOSED until gates pass. P4 remains untouched.

### G0 implementation begins — verified Java target HTTP profile (2026-10-12)

Initial partial G0 work is [documented with exact tests and Render evidence](G0_HTTP_PARITY_PROGRESS.md).
The optional `compile-http --profile java-spring-basic-demo` projects a
truthful demo Basic/HTTP-status contract **without changing v0.1/v0.2
historical generic compilation**. 26/26 Python Java generator/project tests,
4/4 inventory tests, and both Java Maven builds with 3/3 real HTTP tests each
passed. G0 remains **IN PROGRESS** pending IR/manifests and lint/diff tooling.

### G0 verified semantic manifests and external lint/diff (2026-10-12)

The [G0 resource bundle evidence](G0_RESOURCE_BUNDLE_PROGRESS.md) records
**38/38 Python tests, 6/6 real Java HTTP tests, Spectral + oasdiff PASS**,
with exact free Render deployment and source SHA. Resource/UI/capability/
generation manifests are now produced deterministically from a versioned
sidecar. G0 is not complete: broader OpenAPI 3.1 grammar, list pagination,
error serialization and upstream Java generator parity remain outstanding.

### 2026-10-12 — Bounded v0.3 Books pagination proof (G0 partial)

New [G0 pagination report](G0_V03_PAGINATION_PROGRESS.md) covers real `GET
/api/books?limit=...&offset=...` with typed query parameters, Java server
HTTP 400 validation, stable sorted bounded pages, UI/capability manifests and
one versioned v0.3 contract. **47/47 Python tests** at final source SHA,
**5/5 real HTTP/JUnit tests** at the last Java-code SHA, pinned
Spectral/oasdiff PASS and a Render Free LIVE demo with public `/health`
verification. The last deployment reused unchanged Maven/linter layers
from build cache; the report distinguishes fresh and cached checks. No
claim of production-ready persistence or full G0 completion. G1 remains next.
