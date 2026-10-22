# ProtocolIA v1.1n — Server-side PostgreSQL connection gate and one-time approval

Date: 2026-10-22. PR: https://github.com/barbasmarcosi/ProtocolIA/pull/55 (Draft).

**Acceptance:** https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39784367643 — **PENDING at initial publication**. Spring and Nest must independently pass the full PostgreSQL matrix including PROTOCOLIA_V11_SERVER_WRITE_GATE_PASS before v1.1n is accepted.

## Problem being solved

v1.1m stopped the disposable old app and checked zero currently connected SQL clients. That was an observation, not enforcement: another SQL client could connect immediately afterwards.

v1.1n implements a **server-enforced barrier in the disposable PostgreSQL project only**. It also consumes the short-lived Ed25519 approval nonce in a durable maintenance-database ledger to reject replay.

## Implementation

The new packages/cli/disposable-db-gate.mjs exposes two separate commands. Both require the entire verified v1.1m signed-permit argument set (app, checkpoint, preflight, staged receipt, candidate, recovery receipt, exact disposable Compose project, signed permit, public key, out-of-band pinned public-key SPKI SHA-256), plus a private original Compose env and exact old app and database container IDs.

### Engagement

app:deploy:db-gate:engage:

1. Revalidates Ed25519 signed approval, matching original checkpoint, image, candidate and isolated recovery evidence.
2. Confirms the old app is stopped, the original disposable DB is unchanged and there are no other SQL client sessions.
3. From the separate PostgreSQL maintenance DB named postgres, creates a nonce-primary-key approval ledger. Consumes the exact signed nonce with an INSERT ON CONFLICT DO NOTHING RETURNING nonce, rejecting any duplicate.
4. Executes ALTER DATABASE protocolia WITH ALLOW_CONNECTIONS false. Terminates pre-existing protocolia connections and verifies zero sessions and datallowconn=false.
5. Independently confirms the old app is still stopped and the DB container unchanged.

While engaged, PostgreSQL itself refuses new connections to protocolia, including connections attempted with its configured superuser.

### Release

app:deploy:db-gate:release:

1. Revalidates the exact signed permit and verifies it was recorded as engaged in the maintenance ledger.
2. Checks that server-level connection blocking still exists and no old app started.
3. Executes ALTER DATABASE protocolia WITH ALLOW_CONNECTIONS true and marks the nonce as released with a conditional UPDATE WHERE state='engaged' RETURNING nonce.
4. Refuses duplicate releases and re-engagement with the same nonce. Only then may the disposable test harness start the previously staged exact Docker image without rebuilding or pulling.

These commands are **not** production cutover commands: they require the random, fresh CI fixture project format pia_ckpt_<10 lowercase hex digits> and do not accept any remote DB URL or arbitrary production target.

## Tests and reproduction

Unit: node --test tests/vnext/runtime-stage.test.mjs

Full integration: .github/workflows/v11-generic-if-match.yml

The Spring and Nest matrix:
- Exercises forged/expired/cross-project Ed25519 approvals and SQL injection safeguards.
- Stops the original disposable app, requires an empty client-session count and checks the old source backup freshness.
- Engages the server gate, verifies datallowconn=false from maintenance DB, and proves a real connection to the application DB fails.
- Releases the gate; proves both second engagement and second release with the same nonce are refused. Confirms no original business data changed during the barrier.
- Starts the exact previously staged application image and verifies migration, data preservation, post-release new writes, audit, ETag and post-start health.

## Explicit limitations

- The server-level barrier blocks *new connections* while engaged, and this is enforced by PostgreSQL. It is lifted before the newly generated backend starts. The interval between release and app startup therefore still requires independently controlled access/traffic. A privileged database administrator can override the barrier.
- The nonce ledger is in the postgres maintenance DB on the disposable PostgreSQL volume. It survives process restarts but not deleting/recreating/restoring a separate maintenance DB or copying approvals to another independent DB. It is not a distributed replay prevention system.
- On a process failure after engagement, the target DB remains closed. The disposable CI cleans its volume; real operations would require a separately approved recovery procedure. No automatic rollback of source business data exists.
- The test signer is an ephemeral CI key, not an independently authenticated human operator. Public key distribution, real RBAC, approval revocation, trusted source identity and production credential management remain out of scope.
- PostgreSQL protocolia is operated with the generated Compose superuser; a production design needs least-privilege, dedicated app/migration/maintenance users, a durable maintenance write policy and an atomic switching protocol.
- No production deployment, traffic switching, remote OCI artifact attestation, complete failure monitoring, zero-downtime promise or safe downgrade with new writes is implemented.

Next: role-separated runtime credentials and a tested maintenance protocol that holds the write policy through the actual release-to-health interval before any production deployment can be considered.
