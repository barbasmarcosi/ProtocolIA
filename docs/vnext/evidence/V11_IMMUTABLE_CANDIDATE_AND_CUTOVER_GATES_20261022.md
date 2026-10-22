# ProtocolIA v1.1k — Immutable candidate, precheck and post-start observation

**Date:** 2026-10-22 UTC. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), Draft. **v1.0.0/main:** unchanged.

**Integration:** [Spring/Nest matrix #39716672309](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39716672309) — **PENDING/RUNNING at the time of writing; do not claim ACCEPTED until both jobs conclude SUCCESS**. **Quality:** [#39716672306](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39716672306) and [#39716677759](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39716677759) — **SUCCESS**.

## What changed

Prior v1.1j evidence showed that the regenerated runtime can boot against a verified restored database; its receipt is bound to the actual *local Docker image ID* and old-row snapshots. New v1.1k features, implemented in packages/cli/deployment-candidate.mjs, **do not deploy**:

1. **app:deploy:candidate** requires the evolved generated app, verified checkpoint, approved preflight, staged-runtime receipt, an explicit **immutable** image identifier and an owner-only new output path. It rejects mutable tags, mismatched Docker content IDs, stale/altered receipts and existing or unsafe outputs. For registry-backed candidates it requires a locally inspected **repository@sha256:manifest** reference present in Docker RepoDigests **and** the local image ID to equal the tested image ID. A locally built candidate may use its exact sha256 image ID. Registry refs are never downloaded, pushed or re-tagged automatically.
2. **app:deploy:candidate:verify** validates the existing candidate against the same ownership seal, checked archive, TypeSpec IR/SQL, staging receipt bytes, exact image and explicit image reference. The candidate is an **unsigned owner-only local JSON file**, not a trusted third-party signature or server approval.
3. **app:deploy:precheck** requires the approved candidate, original Compose project, private env and **--assert-writes-paused** plus an *exact* **--approve-image** string matching the candidate. It verifies candidate integrity, performs v1.1j read-only source-DB freshness checks, then revalidates the candidate. The command never freezes writers or deploys services.
4. **app:deploy:postcheck** inspects an already-running Compose project, checks original DB container identity, verifies that the running app container uses the **exact tested local image ID**, calls only an explicit loopback HTTP /health endpoint and checks that container identities remain stable through observation. It is a *post-start observer*; an operator must have executed any restart/cutover by another mechanism.
5. The disposable Spring/Nest CI oracle builds and verifies a candidate, requires the precheck to pass before the existing test upgrade and rejects wrong explicit image authorization and a previously issued precheck after the original DB changes. After the test app restart, it verifies the running image and /health when the image matches; if Compose rebuilt a different image it asserts the postcheck **fails closed** rather than reporting it as the staged image.

## Operator runbook

First follow [v1.1j checkpoint, preflight, verified evolution and staging](V11_IMAGE_SOURCE_FRESHNESS_20261021.md). The original DB must be explicitly quiesced for any maintenance/cutover; the CLI cannot lock it.

~~~sh
# Exact digest printed by app:db:stage/verify as stagedImageId. This can be
# replaced by a registry/repo@sha256:<manifest> that is already locally present
# AND resolves to that same exact staged image ID.
PINNED_IMAGE='sha256:REPLACE_WITH_64_HEX_FROM_STAGE'

npm run app:deploy:candidate -- /path/generated-app \
  --checkpoint /private/pre-upgrade.dump \
  --report /private/approved-preflight.json \
  --receipt /private/staged-runtime.json \
  --image "$PINNED_IMAGE" --out /private/deployment-candidate.json

npm run app:deploy:candidate:verify -- /path/generated-app \
  --checkpoint /private/pre-upgrade.dump \
  --report /private/approved-preflight.json \
  --receipt /private/staged-runtime.json \
  --image "$PINNED_IMAGE" --out /private/deployment-candidate.json

# Only after stopping ALL writes to the original DB externally:
npm run app:deploy:precheck -- /path/generated-app \
  --checkpoint /private/pre-upgrade.dump \
  --report /private/approved-preflight.json \
  --receipt /private/staged-runtime.json \
  --candidate /private/deployment-candidate.json \
  --project existing-compose-project --env-file /private/project.env \
  --assert-writes-paused --approve-image "$PINNED_IMAGE"

# After a separately authorized and performed cutover, observe the running
# service. The command does not deploy it, modify the DB, or perform a rollback.
npm run app:deploy:postcheck -- /path/generated-app \
  --checkpoint /private/pre-upgrade.dump \
  --report /private/approved-preflight.json \
  --receipt /private/staged-runtime.json \
  --candidate /private/deployment-candidate.json \
  --project existing-compose-project --env-file /private/project.env \
  --health-url http://127.0.0.1:8080/health
~~~

**Do not run ordinary docker compose up --build and assume the candidate remains approved.** The resulting image may differ from the one staged; postcheck correctly rejects that drift.

## Explicit boundaries

- A **local Docker image ID is not the same as an OCI registry manifest digest**. A repo@sha256 candidate requires Docker to report that exact immutable RepoDigest for the very same local tested image. We do not claim a registry signature or attest remote registry availability.
- Candidate/precheck/postcheck do not deploy, freeze writers, sign evidence, authorize production, guarantee zero downtime or implement an automatic rollback.
- A simple /health HTTP 200 does not prove user-facing feature correctness or readiness of external services. Use independent post-deployment conformance and monitoring.
- Source comparison scans tables using multiple read-only queries, **not a single globally locked transaction**, and cannot guarantee freshness if new writes occur during or after the check. Keep an independently verified write pause throughout the separate cutover.
- An operator with filesystem/Docker administrative control can forge or replace every local hash-based input. Use outside-of-tool trust and change approval for production.
- A refreshed Compose rebuild that produces a *different* image must be treated as an unapproved deployment; either reuse the exact tested image by a separately authorized means, or rerun staging/approval for the new image. Neither remediation is automated here.
- The postcheck may verify image equality *or deliberately fail closed* in integration depending on the actual rebuild identity, and should not be misreported as guaranteed deployment acceptance.

**Next step:** separate operator-authorized, lock-aware cutover orchestration (or a proven maintenance barrier) and a recovery/rollback drill. A passing v1.1k precheck alone is not permission to deploy.
