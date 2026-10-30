# ProtocolIA v1.1s — Real SIGKILL at the committed-migration boundary

**Date:** 2026-10-29 (Argentina); CI logs dated 2026-10-30 UTC.  
**PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), **Draft**.  
**Functional commit under test:** [bb7832e7](https://github.com/barbasmarcosi/ProtocolIA/commit/bb7832e7fcba8a66ff1675c810bbd1385021a9ac).  
**Boundary:** only the existing randomly named `pia_ckpt_<10hex>` disposable Docker Compose/PostgreSQL integration project. Never the source production database.

## Gap addressed

v1.1r proved deliberately raised, catchable exceptions before and after the additive migration commit. This does **not** independently establish behavior when the migrator process disappears abruptly.

v1.1s gives Spring and Nest **one-shot migrate mode only** a test-only, bounded pause:
- Spring: `PROTOCOLIA_MIGRATION_FAILPOINT=pause-after-migrate`, after `Flyway.migrate()` succeeds.
- Nest: `PROTOCOLIA_MIGRATION_FAILPOINT=pause-after-commit`, after PostgreSQL `COMMIT` of the additive migration transaction.
- Both print `PROTOCOLIA_TEST_MIGRATION_PAUSED_AFTER_COMMIT` before waiting. If the disposable oracle does **not** kill them, the pause times out and throws `PROTOCOLIA_TEST_MIGRATION_PAUSE_NOT_INTERRUPTED`: no handoff is issued. Normal empty-failpoint migrators are unaffected. HTTP `runtime` does not accept this mode.

The isolated test runner launches **the exact previously staged Docker image ID** as a detached migrator after it proved the original app is stopped and its database records are checkpointed. It checks the actual container image and the pause log, verifies that the *first new* additive SQL version and column are durable, and that no runtime handoff exists. It then calls `docker kill --signal=KILL <test-container-id>` and requires exit code **137**.

The oracle verifies:
1. Original rows and audit are unchanged after the forced termination.
2. The additive migration ledger has exactly one committed new record (Nest V2 / Spring V3) and the new column exists.
3. `protocolia_migration_handoff_v1` is not published by the killed migrator, and HTTP startup refuses without it.
4. An additional failpoint and then an ordinary one-shot migrator recover cleanly; repeated successful invocation leaves exactly one migration ledger record and one **image-bound** handoff.
5. Only afterward can the exact-image HTTP runtime start, with its separate non-superuser principal. Original data, ETags and post-upgrade audited writes still work.

Every probe container is removed with a `finally` cleanup. The marker is emitted only after verification and successful idempotent recovery, not when the fault is injected.

## Independent observed CI evidence

[Full PostgreSQL/Chromium generated-app matrix #40992821457](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/40992821457): **SUCCESS** in both jobs against functional commit `bb7832e7`.

| Generated adapter | Real SIGKILL + no handoff | Safe recovery + exactly-once handoff | Full job |
| --- | --- | --- | --- |
| Modular Spring Boot / Flyway V3 additive | `PROTOCOLIA_V11_SIGKILL_HANDOFF_BLOCKED` at 2026-10-30T02:42:04Z, exit 137 | `PROTOCOLIA_V11_SIGKILL_RECOVERY_PASS` at 02:42:09Z | **PASS** |
| NestJS / V2 additive | `PROTOCOLIA_V11_SIGKILL_HANDOFF_BLOCKED` at 2026-10-30T02:43:01Z, exit 137 | `PROTOCOLIA_V11_SIGKILL_RECOVERY_PASS` at 02:43:14Z | **PASS** |

Both also emitted `PROTOCOLIA_V11_MIGRATION_RETRY_SAFE_PASS` and `PROTOCOLIA_V11_APP_EVOLUTION_PASS`: the old documents, audit journal, migrations, ETag behavior and generated HTTP writes survived. **Quality SUCCESS** on [push #40992821323](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/40992821323) and [PR #40992826703](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/40992826703).

Reproduction: follow `.github/workflows/v11-generic-if-match.yml`; its `node scripts/vnext/probe-db-checkpoint.mjs <generated-app>` is run independently with `nestjs` and `modular-spring` generated from `examples/vnext/dynamic-order-versioned`. **Requires a real isolated Docker engine; this is not asserted from unit tests alone.**

## Important remaining limits

- A targeted **SIGKILL of a single Docker migrator process**, **not** a Docker daemon crash, kernel OOM kill, database host power loss, network partition, multi-replica ingress cutover or live rollback.
- The Spring pre-migrate fault happens before Flyway executes; this does not claim arbitrary partial migrations have transactional semantics. PostgreSQL additive-only migration profile is the tested scope.
- Release handoff remains a **database-local, unsigned** completion record; a privileged database actor can tamper with it. It is not independent remote OCI provenance.
- CI uses a disposable stack, local staged Docker image ID, simulated maintenance write pause and synthetic credentials. It makes **no production rollout or rollback claim**. Manual deployment or existing `legacy` startup paths are not replaced with enforceable production cutover policy.
- Next deployment-security work should address operator recovery on process/host OOM, durable maintenance state, multi-replica traffic fencing, secret delivery and signed artifact/provenance verification. Do not mark v1.1 production-ready based solely on this test.

**State:** v1.1s real SIGKILL recovery: **VERIFIED, scoped to disposable PostgreSQL/Compose generated apps.** PR remains Draft. `main` and the immutable `v1.0.0` baseline remain unchanged.
