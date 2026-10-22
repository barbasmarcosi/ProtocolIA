# ProtocolIA v1.1m — Signed disposable approval and bounded write-fence

Date: 2026-10-22. PR: https://github.com/barbasmarcosi/ProtocolIA/pull/55 (Draft). Stable main/v1.0.0 must remain untouched.

Integration evidence: https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39781303084 — IN PROGRESS at initial publication; do not claim PASS before both Spring/Nest jobs complete.

## Goal and boundaries

v1.1l proved restoration of the original backend against a cloned PostgreSQL and an exact staged-image restart. It did not require independent cryptographic authorization, and the previous maintenance flag only asserted that writes were paused.

v1.1m implements two controls **only for the disposable integration fixture**, not a production deployment command.

### External signature verification

The new module packages/cli/disposable-approval.mjs exposes app:deploy:permit:verify. A signed owner-only JSON document contains an Ed25519 signature over canonical JSON claims:

- Audience protocolia-disposable-cutover-v1, never production.
- Exact disposable pia_ckpt_<10hex> Compose project.
- Immutable staged Docker image content ID.
- SHA-256 of the original DB checkpoint archive, immutable release candidate file and passed isolated recovery evidence file.
- Cryptographically random nonce, issuedAt, expiresAt; maximum 15-minute authorization validity.

A separate trusted public key must be supplied outside the generated app along with its **independently pinned SHA-256 SPKI DER fingerprint**. The product verifier never accepts a private key or signs a request. It rechecks the current candidate, staging, checkpoint, source project and recovery evidence, and rejects stale, forged, cross-project, cross-image and unsigned approvals.

The integration harness itself generates a **temporary in-memory test signer** to exercise the real cryptographic verifier. This is test evidence of signature verification, **not evidence of an independent human approver**.

A signature nonce is not yet consumed in an atomic persistent replay ledger; a still-valid permit may be reused by an actor with full local evidence and permissions. Production approval requires an independent signer identity, nonce consumption/revocation and trusted key management.

### Bounded stopped-app write-fence

The new module packages/cli/disposable-fence.mjs exposes app:deploy:fence:verify. It is hard-fenced to ephemeral Compose project names pia_ckpt_<10hex>. It checks:

1. The exact old app container is stopped, with no currently running app service.
2. The exact original PostgreSQL container is still running.
3. pg_stat_activity shows **zero other PostgreSQL client sessions**, excluding the inspection query.
4. App/DB container state is checked again after observing SQL sessions.

The disposable matrix now checks the signed permit **before** stopping the original test app. It then stops that app, verifies no other SQL clients are active, reruns the original DB checkpoint freshness check while it is down, starts the exact staged image without rebuilding/pulling, and verifies migrated DB data and post-start behavior.

Stopping the app blocks writes **from that app**. A session-count check is not a universal DB lock; external Docker administrators, concurrent direct DB clients and new client sessions can still write afterwards. Do not claim atomic database quiescence, serializable cutover or production write lock.

### CLI signatures

~~~
npm run app:deploy:permit:verify -- <generated-app> \
  --checkpoint <old.dump> --report <preflight.json> \
  --receipt <staged-runtime.json> --candidate <candidate.json> \
  --recovery <recovery.json> --project pia_ckpt_012345abcd \
  --permit <signed-approval.json> --public-key <trusted-ed25519.pem> \
  --key-sha256 <trusted-SPKI-DER-SHA256>

npm run app:deploy:fence:verify -- <generated-app> \
  --project pia_ckpt_012345abcd --env-file <private.env> \
  --old-app-id <original-container-ID> --db-id <original-DB-container-ID>
~~~

These are **verification commands**. Neither performs a production deployment or stops a real application. A signing key must be managed outside ProtocolIA; it is not provided or persisted by the project.

## Negative coverage and acceptance

Unit tests reject forged/altered claims, another Ed25519 public key, wrong SPKI pin, expiry over 15 minutes, wrong project or audience, changed recovery report, writable app and unexpected SQL clients/DB identity.

Full integration tests require actual generated Spring and NestJS backends, real PostgreSQL, HTTP/browser conformance, old backup and cloned restore. The signed gate runs before the disposable project cutover; the fence and source snapshot checks run after stopping its old app and before starting the already-staged exact image.

CI: https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39781303084

## Remaining production blockers

- Server-enforced PostgreSQL write barrier covering all connections, and atomic snapshot-to-cutover guard.
- Independently authenticated operator approval/roles, trust-root distribution, one-time permit consumption and revocation.
- Production-specific traffic switching, deployment rollback/forward-fix, post-upgrade monitoring, SLOs and emergency procedures.
- Registry OCI provenance if the target host is distinct from the local image staging host.
- No use of a pre-migration backup to replace a live upgraded DB with subsequent writes: that loses data.

v1.1m deliberately implements no production write permissions, external deployment access or automatic rollback.
