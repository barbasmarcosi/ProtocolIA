# R4.2 — verified checkpoint, isolated restoration and crash recovery

**Scope:** integration acceptance on disposable GitHub runners and Docker Compose projects. The only source of TypeSpec contract changes is a snapshot delivered with an opt-in generated Project Passport. Nothing in this workflow upgrades a real user or production database.

## Existing safeguards reused

ProtocolIA already has `db:checkpoint`, `db:verify`, `db:preflight` and `evolve:verified`. The first generates a custom-format PostgreSQL backup from an explicitly named, already-running Compose project, with an owner-only immutable archive and SHA-256 metadata. The preflight restores the exact archive into a new network-disabled PostgreSQL container and compares SHA-256 row multiset digests of old columns before and after the proposed canonical SQL. The verified evolution checks that the archive and report bind to the old contract SHA, new IR, SQL and change count. **This is cryptographic integrity evidence, not an authenticated signature or permission to deploy.**

R4.1 had previously validated a deliberately safe additive TypeSpec change against PostgreSQL populated rows using unverified development-mode `app:evolve`. This R4.2 test adds the evidence-bound path and a separate old-data recovery exercise.

## Exact acceptance performed by CI

The workflow [r4-verified-recovery.yml](../../.github/workflows/r4-verified-recovery.yml) runs independently on generated **NestJS** and **modular Spring** projects:

1. Build canonical Taller from TypeSpec with `--passport`. Verify the original generated app seal.
2. Bring up a uniquely named **disposable** Docker Compose project, seed known durable rows over HTTP, and establish the exact DB container identity and old-column values.
3. Create a **real** PostgreSQL `pg_dump` custom-format checkpoint using `db:checkpoint`; verify the archive bytes, permissions, source contract identity and overwrite refusal. Deliberately corrupt a separate archive copy and require verification failure.
4. Extract **only** the TypeSpec source from the Passport into a clean working directory. Verify its pre-build digest, then add a bounded nullable `serviceNote` to the entity and request model.
5. Run `db:preflight` against the real archive and proposed TypeSpec. Require a passing report from the isolated, `--network none` PostgreSQL restore, row digest conservation and no access to the original database.
6. Forge a second preflight JSON with a wrong SQL digest. Require `evolve:verified` to reject it **without changing the generated app**. Then present the exact original archive and valid report to `evolve:verified`, require acceptance, and verify the refreshed Passport, TypeSpec bytes and app ownership seal.
7. Recreate **only the app container** on the **original DB container and volume**. Require the original HTTP records, permissions and uniqueness checks to remain correct; insert a row using the new field and exercise the prior atomic increment.
8. Independently restore the **pre-upgrade checkpoint** in a new `--network none` PostgreSQL container with a separate volume. Require exactly the original pre-upgrade rows and absence of the new column, demonstrating the fallback data is independent of the evolved live test database.
9. Force-kill that **isolated restored database**, restart the same container/volume, and verify WAL recovery of the exact pre-upgrade data. Require the evolved source database identity and post-upgrade rows to remain unchanged; verify HTTP after the drill.

Do not accept source-code assertions alone: **both CI matrix jobs must succeed on the PR's exact head SHA** before this milestone is merged. A crash/restart of an isolated restored PostgreSQL is a limited recovery drill, not a full outage simulation of production infrastructure.

## Boundaries, exclusions, and next gates

- Only the fixture's known safe additive change is tested. No unknown-domain independent-agent reasoning or arbitrary destructive changes are authorized.
- The local preflight report is **not** signed by a real human; source hashes do not establish business approval or the freshness of a production backup. The original CI application is disposable, not production.
- Killing the restored PostgreSQL container tests crash recovery of its **separate** volume; it does **not** prove failover, RPO/RTO, read consistency under concurrent live writes, or atomic database+application rollback.
- The proof does not add new migrations, weaken guardrails or touch a user's Docker environment. The CI script only uses newly randomized `pia_ckpt_*` Compose and `pia_r4_*` recovery identities, and cleans up its ephemeral volumes.
- After R4.2, the outstanding R4 requirement is a genuine **separately initialized agent** receiving an unknown project/contract and a preregistered change, and independently proving both backend contracts against a hidden oracle. Keep issue #106 open.

The output marker `PROTOCOLIA_R4_VERIFIED_CHECKPOINT_ISOLATED_RESTORE_CRASH_PASS` must correspond to a completed CI job; it does not by itself certify real-world deployment safety.
