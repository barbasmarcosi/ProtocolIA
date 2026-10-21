# v1.1 — Verified evolution gate after PostgreSQL rehearsal

**Date:** 2026-10-21  
**Branch:** `feature/v1.1-generic-if-match-conformance-20261020`  
**PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), Draft.  
**Base release:** immutable `v1.0.0`, unchanged `main`.  
**Verified commit:** `817ee0df324dd93048faab0668e2b4fc2c81716f`.  
**CI:** [#39607198330](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39607198330) — SUCCESS, `nestjs` and `modular-spring`.  
**Quality:** [#39607207988](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39607207988) — SUCCESS.

## Motivation

ProtocolIA v1.1 previously exposed `app:plan`, `app:db:checkpoint`, an offline `app:db:preflight`, and `app:evolve` for additive migrations. The dangerous gap was that the application regeneration step **did not have to match the successful rehearsal**, even if its source contract, SQL or restore archive had changed since the preflight.

The new explicit **`app:evolve:verified`** command closes that local release-process gap **for supported additive changes**, by checking the data before replacing generated application artifacts.

## Safe workflow

The following is for locally generated Compose-backed apps with an already running database and an explicit maintenance process. Paths must be real paths outside the managed generated app.

```sh
# 1. Inspect planned contract differences and SQL (read-only).
npm run app:plan -- /path/new-TypeSpec /path/generated-app

# 2. Make an immutable, owner-only checkpoint of the currently running DB.
npm run app:db:checkpoint -- /path/generated-app \
  --project existing-compose-project \
  --env-file /private/compose.env \
  --out /private/backups/before-v1.1.dump

# 3. Rehearse SQL against the verified archive on isolated PostgreSQL.
npm run app:db:preflight -- /path/new-TypeSpec /path/generated-app \
  --checkpoint /private/backups/before-v1.1.dump \
  --report /private/reports/additive-v1.1.json

# 4. Revalidate the rehearsal report against the *exact imminent evolution*.
# A missing/mismatched report or archive stops before any file replacement.
npm run app:evolve:verified -- /path/new-TypeSpec /path/generated-app \
  --checkpoint /private/backups/before-v1.1.dump \
  --report /private/reports/additive-v1.1.json
```

**Important:** `app:evolve:verified` stages and swaps the **generated application files**. It does **not** apply DDL directly to the live database. The generated service executes its Flyway/Nest schema migration on the **next application startup**. Production upgrades therefore still require a maintenance window, backup kept outside the host, restorable external copy, proper deploy controls, and post-deployment checks. Never infer that a verified local report is permission to upgrade a sensitive production instance.

The historical `app:evolve` command remains available for development/backward compatibility and emits `PROTOCOLIA_EVOLUTION_UNVERIFIED_DEV_MODE`. **It is not protected by the report gate.** Scripts or administrators that can bypass this workflow are outside its enforcement boundary.

## What is bound and what is verified

After compiling the proposed TypeSpec contract again, `app:evolve:verified` checks a successful report against:

- The SHA-256 verified `pg_dump` archive **bytes**, its manifest, target backend, and original generated application's `contractSha256`.
- The original contract digest in the report, the target adapter (`nestjs` or `modular-spring`) and the exact **proposed SQL SHA-256** from the canonical `additiveSql(diff,nextIr)` generator.
- The **proposed canonical IR SHA-256** from the newly compiled TypeSpec project, plus the exact number of changes.
- The report's explicit `schema=1`, `status=pass`, isolated Docker network `none`, no access to the origin database, valid table and row counts, owner-only regular-file permissions (no symlink).
- The staged generated application's semantic IR and OpenAPI are checked against the previously approved compilation before any output swap, preventing a changed contract between planning and staging.

An incompatibility or mismatch **fails closed before regenerating the installed application**. Only a successful match logs `PROTOCOLIA_EVOLUTION_PREFLIGHT_VERIFIED`.

The prior `db:preflight` remains read-only to the installation, executing SQL against a container created with `--network none` and destroyed after rehearsal. Existing row-count and old-column-hash evidence is **not cryptographic row-level attestation**.

## Live acceptance

[GitHub Actions #39607198330](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39607198330) ran against **two separate generated applications and PostgreSQL instances** (Spring Boot and NestJS) and finished SUCCESS.

- Unit tests reject reports with altered SQL, changed IR, wrong checkpoint, incorrect target, incomplete isolation evidence, symlinks or unsafe file permissions; corrupted backups also fail verification.
- The real HTTP/PostgreSQL oracle created records and audit events, took a `pg_dump`, ran a network-isolated SQL rehearsal, and verified the resulting report.
- Before upgrade, the test attempted four **false approvals** (SQL, IR, checkpoint, failed status), and a missing report. **All were rejected**; the generated application's build metadata stayed byte-for-byte unchanged.
- The test then used **`evolve:verified`** with the legitimate report, not `app:evolve`; the protected command emitted `PROTOCOLIA_EVOLUTION_PREFLIGHT_VERIFIED` and `PROTOCOLIA_EVOLUTION_APPLIED`.
- On the same Compose PostgreSQL volume, the real regenerated app started, the migration history advanced (Nest V2; Spring V3 with its BFF V2 preserved), old records/audit remained, the added optional field persisted, and subsequent audited writes obeyed document-version `If-Match`.
- The full generated React browser regression and generic versioned/unversioned `app:test` suites also passed.

Both backends emitted:

```text
PROTOCOLIA_V11_APP_EVOLUTION_PASS
  verifiedEvolutionGate=true
  mismatchedSqlRejected=true
  mismatchedIrRejected=true
  mismatchedArchiveRejected=true
  failedOrMissingReportRejected=true
  preexistingRowsPreserved=true
  preexistingJournalPreserved=true
```

## Deliberate limits

This is a **local integrity gate, not a signed attestation or universal migration engine**. The report and archive manifest are SHA-256 bound but **not digitally signed**; a malicious local actor able to rewrite both and control the generator can fabricate approval. The source DB may receive additional writes after a snapshot, so the gate does not certify its real-time state: operators must stop writes or employ a coordinated release and fresh backup. It does not automatically refuse startup of arbitrary generated apps after manual migration edits, nor replace Flyway/Nest runtime validation. It does not guarantee backups outside the host, production rollback, point-in-time recovery, compatibility of destructive migrations, zero downtime or owner-based authorization.

These limits remain follow-up work, not v1.1 claims.

## Next priorities

1. Extend the preflight evidence to compare a staged **generated runtime** against the restored DB, not just DDL.
2. Design a signed or independently verifiable deployment attestation if the project introduces remote/production deployment automation.
3. Add per-instance data-scope authorization and focused migrations for schema transformations currently blocked.
