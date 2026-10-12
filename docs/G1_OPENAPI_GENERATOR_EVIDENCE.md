# G1 — OpenAPI Generator 7.26.0 Spring Boot 4.1.1 parity evidence

**Status: BOUNDED FUNCTIONAL SPIKE VERIFIED; DEFAULT GENERATOR DECISION HELD.**

The experiment is isolated in [experiments/openapi-generator-spring](../experiments/openapi-generator-spring/README.md). It is **not** a change to the frozen P4 study, the v0.1/v0.2 compiler, or the verified v0.3 stock/pagination baseline.

## What generated, what remained user-owned

**Input** is the target-scoped OpenAPI 3.1 (Basic, 200/201 responses, query defaults and constraints) compiled from `examples/books-paging-v03/contract.json`. Output via upstream OpenAPI Generator CLI **7.26.0**, generator `spring`, flags `delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false`. The two API groups (`BooksApi`, `DefaultApi`) have generated MVC controllers and delegates. Their 5 DTOs and supporting **ApiUtil.java** live in disposable output; no generated root POM, Spring Security config, database code or business rules are imported into user-owned paths.

Manual **Java 21 / Spring Boot 4.1.1** root POM, `Application`, `DemoSecurity`, `BookInventory`, `BooksDelegate`, `HealthDelegate`, configuration, tests and bounded verifier remain hand-maintained. `verify_capabilities.py` compares all five operation method/path/capability tuples against an explicit reviewed HTTP security policy and fails closed on drift; it does **not** infer generic OIDC role mappings. The handwritten store is a concurrent, in-memory demonstration and not durable storage.

## Actual verification

**Last complete Maven/API-tested source SHA:** `7c6111e138a6d4573b89ca497c1b977fa53bac26`; **Render Free service:** `srv-db6hmh3rjlhs73eqq2bg`; deploy `dep-db6hsfvf3r2c73cc41q0` reached **LIVE**. The public endpoint `GET https://protocolia-g1-openapi-generator-spike.onrender.com/health` independently returned `{"status":"UP"}`.

- OpenAPI Generator **7.26.0** fetched through pinned Maven Central artifact, generated actual Books/Default controllers, delegate interfaces, typed Java models and `ApiUtil`.
- **Repeat generation:** two independent output trees had a zero-difference comparison across all generated Java sources (`G1_GENERATED_JAVA_IDEMPOTENT`).
- Manifest-to-source demo HTTP policy check `G1_CAPABILITY_MAPPING_VERIFIED`: **5/5 operations** declared/mapped; no unknown capability.
- `mvn -B -ntp clean verify` (Java 21, Boot 4.1.1): **BUILD SUCCESS**, **5/5 real HTTP tests** (catalog, BookPage pagination, authenticated and anonymous GET/POST/PATCH, reader-write denial, malformed/unrecognized JSON 400, missing 404, duplicate ISBN 409, stock overflow 409 and eight concurrent adjustments), plus **1/1 delegate completeness test**, 0 failures/errors/skips. It is NOT a mocked HTTP test suite.
- Additional user-owned error-dispatch regression is **not yet verified** and must be run before final PR merge.

## Failed attempts, no concealed regressions

1. Initial scaffolding runs were intentionally inspection-only; one failed due a `/bin/sh` glob brace expansion, not a product behavior assertion.
2. First real compile (`09e5f511aafa595322d38dee4e21c453de682a02`) failed: `BooksApiDelegate` and `DefaultApiDelegate` refer to `ApiUtil`; selecting `supportingFiles=false` excluded that required generated class. Fixed by generating **only** `ApiUtil.java`, without surrendering the root POM.
3. Subsequent Maven build (`56815df2f9269b135190e9293eeca5deb91c4437`) compiled but reported **3 failing HTTP tests**: intended 400/409 errors turned into 403 because Spring's internal `DispatcherType.ERROR` request was denied by the demo's `anyRequest().denyAll()`. Fixed by allowing **ERROR dispatcher type only**, while retaining deny-all for ordinary unknown requests.
4. Final functional build at `7c6111e138a6d4573b89ca497c1b977fa53bac26` passed all original HTTP tests and generated Java determinism gates; public health was confirmed after startup.

## Maintenance and rollout decision

Comparable *nonblank user-maintained Java application source*, excluding
generated files and tests: **174 lines** in the G1 experiment (Application 8,
Security 67, Inventory 55, BooksDelegate 35, HealthDelegate 9) versus **78**
in baseline `examples/books-paging-v03/CatalogHandlers.java`. These figures
are **not controlled labor/time comparisons**, because the former explicitly
includes policy and DTO bridge responsibilities previously compiled into
ProtocolIA's Java adapter. No developer-time/token/USD saving has been proven.

**Decision: KEEP both paths; upstream is a VERIFIED OPTIONAL CANDIDATE, not a default replacement.** Real runtime, authority, errors and regeneration parity have been demonstrated for the bounded v0.3 Books fixture. Promotion still requires wider OpenAPI 3.1 fixtures, strict query-field/nullable behavior, repeatable deployment profiles, capability policy generation without redundant manual mapping, and evidence that ongoing integration costs are lower. Do not retire `src/protocolia/java_spring.py` based on this single happy-path-plus-negative vertical.

The next practical step after documenting the result is **G2: Orval versus Kubb** on the same emitted OpenAPI, one chosen typed client and cache invalidation verified against the deployed real Books service.

**Not part of this spike:** JWT/OIDC production security, persistent PostgreSQL, premium generated UI, general SQL synthesis, arbitrary API capabilities, Schemathesis or new P4 model-cost claims.
