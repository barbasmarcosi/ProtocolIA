# ProtocolIA v1.1r — Fault-injected one-shot migration and fail-closed runtime handoff

**Date:** 2026-10-22. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), Draft. **Stable:** `main`/`v1.0.0` unchanged.

**Initial CI run:** [Spring + NestJS #39832058630](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39832058630) — **PARTIAL EVIDENCE**: NestJS completed all functional steps successfully, including `PROTOCOLIA_V11_MIGRATION_FAULTS_REJECTED`, `PROTOCOLIA_V11_MIGRATION_RETRY_SAFE_PASS`, `PROTOCOLIA_V11_RUNTIME_SECRET_ISOLATION_PASS`, `PROTOCOLIA_V11_ROLE_SEPARATION_PASS` and `PROTOCOLIA_V11_APP_EVOLUTION_PASS`. Spring Boot was still installing pinned Chromium at the last check, before its real migration drill; **do not claim v1.1r fully accepted yet**. Unit/quality run: [#39832063858](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39832063858).

## Gap in v1.1q

A standalone migrator and a secret-free HTTP runtime had been proven. However, if the migrator failed, stopped or committed SQL but crashed before signalling completion, the runtime did not have a release-specific mandatory database completion signal. CI had tested only a successful single invocation. A released app must fail closed until **that exact staged immutable image** has a completed migrator handoff.

## v1.1r semantics

Both generated adapters now consume `PROTOCOLIA_MIGRATION_HANDOFF_ID`, a 64-character lowercase SHA-256 digest derived from the previously staged local Docker image content ID. The disposable Compose overlay supplies the **same ID** to its one-shot `migrate` service and its separate `app` service. `app` does not receive migration credentials.

After all approved SQL has been committed successfully, the migrator records `public.protocolia_migration_handoff_v1(image_digest primary key, completed_at)` on the same PostgreSQL database. The runtime role receives **SELECT-only** access to this table. This completion row is published *after* the migration, not before. The HTTP runtime refuses to serve unless:

- its own migration handoff ID is present and well formed;
- the matching handoff record is readable and present;
- its database connection is not a PostgreSQL superuser;
- no privileged migration user/password is present in its environment.

The NestJS runtime also checks that every expected TypeSpec-derived table column is available. Spring disables automatic startup Flyway migration before initializing the web application. The `legacy` mode remains unchanged for backward compatibility; fail-closed release checks apply to **explicit** `runtime` mode.

### Fault injection (CI only)

The one-shot migrator supports `PROTOCOLIA_MIGRATION_FAILPOINT` strictly within the migrate process. Accepted values:

| Timing | NestJS | Spring Boot |
|---|---|---|
| Abort before transaction commit / migration invocation | `before-commit` | `before-migrate` |
| Crash after schema SQL has committed, but before completion record is published | `after-commit` | `after-migrate` |

The first Nest fault is thrown before its explicit database `COMMIT`, so its DDL and migration-journal writes are rolled back together. Spring's first fault is before invoking Flyway, so neither the new **V3 additive ledger** nor its SQL should exist; Flyway's preexisting **V2 BFF migration** must remain intact. The second fault occurs **after** Flyway/Nest migration transaction success but **before** `protocolia_migration_handoff_v1` is published. It must return a nonzero exit status and leave no authorized HTTP handoff.

Only the disposable CI oracle injects these failure modes, using `docker compose run --rm --no-deps -e PROTOCOLIA_MIGRATION_FAILPOINT=... migrate`. The app does **not** start during failed migrations. Its independent startup check must reject even a committed schema when the completion row is missing.

### Restart and idempotent retry proof

The oracle's original old app remains stopped and its PostgreSQL container, preexisting business rows, children and audit are preserved. The test then:

1. Confirms the **new additive** ledger count (Nest V2 / Spring V3) and `purchase_order.note` column are absent, while preserving Spring's historical V2 record.
2. Forces the pre-commit fault; rechecks **no new additive ledger row**, **no new column**, **no completion marker**, no app service.
3. Forces the post-commit fault; rechecks **exactly one new additive ledger row**, new column present, **still no completion marker**.
4. Starts an ephemeral HTTP runtime test attempt; startup **must fail**, and no long-running app service may appear.
5. Retries migration without injected faults; old schema history validates, duplicate additive SQL is skipped and one exact-image handoff record is published.
6. Retries the successful migrator a second time. The new additive ledger entry (Nest V2 / Spring V3) and completion marker must remain exactly one each.
7. Starts the *same tested image* in explicit HTTP runtime mode, with no privileged migration credentials. As before, verifies GET/write operations, audited state, ETag and preserved original rows.
8. Rechecks the exact Docker image, database container identity and post-upgrade checks.

The marker is a database-local, non-secret completion gate. It is **not a signed attestation from an independent authority** and does not substitute the separate Ed25519 approval, checkpoint integrity, source-write fence or versioned app acceptance already implemented in v1.1m–q.

## Security and operational boundaries

- The migration completion record proves that a migrator with database DDL authority wrote the expected image ID after a successful migration. A database administrator can forge or remove the row; it is not independent cryptographic provenance.
- A completion row by itself is not a full schema-diff validation or an atomic ingress traffic switch. A failure after publication is outside this specific fault interval; the previous signed candidate, DB and health checks remain required.
- Older `legacy` modes still allow historical startup-migration behavior. Explicit release orchestration must use `runtime` and one-shot `migrate` modes to obtain the new guarantees.
- The CI project is constrained to disposable `pia_ckpt_<10hex>`. No production deployment, live rollback, restored-over-newer-writes, zero-downtime or remote registry provenance is implemented.
- Recovery from permanently failing migration remains an operator decision: leave the old app unavailable in maintenance, inspect the errors, correct the immutable artifact and obtain a new verified candidate; do **not** blindly restore a stale checkpoint to a live upgraded database.
- Spring Flyway migration and Nest PostgreSQL DDL are transactional in the tested PostgreSQL adapter and reviewed additive migration profile. These guarantees must not be generalized to arbitrary external migrations/databases.

**Next:** reproducible release profile and stronger interruption drills (SIGKILL/OOM, resumable operator procedures, multi-replica traffic fencing), with explicit production-readiness criteria rather than a production deployment by default.

## Integration defect discovered and addressed

[Initial matrix #39832058630](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39832058630) demonstrated the NestJS rollback, incomplete-handoff rejection and idempotent retry passes, but then failed its existing v1.1o role verification: the newly created `protocolia_migration_handoff_v1` table was incorrectly classified as a business table. It is intentionally a **migration-internal, SELECT-only** table and must **not** receive external reader/writer DML grants.

The role inventory, automatic grants and generic first-table selection now explicitly exclude `protocolia_migration_handoff_v1`. Unit regression asserts all three exclusions. In [corrected matrix #39833203461](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39833203461), NestJS completed the migration fault drill **and** all external role checks successfully. That run proved Nest but Spring failed a **test-only version assumption**: the expected new Flyway version was incorrectly compared to existing BFF V2 rather than new additive V3.

Do not treat a completed Node/Nest job as evidence that the parallel Spring job has passed.

## Final independent acceptance — v1.1r

**SUCCESS for both NestJS and modular Spring Boot:** [full PostgreSQL/Chromium CI run #39877947582](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39877947582) (22 Oct 2026 local; logs dated 23 Oct UTC). The corrected Spring oracle checks that historical Flyway V2 already exists, and asserts that **only additive V3** changes from zero to exactly one after the injected fault and safe retry. NestJS independently checks additive V2.

Both jobs emitted verified log markers `PROTOCOLIA_V11_MIGRATION_FAULTS_REJECTED`, `PROTOCOLIA_V11_MIGRATION_RETRY_SAFE_PASS`, `PROTOCOLIA_V11_ONE_SHOT_MIGRATION_PASS`, `PROTOCOLIA_V11_RUNTIME_SECRET_ISOLATION_PASS`, and `PROTOCOLIA_V11_APP_EVOLUTION_PASS`. They also passed the signed disposable approval, original PostgreSQL snapshot preservation, role restrictions and schema/ETag/audited-write checks. Exact image-bound handoff and no HTTP runtime when absent were tested against real PostgreSQL.

**Marker compatibility caveat:** older log JSON labels `version2JournalExactlyOnce` and `migrationLedgerVersion2` have been preserved for existing log consumers, even for Spring. The actual Spring SQL assertion now targets **V3**, and confirms the historical **V2** remains unchanged. Do not use the legacy JSON key names to infer the Spring migration version.

No production deployment or automatic restoration into an upgraded live DB occurred. Full safety caveats above continue to apply.
