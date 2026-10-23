# ProtocolIA v1.1p — Separate migration and request-time PostgreSQL identities

**Date:** 2026-10-22. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), Draft. **Main/v1.0.0:** unchanged.

**Integration evidence:** [Spring + Nest matrix #39827128499](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39827128499) — **SUCCESS for both NestJS and modular Spring Boot** on real PostgreSQL. Each independent matrix job emitted PROTOCOLIA_V11_SQL_PRINCIPALS_PREPARED, PROTOCOLIA_V11_SPLIT_DB_PRINCIPALS_PASS and PROTOCOLIA_V11_APP_EVOLUTION_PASS. The configured request-time user was non-superuser, could not CREATE a table or read the migration ledger, yet completed audited application writes after the additive TypeSpec migration applied using separate privileged credentials. Quality: [#39827128377](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39827128377).

## Gap closed

The v1.1o external reader/writer roles protect *external* SQL clients, but the generated Spring/Nest application previously connected using the PostgreSQL bootstrap/migration superuser for both schema changes and business requests. v1.1p introduces **opt-in distinct SQL connections for migration versus request-time work**, backed by a disposable role-provisioning procedure and real migration + business API checks.

### Spring Boot

The generated `application.properties` binds Flyway's privileged migration connection independently of `spring.datasource.*`:

- `spring.datasource.username/password` continue using `PROTOCOLIA_JDBC_USER/PASSWORD`.
- `spring.flyway.url/user/password` use `PROTOCOLIA_JDBC_URL` and `PROTOCOLIA_MIGRATION_JDBC_USER/PASSWORD`, with fallback for historical applications.
- The generated Compose file offers optional `PROTOCOLIA_RUNTIME_DB_USER/PASSWORD` and independently configured `PROTOCOLIA_MIGRATION_DB_USER/PASSWORD`; old applications retain the original default unless explicitly opted in.

### NestJS

The generated `RuntimeService` has a normal, limited-`max` runtime `pg.Pool`. When both `PROTOCOLIA_MIGRATION_JDBC_USER` and `PROTOCOLIA_MIGRATION_JDBC_PASSWORD` are configured, an independent migration pool is created using the same reviewed PostgreSQL URL with different credentials.

The schema/bootstrap and checksummed additive migration transactions use **only** the migration pool. The migration connection is released and the migration pool closed before serving requests; a runtime session is then checked to prove that the runtime principal differs from the migration principal. A partial pair, or a same-user pair, fails closed. Runtime business handlers and optional BFF session operations keep using the normal runtime pool.

Generated Compose defaults preserve old behavior. Opting in to a restricted `PROTOCOLIA_RUNTIME_DB_USER` requires also setting a valid independent `PROTOCOLIA_MIGRATION_DB_USER/PASSWORD`.

### Disposable runtime identity

New `app:deploy:runtime:prepare` creates the limited SQL role `protocolia_app_runtime` **only after the original disposable app is stopped and the existing Ed25519 signed permit / stopped-container fence verifies the precise `pia_ckpt_<10hex>` project**.

The tool:
1. Verifies no prior runtime role exists, and refuses resetting a live credential.
2. Creates a random, owner-only runtime secret; passes SQL via stdin instead of command-line text.
3. Grants database CONNECT, public schema USAGE, DML privileges on existing public business/audit tables and relevant sequence usage, but **no superuser, CREATEDB, CREATEROLE or CREATE on schema**.
4. Revokes all table privileges on the Flyway, Nest migration, and original Nest schema history journals.
5. Checks role privileges, stores credentials in a separate owner-only JSON outside generated files and emits a non-secret ready marker.

All role provisioning and mutation of the original test DB is limited to the disposable generated application checkpoint harness.

### Real Spring/Nest acceptance

The CI harness:
1. Completes existing v1.1n backup, TypeSpec preflight, staged exact-image, external signed authorization and isolated old-runtime recovery.
2. Stops the previous disposable app, provisions a dedicated restricted runtime SQL principal and verifies SQL DDL is forbidden.
3. Adds opt-in runtime and migration credentials only to the private disposable Compose environment for **the new app**, not the old app or staged image.
4. Holds and releases the existing v1.1n server-side DB connection gate under the same one-time permit, while the v1.1o external writer stays NOLOGIN.
5. Starts the exact staged image without rebuilding/pulling. Spring Flyway or Nest's separate migration pool applies the approved new SQL using privileged migration credentials; the app starts using restricted runtime credentials.
6. Verifies the original DB/container, business rows and audit are preserved, new TypeSpec fields persist, version/ETag semantics remain correct, new audited API writes work, and the app container environment names the two distinct principals.
7. Asserts the restricted runtime principal **cannot SELECT the migration history** and cannot CREATE a new table. The v1.1o external SQL reader is activated only after the pinned new app is healthy.

## Safety boundaries

- **This does not establish production readiness.** The generated PostgreSQL Compose still bootstraps a privileged `protocolia` DB account. It remains present for migration and infrastructure tasks, although no longer used for normal requests in opt-in mode. In a production deployment, migration credentials should not be distributed to long-lived request-serving containers.
- The Nest migration credentials are still supplied to the app process for startup, then the migration *pool* closes. This reduces DB connection lifetime but does **not** remove those credentials from container environment/process access. Future work should extract an externally executed migrator/one-shot job and remove migration secrets from the normal app entirely.
- Spring Flyway startup similarly requires migration credentials in the application process, despite separate SQL pools.
- Role privileges are on existing tables; new domain tables created by future migrations may need post-migration grants. This test covers the safe, reviewed *additive-column* evolution path, not arbitrary schema changes.
- PostgreSQL superusers, Docker administrators and direct external privileged connections can bypass this bounded role split. The existing signed CI permit is not an independent human approval.
- Do not restore an old backup over a migrated DB with later writes. No automatic downgrade, remote rollout, production traffic switch or zero-downtime claim is made.

**Next milestone:** run migrations in a separate, short-lived migrator process/container with its own credentials and sealed artifact, then start only the restricted runtime app. Validate this against both generators and PostgreSQL before any wider cutover automation.
