# G5 PostgreSQL + Flyway persistence (isolated proof)

**Status: VERIFIED BOUNDED PERSISTENCE PILOT (G5 remains IN PROGRESS).** This is the first
bounded persistence experiment, not production, and not automatic completion of
all G5 requirements.

It compiles the **unchanged** Books v0.3 target-specific OpenAPI 3.1 into
OpenAPI Generator 7.26.0 / Spring Boot 4.1.1 / Java 21 MVC and DTOs. The only
domain replacement is a **user-owned** `BookInventory` using PostgreSQL 16,
Spring JDBC and explicit reviewed Flyway `V1__create_books.sql`.

The PostgreSQL database is created **inside a disposable Docker build** and
does not escape into the published image. The final runtime publishes *only*
a health build marker with `persistent_books_api_publicly_enabled: false`.

```sh
docker build -f experiments/g5-postgresql-books/Dockerfile \
  -t protocolia-g5-persistence .
```

The verified build at SHA `a366ac3a9b133b5306ed01df75d9d778f5807b04` starts a real PostgreSQL server on loopback `127.0.0.1:55432`,
creates one scratch database, runs real Maven/JUnit and HTTP API tests,
validates reviewed Flyway migration and CHECK constraints, transactional
rollback, duplicate ISBN and 32-bit stock overflow; then launches the
Spring Boot executable JAR *twice*, writing a book on the first process and
reading its durable stock on the second. Both processes use exactly the same
external PostgreSQL instance.

The row-locked `UPDATE` with overflow guard serializes concurrent restocks.
`listBooks` uses SQL `ORDER BY isbn LIMIT ? OFFSET ?` plus consistent
`COUNT(*)` in a PostgreSQL REPEATABLE READ transaction. This is an explicit
JDBC backend implementation, **not inferred SQL generation**.

The non-production build passed **10/10 JUnit**, **Flyway V1**, rollback/SQL constraints and a book surviving **two JVM processes**. At SHA `07dbff4e19b80394921282e284079d2569cb3ab3`, independent Java source regeneration was byte-identical. [Full evidence](../../docs/G5_POSTGRESQL_PERSISTENCE_EVIDENCE.md).

No secrets, real customer data, production database, Testcontainers Docker
socket or GitHub Actions minutes are required. P4 remains unchanged.

**Not yet supported:** full G5 compatible optional field propagation across
backend/frontend/forms, production-managed PostgreSQL and recovery, real OIDC,
general multi-resource synthesis and production-ready secure deployment.
