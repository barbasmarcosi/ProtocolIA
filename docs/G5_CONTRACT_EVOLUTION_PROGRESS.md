# ProtocolIA G5 — bounded full-stack pilot closeout

**Decision:** VERIFIED / ACCEPTED **for the versioned Books v0.4 pilot**.
**Date:** 2026-10-13 UTC (2026-10-12 Argentina).
**Not** a production launch, a general application generator, an approved
external OIDC integration, or economic superiority evidence.

## Executable evidence at a fixed source revision

- Source tested: `941e9a8c33e0900a8867c362a774b6ff2c8f24d5` on
  `feature/g5-contract-evolution-regeneration`, based on original main
  `64937baaa6b34951de881c136432354070fa8b00`.
- Render service: `srv-db6oqbgu01pc73avte1g` (Free),
  deploy `dep-db6pgquk1f9s73b1f3rg`, status **LIVE**.
- Dockerfile: `experiments/g5-contract-evolution/Dockerfile`. All tests
  occur in disposable build stages; the published image has only a public
  health marker and **no writable public Books API or PostgreSQL**.
- Tool versions: Python 3.13 for verifier, Java 21, Spring Boot 4.1.1,
  OpenAPI Generator CLI 7.26.0 (version checked at CLI runtime), Orval 8.41.0,
  TypeScript 5.9.3, React 19.2, RJSF 6.7.1, Chromium Playwright 1.56.1,
  PostgreSQL 16.10 (Java/JWT test image; browser's Ubuntu package 16.15),
  Flyway V1 and V2.
- Host-side CI: GitHub Actions minutes unused. Paid AI APIs unused.

## Verified gate evidence

| Requirement | Observed result |
| --- | --- |
| v0.4 canonical IR & contracts | Optional+nullable **primitive scalars** supported. Missing/null both map to Java null; unsupported combinations rejected. v0.1–v0.3 compiler behavior unchanged |
| Real field evolution | `publishedAt` propagated to OpenAPI 3.1, JSON Schema 2020-12, TypeScript, Java DTO, RJSF create/detail/list, JDBC, Flyway V2, PostgreSQL queries |
| Real operation evolution | `renameBook` PATCH with `TitleChange` model, explicit `catalog.write`, Spring generated delegate, user-owned JDBC implementation, Orval mutation/cache invalidation, RJSF action, real HTTP/JWT/browser checks |
| Versioned frontend compatibility | Historical `examples/books-web` v0.3 compiled with its own v0.3 contract and Orval; v0.4 isolated in `examples/books-web-v04` |
| Generator reproducibility | Contract bundle generated twice with identical bytes; OpenAPI Generator Java generated twice identical; Orval twice identical; fullstack CLI executed twice with owned generated root |
| Safe regeneration | `regenerate-fullstack` stages into fresh temporary managed tree; hash ownership and symlink guards; preserves handwritten code; rejects changed permissions/roles, breaking field/operation changes, conflicting files, generator failures; unit tests cover additive new operation/view, added nullable fields, tampering and refusal |
| Python regression | **221 tests executed, 0 failures, 0 errors, 1 skipped**. Includes historical P0–P4 and 7 fullstack ownership tests, v0.4 and second-resource cases |
| Real PostgreSQL / Basic HTTP | **11/11 JUnit**, zero failures/errors/skips. Flyway V1+V2; 201/200/400/403/404/409 cases, atomic stock, SQL rollback, nullable date and renamed title |
| Cross-JVM durability | Two independently started JVM processes using same disposable PostgreSQL persisted `publishedAt` and stock adjustments. `G5_V04_PUBLISHED_AT_SURVIVES_TWO_JVM_PROCESSES_PASS` |
| JWT + DB combined | **8/8 JUnit**, zero failures/errors/skips, signed RS256 JWT and local ephemeral JWKS, issuer/audience/expiry, server-side scope→capability mapping and method-level guards against unauthorized writes; real PostgreSQL `publishedAt` and title mutation |
| Real React/HTTP/DB browser | **5/5 Chromium Playwright**, original G3 baseline then v0.4: schema form, nullable field, title rename, actual PostgreSQL stock/GET, reader write denial and mobile |
| Second resource | Independent `Widgets` v0.4 contract, resources/views, HTTP projection, Java and Orval generation with same fullstack CLI; negative resource binding + optional field append tests |

The final image cannot be built unless the required stage marker artifacts
are present; its deployed `/health` is deliberately **not** evidence that a
database is publicly persistent.

## Exact scope and honesty boundaries

1. This gate verifies the **bounded Books full-stack pipeline and a second
   independent resource's code generation**. Widgets does not yet have a
   hand-written runnable business implementation.
2. `regenerate-fullstack` owns **only a dedicated output root** with Java API
   sources, Orval client sources, schemas and manifests. The rest of the
   application, including delegates, persistence, SQL, login and UI components,
   remains hand-written and is compiled/verified by the outer Docker
   integration suite, **not** by the CLI itself.
3. The managed-root swap verifies hashes and stages before promoting, with
   normal filesystem error recovery; it is **not** an ACID multi-directory
   transaction nor a guarantee against process death mid-rename or
   cross-layer Docker OverlayFS renames. Unsupported replacements fail closed.
4. JWT acceptance uses **local test keys/JWKS**. No trusted third-party
   production OIDC issuer, MFA, durable identities or production token rotation
   was tested. The historical G3 Basic demonstration remains separate.
5. PostgreSQL was real and durable **within the disposable build test and
   across JVM restarts**, but is not a managed deployed volume. Backup/restore,
   cross-deploy longevity and disaster recovery are operations for a later
   production-ready release.
6. The frozen P4 A/B/C economic comparison is unchanged and **has not proved**
   token, cost, productivity or quality advantage over existing approaches.

## Reproducibility

See `examples/books-evolution-v04/README.md` for the runnable
`python -m protocolia regenerate-fullstack` invocation and its exact
ownership guarantees. Java, Node and test dependencies are pinned by the
Dockerfile, Maven POM and npm lock. Target-specific business invariants
are never inferred from URL paths.

## Relevant failed attempts and repairs

- Incorrect 0.3 sidecar branch was fixed after a genuine Python failure.
- Browser suite originally assumed an empty DB: fixture order was made explicit.
- Missing `git` and `jsonschema` in the disposable global regression image
  were installed rather than removing historic tests.
- Docker OverlayFS rejected replacing a managed tree created in an earlier
  image layer; the idempotence check was executed in one layer while the
  runtime continues to fail closed for unsupported renames.
- A new title field was initially selected outside its schema-owned action
  form; the browser check was scoped semantically.
- A second disposable PostgreSQL instance was assigned its own port, after
  startup conflict in an inherited build stage.
- UI v0.4 rename action was moved to a separate frontend rather than
  breaking the v0.3 G3 client.
- All these repair attempts are part of the actual Render deploy history,
  not counted as successes.

**Gate verdict:** G5's **supported, nonproduction pilot** is complete.
P4 experimental measurement, P5 independent consumer, P6 stable release,
general grammar coverage and production service operations remain OPEN.
