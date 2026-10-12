# G2 — Generated TypeScript client and TanStack Query integration

**Outcome:** Orval **8.41.0 SELECTED**; Kubb **5.x comparison completed at generation/typecheck level**. The selected Orval client passes real Spring HTTP, cache and deterministic regeneration tests. **No claim of Kubb runtime parity** or measurable productivity savings.  
**Code SHA tested:** `58703e141d5f8d3f3c1749d761883447ee52c25f`.  
**Run:** Render Free service `srv-db6j4o8473hc73dihj00`, deploy `dep-db6jemdg1s2s739ihh1g`. Public runtime status is tracked separately from the build; the independent Java server was verified over loopback in the build.

## Contract lineage and scope

`examples/books-paging-v03/contract.json` is the only editable contract. ProtocolIA `compile-bundle --profile java-spring-basic-demo` emits the same truthful OpenAPI 3.1 consumed by G1. Orval and Kubb received identical generated input; generated clients are **not authored by ProtocolIA**. The OpenAPI models include Books, BookPage arrays, required fields, path ISBN and bounded GET `limit/offset`, Basic demo security, 200/201 success codes and explicitly documented 4xx/501 possible statuses. G0 still does not declare truthful error-body schemas or arbitrary filters; this is not a claim of typed 4xx payloads.

## External generator comparison and decision

| Dimension | Orval (SELECTED) | Kubb (experiment only) |
| --- | --- | --- |
| Installed CLI | `orval@8.41.0` | `kubb@5.8.0` |
| Supporting packages | One Orval generator; TanStack Query runtime | `@kubb/plugin-ts@5.0.6`, `@kubb/plugin-fetch@5.5.7`, `@kubb/plugin-react-query@5.2.1` |
| Same OpenAPI 3.1 input | Generated Books operations, models, hooks and query-key factories | Generated Books operations, types and TanStack hooks |
| TypeScript strict typecheck | **PASS** | **PASS** |
| HTTP against real backend | **PASS** | **Not executed** — cannot claim runtime equivalence |
| Query cache update after mutations | **PASS with user-owned adapter** | **Not executed** |
| Generated output surface | Single Orval API module + model files (8 generated files observed by regen verifier) | Separate types, clients, hooks and .kubb support (22 files observed in initial probe) |
| Decision | Minimal integration for this pilot; runtime behavior demonstrated | Viable alternative for future multi-plugin needs, but unnecessary permanent dependency now |

The original proposal's uniform `Kubb 5.5.5` pin **failed** with npm `ETARGET`: `@kubb/plugin-react-query@5.5.5` did not exist. We used actual published package versions, determined from npm, instead of substituting unverified installs. Orval's first TypeScript integration also failed: generated unions modeled HTTP responses while our fetch adapter returned only the JSON body. Explicit `includeHttpResponseReturnType=false`, `forceSuccessResponse=true`, `includeHttpErrorResponse=false` corrected the contract/transport mismatch, with no `any` casts.

## Permanent architecture

The supported client foundation is [`examples/books-web`](../examples/books-web/README.md). It depends **only on Orval** as generator, React, TypeScript and TanStack Query. The competing Kubb toolchain lives exclusively under [`experiments/g2-client-spike`](../experiments/g2-client-spike/README.md); it is not a permanent application dependency.

- **Generated-owned:** `src/generated/orval` (API functions, hook/query factories, models); always deletable and regenerated.
- **User-owned:** `src/api/http.ts` runtime-configurable fetch transport with injected auth header callback, JSON content negotiation and `ApiHttpError(status,data,url)`; no application credentials in generated code. No 4xx fake success unions.
- **User-owned:** `src/api/cache.ts` Book write wrappers and React hook helpers; successful create/restock invalidates the shared list-key prefix (all paginated variants) plus the corresponding detail key. Failed writes never invalidate a valid entry.
- **Contract check:** `scripts/verify-contract.mjs` asserts list/detail/create/restock resource roles, identity ISBN, both cache invalidation rules, and trusted `catalog.read/catalog.write` capability/method mapping against ProtocolIA resource/capability manifests. This is **not** an authorization engine; Spring remains authoritative.
- **Generated ownership:** `scripts/verify-regeneration.mjs` compiles Orval twice, compares all generated file paths/bytes, asserts manually owned fetch/cache adapters byte-identical.
- **Pinned lockfile:** `examples/books-web/package-lock.json` was generated from actual installed packages (not invented), then committed. Selected-client Docker build uses **`npm ci`**; experimental comparator has its own disposable npm install.

## Observed integration acceptance at code SHA

The Docker build invokes both generators, runs TypeScript strict checks on their output, and then repeats generation/typecheck under the **Orval-only, lockfile-backed** client. A separate Spring Boot 4.1.1 / Java 21 backend is generated and packaged from exactly the G1 source and same OpenAPI. A Node `tsx` test targets its `127.0.0.1` HTTP endpoint: it **refuses to run against any public/remote URL**.

Verified markers from actual build:
- `G2_CANDIDATE_TYPESCRIPT_PASS`: both candidates' generated clients typecheck.
- `G2_CACHE_CAPABILITY_MANIFEST_VERIFIED`: operation and invalidation metadata consistent with user-owned policy.
- `G2_ORVAL_REGEN_DETERMINISTIC_AND_USER_CODE_INTACT 8`: eight Orval generated files stable across two generations, handwritten code unchanged.
- `G2_SELECTED_ORVAL_ONLY_VERIFIED`: supported client contains no generated Kubb subtree and no Kubb runtime dependency.
- `G2_REAL_HTTP_PASS_401_403_404_409_400_201_PAGINATION_CACHE_PARALLEL`: real 401 unauthenticated listing, 403 reader write rejection, 404 missing ISBN, 409 duplicate/overflow, 400 bad query/body, 201 POST; typed list/get/create/restock; QueryClient cache invalidated for both cached pagination variants and selected detail after actual backend mutations; 8 concurrent restocks resulted in stock 24, with failed writes preserving domain state.

**No mocks** are used as acceptance evidence, no paid APIs or GitHub Actions minutes, and P4 remains untouched. The Docker's local test credentials are disposable and do not authorize mutations against the public Render instance.

## Not completed in G2

This proves a **client SDK + hooks**, not a finished React browser UI. G3 must implement list/detail/forms with RJSF and run a real Playwright browser E2E against a safe isolated backend. G4 still owns production OAuth2/OIDC and stronger capability mapping. G0 broad OpenAPI error-body/optional/null and query corpus, and G5 durable DB/testing also remain open.

Relative engineering cost: Orval adapter reduces the need to handwrite fetch, endpoint types and Query hooks. It **does not eliminate** user-owned auth, caching policy, business logic or field-level UI decisions. No measured developer-time or token efficiency advantage has been established.
