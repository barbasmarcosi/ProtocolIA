# G5 — v0.4 contract evolution and full-stack regeneration

**Status: VERIFIED bounded v0.4 compilation + disposable PostgreSQL persistence pilot; full G5 regeneration remains OPEN.**
**Date:** 2026-10-12 America/Argentina/Salta (2026-10-13 UTC).

## Source/evidence provenance

- Branched from main `64937baaa6b34951de881c136432354070fa8b00`.
- Last freshly tested executable code/test SHA: `3605ebc42371bd52347fc826ea38ebd1e7bf217b`.
- Render Free service `srv-db6oqbgu01pc73avte1g`, build/deploy `dep-db6osn7f3r2c73buel30`.
- Build executed with actual Java 21/Spring Boot 4.1.1, PostgreSQL 16.10,
  Flyway V1 + reviewed additive V2 and Orval 8.41.0. G5 JWT and historical
  P4 sources remain untouched.

## Implemented and observed

1. **Versioned semantics:** new v0.4 allows only `required:false,
   nullable:true` primitive scalars. Omission and JSON null map to Java null,
   deliberately not distinguished by the current adapter. Required-nullable,
   optional-nonnullable and optional arrays/references fail closed.
2. **Derived wire projections:** canonical v0.4 IR, OpenAPI 3.1,
   JSON Schema 2020-12, TypeScript, Java typed model and resource/UI metadata.
   Old v0.1/v0.2/v0.3 compiler behavior stays on its unchanged path.
3. **Books evolution fixture:** `publishedAt` optional RFC3339 datetime
   added to BookRequest/Book; fields in metadata-owned create/detail/list.
   No changes to the existing G1–G5 baseline Books contract.
4. **Provider-free Python tests:** 5/5 PASS; missing/null/valid/invalid
   timestamp checks, conservative additive compatibility, unsupported grammar
   negatives, historical v0.3 compiler parity.
5. **Deterministic outputs:** `G5_V04_BUNDLE_IDEMPOTENT` (nine artifacts
   emitted twice with no byte diff) and
   `G5_V04_UPSTREAM_JAVA_IDEMPOTENT` (two distinct pinned Java source trees
   byte-identical).
6. **Frontend compile:** Orval generation twice, stable generated files,
   capability/operation checks, TypeScript typecheck and Vite build all PASS:
   `G5_V04_ORVAL_RJSF_BUILD_PASS`. This is **not** a browser E2E test.
7. **Real PostgreSQL acceptance:** Flyway v1 and v2 applied freshly;
   `mvn -B -ntp clean verify` **10 tests, 0 failures, 0 errors, 0 skipped,
   BUILD SUCCESS**. Three new real HTTP/JDBC tests cover:
   - valid `publishedAt` sent via HTTP 201 and read back from PostgreSQL;
   - date survives PATCH stock 2→9, GET and paginated list;
   - omitted and explicit JSON null fields accepted;
   - malformed timestamp returns 400;
   - existing schema still accepts legacy rows.
8. **Cross-process persistence:** `restart_check.py` started two independent
   executable Spring JVMs against the *same* disposable PostgreSQL instance.
   Observed `G5_V04_PRE_RESTART_WITH_PUBLISHED_AT_PASS`,
   `G5_V04_PUBLISHED_AT_SURVIVES_TWO_JVM_PROCESSES_PASS`, and
   `G5_V04_DURABLE_ROWS=9`. No public writable DB/API was deployed.

## Observed failed attempts (not hidden)

The initial `dep-db6oqc0u01pc73avtfa0` build FAILED at the Python
sidecar-version test: a too-broad version match treated sidecar 0.3 as 0.2.
It was corrected in `bdf1c3e0e7617aff06f364822d4837387bc8f188`.
The follow-up `dep-db6oqqnf3r2c73bu7or0` confirmed the Python,
backend Java compilation and frontend toolchain, but explicitly skipped
Java tests. Only the third deploy (source above) executed the real DB/HTTP
JUnit suite and two-JVM restart.

## Remaining gates (NOT completed)

- Real Playwright browser E2E **of v0.4 with PostgreSQL**; compile is
  insufficient to prove the `publishedAt` widget/submission is usable.
- One explicit safe `protocolia regenerate-fullstack` pipeline that stages
  OpenAPI Generator, Orval, manifests and schema forms; validates owned-path
  hashes; forbids all handwritten changes; rejects partial failure before
  promoting generated trees.
- Same-version breaking fixture coverage, an independently reproduced
  second resource, fuller nullable/optional/enum/array grammar conformance.
- Integration of genuine JWT/OIDC with migrated DB; G4 remains an isolated
  verified JWT test profile, NOT production identity.
- Managed **nonproduction** PostgreSQL data durability, real backup/restore,
  migrations against existing volumes, operational recovery, secret rotation.
- P4 preregistered economic superiority or token savings is entirely
  **unproved** and its frozen candidate artifacts are unchanged.

**Decision:** keep PR #49 Draft; do not merge or advertise G5 as 100%.
This evidence supports a narrowly scoped v0.4 vertical, not arbitrary
automatic SQL/permissions/business behavior.
