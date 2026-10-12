# Stage 4 result — one real stock-maintenance change

**Date:** 2026-10-11/12 (Render logs UTC). **Status:** both approaches functionally PASS. **Scientific/financial outcome:** no measured time or token advantage; no general winner.

## Task and unmodified source starting points

Both implementations added `PATCH /api/books/{isbn}/stock` with integer quantity 1–1000, atomic stock increase, 200 response with unchanged ISBN/title, 400 for bad inputs/extra fields, 401 anonymous, 403 read-only viewer, 404 missing book, 409 overflow, and concurrency (8 × quantity 3 = +24). In-memory persistence only.

- ProtocolIA starting point: product-first working catalog under `examples/catalog-vertical` from `main@b984dab633b1947b41f0b7e037d24a75a53e3bfa`.
- Direct starting point: an **editable copy** of the originally frozen A workspace tree `2c30c61963753ea022bcd4d73bfc9250b8606843` from `46c09bbc06e29775a14ad849e43861d7f459f3a3`; original P4 artifacts untouched.
- Both used **the same stock HTTP test method bodies**, with only Java package names different. Each also ran its own catalog-baseline HTTP test.
- Build pipeline: [`deployment/product-stock-change/Dockerfile`](../../deployment/product-stock-change/Dockerfile), Java 21/Maven 3.9.11, free Render `srv-db64dhbbc2fs73aovu20`, final deploy `dep-db64e8dckfvc73c3h0t0`. No paid APIs or CI minutes.

## Functional findings

| Observation | Contract-driven | Handwritten |
| --- | --- | --- |
| Python generator and existing CLI/inventory regressions | **23/23 PASS** | Not applicable |
| Generated contract artifacts | **12 files** | No generator |
| `mvn clean verify` | **PASS** | **PASS** after targeted fix |
| JUnit tests, with real HTTP | **3/3 PASS** | **3/3 PASS** |
| Missing/invalid/noninteger quantity | 400 | 400 |
| Unauthorized / read-only viewer PATCH | 401 / 403 | 401 / 403 |
| Missing ISBN / overflow | 404 / 409 | 404 / 409 |
| 8 parallel PATCH increments | Final stock 24 | Final stock 24 |
| Business implementation | Handwritten typed service | Handwritten repository |

Generated executable JAR SHA256: `cc1a6b5664e604f8beb8a7cdbfae2226059321ff61818b2840311ffe0ff75d73`. Direct executable JAR SHA256: `75d69ec1356a99998207d0dd2324b6988e1434d19e15f2153ab8cca5c64ca331`.

**One real defect observed:** first direct build, `dep-db64dhjbc2fs73aovuvg`, compiled but failed the overflow test: expected 409, got 403. Its hand-configured security denied the Spring error dispatch. Fixed in the **editable direct copy** with an explicit exception handler for `ResponseStatusException`; no P4 candidate was altered. Final re-run both PASS.

## Marginal manual edits (feature code only)

| Metric | ProtocolIA | Direct Java |
| --- | ---: | ---: |
| Changed implementation artifacts | **2:** contract and custom service | **3:** controller, repository and DTO |
| Java implementation lines *added*, versus each seed | **20** | **30** |
| Contract additions | 1 model, 1 operation | N/A |
| Java route/DTO/validation/security glue for the new endpoint | Generated from contract | Handwritten |

Line deltas were measured using ordered line differences against each original source; tests, generated files, documentation, format churn and build harness excluded. The ProtocolIA side also requires JSON contract editing, which is **not captured by the 20 Java lines**. The direct code's business-domain update is about as involved as the ProtocolIA business method; ProtocolIA's concrete advantage here is avoiding repetitive web adapter/model wiring.

**Separate baseline-parity work — exclude from marginal feature benefit:** the starting direct A project had **no authentication and incompatible Boot 4 tests**. To run equivalent test cases it required a new ~62-line demo security config, one Maven security dependency, a repaired old baseline test, and then ~7 lines of response-status exception handling after the observed bug. Do *not* add these to the feature LOC comparison as if ProtocolIA saved them solely for PATCH.

No stopwatch-level agent coding duration, API/model token counts, matched developer conditions or independent repetitions were captured. Maven log timings come from **sequential warm/cold cache builds**, so they cannot establish implementation time or a causal efficiency effect.

## Product decision

**Keep the scoped Java adapter path, but do not claim a productivity winner.** For this maintenance change, ProtocolIA removed some routine DTO/route/validation/security edits and kept the service focused on domain behavior, while requiring a second contract representation to maintain. The small measured reduction (2 versus 3 source artifacts, 20 versus 30 added Java lines) is *encouraging but weak evidence* for broad return on investment.

Next prioritize **real contract change usability** and unsupported fields/method edge cases only when an actual user story needs them. Avoid expanding P4 or a new benchmark framework to justify a premature performance claim.

These results are **product engineering observations**, not eligible P4 experiment data. Frozen A/B/C and P4 issue #5 remain untouched.
