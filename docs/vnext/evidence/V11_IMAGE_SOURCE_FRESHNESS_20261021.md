# ProtocolIA v1.1j — local Docker image identity and read-only source freshness

**Date:** 2026-10-21/22 UTC. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), Draft. **Release:** immutable v1.0.0 on main, unchanged.

**Functional integration status:** [v1.1j Spring/Nest PostgreSQL/Chromium CI #39713726285](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39713726285) — **SUCCESS**, independently verified on modular Spring Boot and NestJS with real PostgreSQL/Chromium. Both matrix jobs emitted PROTOCOLIA_V11_RUNTIME_STAGE_PASS, PROTOCOLIA_V11_STAGED_RUNTIME_PASS, PROTOCOLIA_V11_FRESHNESS_BEFORE_UPGRADE_PASS, PROTOCOLIA_V11_STALE_SOURCE_REJECTED, PROTOCOLIA_V11_APP_EVOLUTION_PASS and PROTOCOLIA_V11_DB_PREFLIGHT_PASS. The source remained unchanged during staging and the old checkpoint was rejected after the intentional test upgrade. **Unit and quality checks:** [quality #39713726208](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39713726208) and [#39713730869](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39713730869) — **SUCCESS**.

## Gap and bounded approach

v1.1i could stage the regenerated runtime against a restored database and verify the old file digests and receipt. It could **not** identify the actual container image the stage used, nor compare the original running DB with the checkpoint before an operator attempted a separate cutover.

v1.1j adds the following **local-only guardrails**, without deploying or modifying the source DB:

1. At checkpoint creation, record the exact existing Docker Compose project name and its DB container ID in the v1 checkpoint metadata. The archive remains a read-only PostgreSQL pg_dump custom format, SHA-256 verified. Historical checkpoints missing these additional fields remain valid for earlier non-production rehearsal but **cannot** pass the new source freshness command.
2. The stage runtime records the **Docker image content ID** from the actual running staged application container, validates the local image exists under the same ID, and embeds it in receipt schema 2 along with the SHA-256 digests of **all original PostgreSQL public table rows and columns** obtained immediately after restoring the archive but before the new app starts.
3. The stage receipt verifier refuses an altered image ID, missing local image, changed snapshot, changed file ownership seal, altered TypeSpec IR/SQL, modified checkpoint archive or report, unsafe permissions, and a removed staging acceptance result. It requires the disposable staging volume to have been removed successfully.
4. New explicit **app:db:source:verify** requires the evolved app, checkpoint, preflight report, previously generated receipt, an explicitly named Compose project and private environment file. It rejects missing **--assert-writes-paused**. It confirms the **same exact DB container ID** still belongs to the original Compose project, and cryptographically compares every original table/column/row count and row digest against the backup snapshot, including historical migration ledgers. It only reads, and never takes a destructive action or starts/stops services.
5. Existing disposable CI oracle now checks freshness before restarting the original test app, then **must reject the original checkpoint after the upgraded app adds schema and audited writes**. Unit negative tests also exercise a one-row change with unchanged row counts, schema drift and added tables.

## Operator runbook (local Compose only)

Run only after a maintenance process has explicitly stopped **all application and external writes**. The --assert-writes-paused flag records the operator's assertion, **not** an enforced database lock. Keep the pause in place until any separate deployment decision has been executed or aborted.

~~~sh
# 1. Read-only old-DB checkpoint. The manifest binds the source Compose/DB identity.
npm run app:db:checkpoint -- /path/generated-app \
  --project existing-compose-project --env-file /private/project.env \
  --out /private/pre-upgrade.dump

# 2. Prove the additive TypeSpec SQL against an isolated, networkless restore.
npm run app:db:preflight -- /path/new-TypeSpec /path/generated-app \
  --checkpoint /private/pre-upgrade.dump --report /private/approved-preflight.json

# 3. Regenerate files, using exact SQL/IR/checkpoint approval; does NOT deploy.
npm run app:evolve:verified -- /path/new-TypeSpec /path/generated-app \
  --checkpoint /private/pre-upgrade.dump --report /private/approved-preflight.json

# 4. Build and boot the real generated runtime against a SEPARATE restored DB.
npm run app:db:stage -- /path/generated-app \
  --checkpoint /private/pre-upgrade.dump --report /private/approved-preflight.json \
  --out /private/staged-runtime.json

# 5. Ensure the same tested local Docker image and data receipt still exist.
npm run app:db:stage:verify -- /path/generated-app \
  --checkpoint /private/pre-upgrade.dump --report /private/approved-preflight.json \
  --out /private/staged-runtime.json

# 6. Read-only final original-DB equality check under the operator's write pause.
npm run app:db:source:verify -- /path/generated-app \
  --checkpoint /private/pre-upgrade.dump --report /private/approved-preflight.json \
  --receipt /private/staged-runtime.json \
  --project existing-compose-project --env-file /private/project.env \
  --assert-writes-paused
~~~

Passing this last check emits PROTOCOLIA_V11_SOURCE_FRESHNESS_PASS. It does not deploy the image, lock writes or authorize production. The current CI also expects PROTOCOLIA_V11_FRESHNESS_BEFORE_UPGRADE_PASS and PROTOCOLIA_V11_STALE_SOURCE_REJECTED from disposable projects.

## Guarantees and explicit limits

- The stagedImageId is a Docker **local image ID** (sha256 of the image configuration, bound to layer digests), **not** a remotely pinned OCI registry manifest digest. This does not prove that a future build, push or deployment will use the same image.
- No signed, independent attestation or business-owner authorization is provided. The operator must preserve archive, preflight, receipt and source credentials securely; the local image must remain present for receipt verification.
- The comparison performs multiple read-only queries, not an atomic single PostgreSQL snapshot. If writers ignore the maintenance pause or resume between this check and cutover, it cannot prove that the source is unchanged at deployment time. This is a **best-effort fail-closed local maintenance check**, not a zero-race online migration barrier.
- A database container restart can change its ID even if its data volume is unchanged; this deliberately fails closed and requires a fresh checkpoint and rehearsal.
- The receipt includes only table names, column names, counts, hashes and version bindings, not plaintext business rows, but should still be treated as sensitive metadata and stored owner-only.
- No automatic rollback, destructive migration, remote deployment, production traffic switch, downtime bound or secret management feature is part of v1.1j.

**Next engineering milestone:** develop a separately authorized deployment candidate that uses a specific pinned artifact (preferably an OCI manifest digest where a registry is involved), revalidates write quiescence/freshness at the actual cutover boundary and independently verifies post-start health. Do not silently substitute the local staging receipt for these guarantees.
