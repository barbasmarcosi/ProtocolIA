# G5 — PostgreSQL-backed Books persistence and deterministic Java codegen

**Decision: VERIFIED ISOLATED PERSISTENCE PILOT; FULL G5 REMAINS OPEN.**  
**Date:** 2026-10-12. **Base:** ProtocolIA `main` `2be5080e14e2d5ca3941b11dd4202d8d0b4546fb`.  
**Experiment:** [g5-postgresql-books](../experiments/g5-postgresql-books/README.md). The v0.3 Books source contract, G1 Java baseline, G2/3 UI, G4 JWT and P4 study are unchanged.

## Architecture and ownership

- **Semantic input:** existing `examples/books-paging-v03/contract.json`, explicitly projected to Basic-demo OpenAPI 3.1 by ProtocolIA `compile-bundle`.
- **Generated and disposable:** OpenAPI Generator **7.26.0** Spring Boot 4 MVC controllers, interfaces, delegates, typed Java models and essential `ApiUtil.java`. Generation runs *twice* in distinct trees, with `diff -rq` on the Java sources.
- **Manually owned:** Java 21 / Spring Boot **4.1.1** `pom.xml`; SQL migration `db/migration/V1__create_books.sql`; `BookInventory.java` backed by Spring JDBC, Flyway; unchanged G1 `BooksDelegate`, `HealthDelegate`, Application and Basic demo Security.
- **PostgreSQL:** **16.10** (actual build package `Debian 16.10-1.pgdg12+1`), running on **127.0.0.1:55432** inside the Docker *build stage only*. No persistent volume, public DB endpoint, production credential or external managed service was created.
- **Operations:** `createBook` inserts with PK conflict -> HTTP 409; `getBook` -> 200/404; `adjustStock` uses a single row-locked `UPDATE` guarded against integer overflow and returns 400/404/409; `listBooks` sorts by ISBN, supports bounded `limit`/`offset`, and runs `COUNT(*)` plus page query inside `REPEATABLE READ`. The DB has CHECK constraints forbidding negative stock and blank IDs/titles.
- **Migration policy:** Flyway applies a reviewed versioned migration, never derives DDL from an HTTP path or mutates production data. `flyway_schema_history` and negative DB constraint tests are checked.

## Execution evidence and precision about Docker caching

**Last Java/DB logic change and verified real DB test source SHA:** `a366ac3a9b133b5306ed01df75d9d778f5807b04`. At this exact SHA, the Render Free Docker build `dep-db6n0aqd0e5s73aua8dg` for service `srv-db6mvhks728c73cktj8g` reached **LIVE**. It freshly executed PostgreSQL 16.10 + Flyway v1, `mvn -B -ntp clean verify` **BUILD SUCCESS** and **10/10 JUnit tests**, 0 failure/error/skip: **six real HTTP tests** (1 direct error-dispatch security, 2 Books pagination, 1 catalog CRUD, 2 stock adjustment), **three direct PostgreSQL domain tests** (migration/CHECK constraints, rollback, duplicate and overflow), and **one generated-delegate completeness test**. All groups ran against the same disposable PostgreSQL service. 

The same Docker `RUN` launched executable Spring Boot JAR in **two separate JVM processes**, against the *same* PostgreSQL instance: process 1 created `g5-restart-survivor` with stock 2 and patched +7 to 9; process 2 fetched the persisted book with stock 9, enforced 409 on re-creation, and listed it. Observed markers:
`G5_PRE_RESTART_INSERT_AND_ATOMIC_WRITE_PASS`,
`G5_PERSISTENCE_SURVIVES_TWO_JVM_PROCESSES_PASS`,
`G5_DURABLE_ROW_COUNT=9`.

**Codegen idempotence source SHA:** `07dbff4e19b80394921282e284079d2569cb3ab3` adds a second independent generation and a source-tree comparison, yielding `G5_GENERATED_JAVA_IDEMPOTENT` in Render deploy `dep-db6n1eou01pc73fem450`, **LIVE**. The downstream unchanged PostgreSQL Maven/JVM Docker layer was cache-eligible; no assertion of *fresh* JUnit execution at this later SHA. The last non-cached complete DB/HTTP execution remains the preceding SHA, with identical application sources.

The public endpoint `https://protocolia-g5-postgres-build-20261012.onrender.com/health` independently returned:
`{"status":"UP","postgresql_test_build":"VERIFIED","persistent_books_api_publicly_enabled":false}`.
The published image contains **only a health marker**. There is no publicly running persistent Books API/database at that URL.

## Failed attempt preserved

First source SHA `25ef4b7c47d97d44d9ee9c3bf90d0bba0bc82da6`: Flyway successfully applied migration v1, but Spring context creation failed because `@Transactional` uses CGLIB class proxying while `BookInventory` was `final`. The non-final user-owned service fix was committed at `a366ac3a9b133b5306ed01df75d9d778f5807b04`. Maven and HTTP suites then passed. No compensating changes were made to G1, G4 or semantic v0.3.

## Security and constraints

The build's PostgreSQL `trust` authentication is allowed **only within an isolated ephemeral Docker build stage bound to loopback**, and test demo credentials are local to that build. It is **not** an endorsed deployment policy. The G5 publicly published artifact has no DB binaries/volume or writable Books endpoints. It does not prove production-ready tenancy, durable backups/replication, real OIDC IdP integration or operational recovery.

**Testcontainers not used:** Render Free Docker build has no nested Docker daemon; a real PostgreSQL 16.10 process in a disposable image provides stronger database-level evidence than mocked repositories but is not a Testcontainers-based E2E suite. Pinning Maven/PostgreSQL **image digests** and a fully offline toolchain cache remains a reproducibility improvement.

## Remaining G5 gates (OPEN)

- **Evolution propagation:** v0.3 lacks optional/nullable semantics. A compatible `publishedAt` field must not be faked or silently accepted. Implement a versioned target profile and end-to-end Java/TS/JSON Schema/RJSF fixture before declaring schema-evolution support.
- **End-to-end regeneration:** coordinate generated Java, Orval client, RJSF form manifest, OAuth2 capability mapping and the migration boundary in one disposable workspace; prove no handwritten edits on an additive contract change.
- **Durability operations:** PostgreSQL under a managed *nonproduction* instance, real migrations against upgraded schema, restart/recovery with a durable volume, backup/restore, secret handling, and tests of migration rollback strategy.
- **Broader conformance:** OpenAPI 3.1 nullable/optional/enum/union corpus; property tests on non-GET operations in a disposable database; another resource; role coverage under trusted JWT.
- **Production:** G4 still lacks real managed OIDC/JWKS rotation; default Java generator promotion and time/cost savings are undecided; G5 as an entire gate is **NOT 100%**.

**Next bounded step:** extend schema/contract evolution compatibility, preserving fail-closed behavior, then wire additive propagation through the real G3 UI and downstream client. Keep P4 frozen, avoid GitHub Actions minutes and paid providers.
