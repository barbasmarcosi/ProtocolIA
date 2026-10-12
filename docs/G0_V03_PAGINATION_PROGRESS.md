# G0 — Versioned v0.3 paginated Books vertical

**Status:** VERIFIED BOUNDED SUBSET; G0 as a whole still **IN PROGRESS**.  
**Recorded:** 2026-10-12. **Source:** [full-stack plan](FULLSTACK_IMPLEMENTATION_PLAN.md), [ADR-003](ADR-003-FULLSTACK-COMPOSITION.md), [runnable Books example](../examples/books-paging-v03/README.md).  
**PR:** [#43](https://github.com/barbasmarcosi/ProtocolIA/pull/43). No P4 benchmark changes.

## What was actually implemented

A new strict **v0.3** contract grammar permits only explicitly bounded, optional integer query parameters on GET operations; each declares finite minimum, maximum and default. This does **not** modify the accepted v0.1/v0.2 syntax or previous stock-change fixture.

The Books example adds real `GET /api/books` with `limit` 1..50 (default 25) and `offset` 0..1,000,000 (default 0). Java 21 / Spring Boot 4 binds the parameters into a typed `ContractHandlers.listBooks(Integer limit, Integer offset)` method. The handwritten handler sorts by ISBN and returns `BookPage` with required `items: Book[]`, `limit`, `offset` and `total`. Response page size is at most 50; offset beyond the collection returns an empty page, not a fabricated error.

A versioned resource sidecar `0.2` explicitly connects list/detail/create/restock to derived resource/UI/capability/generation manifests. The target-scoped OpenAPI 3.1 correctly declares Basic demo authentication, 200/201 success codes, and typed query parameters with defaults/ranges. JSON Schema 2020-12 defines `BookPage`; `schemas/contract-v0.3.schema.json` documents the opt-in grammar. Explicit Java validation returns HTTP 400 on out-of-range query values.

## Observed testing — exact provenance

**Last non-documentation/source change:** `74316193b31c3508635e6667672d5b462e09d36b`. This commit **repaired** the initial Java MVC method-validation 500 and malformed JUnit regex, then passed a real Java21/Spring Boot 4.0.2 `mvn -B -ntp clean verify` (**5/5 HTTP/JUnit tests**, no failures, Maven `BUILD SUCCESS`). These tests include GET pagination/defaults/bounds/sort, 400 on invalid arguments, 401 anonymous and 403 viewer write denial, create/get, stock-adjustment concurrency and failures.

**Latest feature commit before evidence-only amendments:** `4f2aab816bb8082c514bc681c9733e6435d34e8c`, introducing *one additional Python query-reference/payload test and README only* after the Java source and Java tests were already verified. Render Free deploy `dep-db6h28d9fdbs73fh8780` for service `srv-db6gu7ff3r2c73c7v990` is **LIVE** at that exact SHA. Its Docker build ran **47/47 Python tests PASS**: 26 prior Java-target/CLI tests, 8 resource-bundle tests, 4 inventory tests and **9 v0.3 tests**. The output was regenerated (13 Java source artifacts, 9 bundle artifacts). **Maven and the previously passing Spectral/oasdiff Docker layers were reused from build cache** because the latest SHA did not change their input sources: this is *not* reported as a fresh execution at the latest SHA.

Independent public `GET https://protocolia-books-paging-v03-20261012.onrender.com/health` returned `{"status":"UP"}`. Earlier non-cached build established **Spectral CLI 6.17.0 PASS** with zero error findings, **oasdiff 1.11.7 PASS** for identical specs, and oasdiff successfully flagged an intentionally deleted GET endpoint as a breaking error (with `-o ERR`). No GitHub Actions minutes or paid APIs used.

**Negative outcome preserved:** first build `180a503fa57f69424670117c4b2df2e32cf8cede` had **two HTTP/JUnit failures**: `limit=0` returned 500 (Spring class-level `@Validated` caused exception mapping) and the test regex failed to match `"total":0`. Both issues were corrected before declaring the slice verified.

## Unfinished and intentionally unsupported

- Contract v0.3 supports only **bounded integer GET query parameters**, not strings, rich filtering/sorting operators, cursor pagination, optional/null JSON models, union schemas or arbitrary API generation. These require dedicated contracts and interoperability fixtures.
- **Unexpected/empty query keys at runtime:** Spring MVC's binding behavior is not yet asserted to reject unrecognized parameters or `limit=`; although the *contract compiler* rejects undeclared query grammar, **do not claim strict runtime rejection** for these cases until a new negative test and boundary filter pass.
- Domain persistence is **in-memory**; no PostgreSQL, cross-request snapshot isolation, durable offsets or production authentication claim.
- The previous v0.1/v0.2 generic OpenAPI remains stable. The truthful Basic/HTTP target projection is still explicitly selected.
- G0 remaining cross-target compatibility: additional OpenAPI 3.1 corpus (optional/null/enum/oneOf/allOf etc.), error-body/header semantics, deeper fail-closed runtime/query fidelity. G1 must compare real **OpenAPI Generator 7.26.0 / Boot 4.1.x** against the current generator using the exact same v0.3 fixture.
- No model-token saving, developer-time saving, or superiority claims; the frozen P4 experiment remains separate.

## Next bounded engineering step

Run G1 in an isolated branch: pin/reconfirm upstream generator release and options; consume the **v0.3 target-specific OpenAPI** and generate only Java API/DTO/delegate plumbing. Attach existing handwritten Books business rules and run the same clean Maven/HTTP/security/pagination suite. Replace ProtocolIA's owned Java generator only on demonstrated parity and safer maintenance; otherwise keep the existing working implementation and document the failed spike.
