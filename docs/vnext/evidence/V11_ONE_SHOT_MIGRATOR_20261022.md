# ProtocolIA v1.1q — one-shot migrations outside request-serving backend

**Date:** 2026-10-22. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), Draft.

**Integration:** [Spring/Nest PostgreSQL matrix #39829681526](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39829681526) — **SUCCESS for both modular Spring Boot and NestJS** against independent disposable PostgreSQL databases. Each job emitted `PROTOCOLIA_V11_ONE_SHOT_MIGRATION_PASS`, `PROTOCOLIA_V11_RUNTIME_SECRET_ISOLATION_PASS` and `PROTOCOLIA_V11_APP_EVOLUTION_PASS`: the exact staged image completed a separate one-shot migration before the HTTP container started, the latter had no privileged migration user or password, the original database container was preserved and audited business writes remained correct.

## Why this milestone

v1.1p separated the PostgreSQL migration and request-time principals but still delivered migration credentials to long-lived application containers for startup migration. v1.1q **uses the same immutable staged image twice**, as two different container/process lifetimes:

1. **`migrate`:** a disposable, privileged, **one-shot** process applies reviewed schema changes and exits.
2. **`app`:** the long-lived HTTP process starts only **after the migrator exits successfully**, with only its restricted `protocolia_app_runtime` SQL account. The Compose overlay removes both `PROTOCOLIA_MIGRATION_JDBC_USER` and `PROTOCOLIA_MIGRATION_JDBC_PASSWORD` from the runtime environment.

### Spring Boot / Flyway

`ContractApplication.main()` now accepts `PROTOCOLIA_EXECUTION_MODE` values `legacy`, `migrate`, and `runtime`.

- **`migrate`** requires explicit privileged `PROTOCOLIA_JDBC_URL/USER/PASSWORD`, runs Flyway programmatically against the same classpath `db/migration` files, validates the journal, exits normally and does **not** start the Spring web application.
- **`runtime`** refuses any nonempty `PROTOCOLIA_MIGRATION_JDBC_*` credentials, verifies the request-time DB principal is not a PostgreSQL superuser, disables Flyway *before* Spring context creation and starts HTTP using only the runtime DataSource.
- **`legacy`**, the default, preserves historical generated application behavior. It is not a claim of least privilege.

### NestJS

The generated `RuntimeService` supports an independently executed migration-only mode, using the existing advisory transaction lock, baseline checksum and additive migration journal logic, without creating a Nest HTTP app. It closes its PostgreSQL connection pool after migration.

The separate `runtime` mode rejects nonempty migration credentials, performs no DDL or schema migration and uses read-only `information_schema.columns` checks against every TypeSpec-derived entity and field. It also rejects a PostgreSQL superuser runtime account. Normal HTTP, audited writes and the optional BFF use only the runtime pool. The default `legacy` mode retains compatibility.

### Disposable exact-image overlay

`app:deploy:migrator:overlay` creates an owner-only YAML outside the generated app for a previously tested **exact local Docker image content ID**, constrained to a random `pia_ckpt_<10 hex>` Compose project and supported Nest/Spring adapters.

The overlay pins **both services** to the same image with `pull_policy: never`:

- `migrate` receives migration credentials via Compose's existing private env-file and has no published ports.
- `app` has `PROTOCOLIA_EXECUTION_MODE=runtime`, receives its existing restricted runtime connection parameters and explicitly **removes the migration credential variables**.
- The test harness uses `docker compose run --rm --no-deps migrate` followed by `docker compose up --no-build --no-deps --force-recreate app`, never an additional build or image pull.

A migrator failure, wrong image, unprivileged runtime with schema missing, unexpected SQL superuser runtime, or runtime migration secret must fail closed. Neither of the new commands deploys anything outside the existing disposable CI project.

## Real acceptance criteria

The Spring and Nest matrix validates, on independently restored PostgreSQL:

1. Existing Ed25519 operator permit, original source snapshot freshness, old runtime recovery, one-time nonce consumption and v1.1n server-side connection gate.
2. The original app is stopped and **remains stopped while the one-shot migration executes**.
3. The one-shot migrator uses the same tested image ID and applies the TypeSpec migration to the original disposable database, exits successfully and is removed.
4. The HTTP app starts from the same image, with **no migration username or password** in its container environment and a proven non-superuser runtime role.
5. Historical rows and audit, new versioned fields, ETags, new audited DML and v1.1o reader/writer activation remain correct.
6. A direct SQL attempt as the runtime role cannot create tables or SELECT schema migration journals; the same old PostgreSQL container is maintained.
7. Existing generated-app legacy/no-flag tests still work.

## Boundaries

- **Not a production deployment.** The one-shot container still uses a privileged migration credential, which is independently managed and must be delivered securely. A host administrator or Docker daemon operator can extract in-use secrets.
- Runtime containers no longer need migration credentials in *explicit v1.1q mode*. Legacy generated applications still permit privileged startup migration, and a deployment must actually select `runtime` mode to opt in.
- This is a two-process lifecycle over the **same approved image**; it is not registry-signed OCI provenance, distributed deployment orchestration or an atomic production traffic cutover.
- A production design still needs real secret distribution/rotation, schema migration rollback-or-forward-fix policies, durable ingress and write barriers, monitoring, and independent production operator approval.
- Runtime startup checks are defense-in-depth and do not fully validate all DB constraint semantics. The migration CI supplies independent checksum, old-row and new-operation checks.
- Never restore an old checkpoint over a live database with writes newer than the checkpoint.

**Next milestone:** make the split mode an explicitly configured deployment profile with externally provisioned app/migration roles and separate secret injection, plus more fault-injection coverage for failed one-shot migrators and restart/retry.
