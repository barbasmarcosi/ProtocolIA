# ProtocolIA v1.1i — Operator-facing restored runtime stage and bound receipt

**Completed:** 2026-10-21/22 UTC. **Branch:** feature/v1.1-generic-if-match-conformance-20261020. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55) (Draft).
**Functional verification:** [GitHub Actions #39711474433](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39711474433) — **SUCCESS** in both independent jobs, NestJS and modular Spring Boot.
**Quality:** [#39711474438](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39711474438) — **SUCCESS**.
**Scope:** local, isolated Compose-backed applications using a verified *additive* TypeSpec evolution. No main or immutable v1.0.0 tag changes.

## What was implemented

The previous v1.1h runtime rehearsal was embedded in a CI-only script. v1.1i extracts it into **packages/cli/runtime-stage.mjs**, available through ordinary npm/CLI commands for an already evolved generated app.

The stage command does not accept an original database project, URL, credentials or volume name. It always creates its **own random Compose project** with separate PostgreSQL storage, random credentials, ephemeral localhost HTTP port and an owner-only temporary environment file. The pre-existing source database cannot be targeted by its arguments.

Before starting Docker, the command checks:
- The generated app passes ProtocolIA's managed ownership seal.
- The old checkpoint archive's actual SHA-256 matches its manifest; target and old contract digest match the verified preflight report.
- The new generated TypeSpec IR digest and the *installed actual additive SQL migration* match the successful preflight's approval hashes.
- The preflight used the current schema 2 SHA-256 historic-row attestation, was successful, and declared no original database access.
- The new receipt path is outside the generated app, is not a report/archive path, and does not already exist.

Then it restores the exact old archive into a fresh database; records row digests for **all existing non-migration-history public tables**; builds and starts the generated app on that restored DB; checks health and a TypeSpec-derived list endpoint; verifies all original-row digests are unchanged; and checks that the Flyway/Nest migration ledger advanced to the installed migration version exactly once. An optional test-only callback exercises the versioned document's historical ETag, newly added field, stale-write rejection, successful audited write and **continued isolation from the original source DB**.

A passing stage removes the whole disposable Compose project with volumes **before** publishing an owner-only JSON receipt. The receipt records hashes of the old checkpoint, exact preflight report bytes, evolved IR, installed additive SQL and sealed generated file digest map; it never stores passwords or original business data. The separate verifier rechecks those bindings. It rejects altered receipts, unsealed app changes, changed archive bytes, wrong SQL or IR, symlinks and unsafe file permissions. **It is an unsigned local integrity receipt, not independently attested proof.**

The CI suite continues the original v1.1h oracle after staging and proves that the original *test* PostgreSQL container remains unchanged across the later app-only upgrade. Both backends emitted:
- PROTOCOLIA_V11_RUNTIME_STAGE_PASS
- PROTOCOLIA_V11_RUNTIME_STAGE_RECEIPT_VERIFIED
- PROTOCOLIA_V11_STAGED_RUNTIME_PASS
- PROTOCOLIA_V11_APP_EVOLUTION_PASS
- PROTOCOLIA_V11_DB_PREFLIGHT_PASS
- PROTOCOLIA_V11_DB_BACKUP_RESTORE_PASS

## Operator runbook

Use only a **previously generated** local Compose app and a contract revision verified to be compatible. Keep all checkpoint, preflight and receipt files in a private directory **outside** the managed app.

~~~sh
# Existing source DB remains running; this command only reads its data.
npm run app:db:checkpoint -- /path/app \
  --project YOUR_EXISTING_COMPOSE_PROJECT \
  --env-file /private/project.env \
  --out /private/before-upgrade.dump

# Offline networkless PostgreSQL restores the old data and rehearses exact SQL.
npm run app:db:preflight -- /path/new-TypeSpec /path/app \
  --checkpoint /private/before-upgrade.dump \
  --report /private/preflight.json

# Changes generated application files, not the original database.
npm run app:evolve:verified -- /path/new-TypeSpec /path/app \
  --checkpoint /private/before-upgrade.dump \
  --report /private/preflight.json

# Tests the newly generated runtime on a DIFFERENT ephemeral Compose/PG volume.
npm run app:db:stage -- /path/app \
  --checkpoint /private/before-upgrade.dump \
  --report /private/preflight.json \
  --out /private/runtime-receipt.json

# Recheck the existing receipt against the same files and ownership seal.
npm run app:db:stage:verify -- /path/app \
  --checkpoint /private/before-upgrade.dump \
  --report /private/preflight.json \
  --out /private/runtime-receipt.json
~~~

This is a **rehearsal workflow**, not a deployment command: it does not restart the original service. The operator must separately plan maintenance, latest-database backup, controlled cutover, rollback logistics and service monitoring. The existing app:evolve development escape hatch is **not** an authorized guarded upgrade.

## Live CI evidence and negative tests

The Spring and Nest matrix [#39711474433](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39711474433) independently generated versioned apps, exercised genuine PostgreSQL/Chromium and legacy CLI conformance, restored old databases, tested the real new runtime using the extracted stage command, checked immutable migrations, mutated only the staging copy, verified the receipt and then executed the original test DB upgrade.

The first new matrix [#39710569089](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39710569089) caught a test-integration defect: a parser requiring a *new receipt path* was incorrectly reused for verification of an *existing receipt*. The stage itself passed in Spring, but receipt verification was rejected. The parser now distinguishes create versus verify, covered by a dedicated unit regression. The subsequent matrix above passed **both** backends.

Unit tests assert that mutated SQL/report/archive/IR, stale or forged hashes, altered sealed source files, symlink receipts, unsafe permissions and attempt to overwrite a receipt fail closed.

## Not claimed

- No production deployment was performed or authorized; this is not automatic enforcement of source-DB freshness or an actual cutover.
- An original database can receive writes after a checkpoint. A passing stage tests exactly the restored snapshot, not a newer live state.
- The generated ownership seal and receipt are hashes, **not signatures**. A local administrator with write access to every input can forge the package; no external trust anchor exists.
- A stage runtime uses a private Docker Compose network to connect to its isolated PostgreSQL. Only the independent SQL-only preflight has --network none.
- The receipt binds the generated *file contents* and preflight inputs but does not yet pin/reverify the ultimate **deployment container image digest** or require business-owner change approval.
- There is no zero-downtime guarantee, online production migration, automatic downgrade or destructive migration support.

**Next highest-value milestone:** explicitly bind an operator-approved deployment artifact/image digest to the successfully staged image and enforce a fresh maintenance-time check of the actual source DB before controlled cutover; if this requires production credentials or deployment access, implement separate authorization, never implicitly infer it from a CI receipt.
