# ProtocolIA v1.1l — Disposable pinned-image cutover and old-runtime recovery drill

**Date:** 2026-10-22 UTC. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), Draft. **Stable:** v1.0.0 on main remains untouched.

**Integration:** [Spring/Nest matrix #39719081726](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39719081726) — **PENDING at documentation time**. Do not mark acceptance until both jobs and recovery/cutover markers succeed.

## What changed

v1.1k verified an approved image before and after a test upgrade, but the existing test upgrade still used Compose --build, risking substitution with a different image. v1.1l fixes this in the **ephemeral CI fixture** and adds a separately usable **isolated old-runtime recovery drill**.

### Old-image provenance

Read-only app:db:checkpoint now records sourceAppImageId, the Docker image content ID of the **original running app** at backup time, alongside the existing checkpoint archive SHA-256, source DB container identity, and Compose project. Old checkpoints without this field remain verifiable but cannot be used for the new recovery drill.

### Isolated recovery, injected outage, verified cleanup

The new app:deploy:recovery:drill uses the existing evolved generated app, immutable candidate, preflight, stage receipt and checkpoint. It accepts NO production database URL, external Compose project or arbitrary restore target. It:

1. Creates a new random pia_recover_<hex> Compose project, random owner-only credentials, a new PostgreSQL volume, and loopback-only HTTP port.
2. Restores the old checkpoint into the empty cloned DB with pg_restore --exit-on-error --single-transaction. Compares all original public table columns and SHA-256 row digests against the stage snapshot.
3. Uses a Compose override with image: sha256:<exact old image ID>, pull_policy: never and build: !reset null; starts the original app image with --no-build. Confirms actual container image, /health and a TypeSpec-derived safe HTTP list operation.
4. Deliberately stops ONLY the recovery app, confirms the outage, then restarts exactly the original image without rebuilding and checks both health and unchanged restored data.
5. Removes the new recovery Compose project and its database volume BEFORE writing an owner-only JSON receipt. app:deploy:recovery:verify rechecks candidate bytes, checkpoint hash, old and staged image IDs, old row-digest evidence, and cleanup status.

This demonstrates backup recoverability and restart of the old software **against a disposable clone**, NOT rollback of a migrated original database.

### Pinned image cutover in disposable CI only

The integration script creates a project named pia_ckpt_<10 hex>. v1.1l enforces this exact naming convention and rejects arbitrary/prod project names before using an image override. It runs the staged local image content ID with pull_policy: never, build: !reset null, and --no-build, preserving the original test database container. The existing oracle checks preserved records, incremental migration, audited writes, ETag and post-start image equality. No unapproved rebuild is accepted as a passing cutover.

Only the existing explicitly disposable integration fixture performs the in-place test migration. Neither recovery command can target the original database or deploy a production application.

## Recovery operator commands

First complete the v1.1j/1.1k checkpoint → preflight → verified evolution → stage → immutable candidate steps. Keep all artifacts private and outside the generated app.

~~~sh
npm run app:deploy:recovery:drill -- /path/generated-app \
  --checkpoint /private/pre-upgrade.dump \
  --report /private/approved-preflight.json \
  --receipt /private/staged-runtime.json \
  --candidate /private/deployment-candidate.json \
  --out /private/recovery-drill.json

npm run app:deploy:recovery:verify -- /path/generated-app \
  --checkpoint /private/pre-upgrade.dump \
  --report /private/approved-preflight.json \
  --receipt /private/staged-runtime.json \
  --candidate /private/deployment-candidate.json \
  --out /private/recovery-drill.json
~~~

## Precise limitations

- The recovery probe starts an old binary on **restored historical data**. It does not automatically repair or roll back a live upgraded schema. **Never restore an old checkpoint over a live database with later writes**; those writes and audit records would be lost.
- A successful health endpoint/list read and restart do not prove complete business recovery. A production-grade drill would also need business acceptance, SLOs, operator authorization and monitoring.
- A locally pinned Docker image is not a signed OCI provenance attestation; local hashes and manifests can be forged by a host administrator.
- There is still no production cutover command, automatic rollback, durable DB write lock, atomic DB snapshot-to-switch barrier, zero-downtime guarantee or external traffic switch. The CI pinned cutover is explicitly restricted to disposable projects.
- The recovery clone intentionally uses its own Compose network and HTTP loopback port. It never modifies the real source DB.

**Next goal:** independently authorized maintenance/write-quiescence enforcement and supervised forward-only release switch. Keep production cutover disabled until it is supported and validated.
