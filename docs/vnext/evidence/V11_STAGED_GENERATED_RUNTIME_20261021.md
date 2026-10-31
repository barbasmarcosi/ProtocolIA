# ProtocolIA v1.1h — Real generated runtime over restored PostgreSQL

**Date:** 2026-10-21/22 UTC. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55) (Draft).
**Validated commit:** [7fe6ab5](https://github.com/barbasmarcosi/ProtocolIA/commit/7fe6ab595115192112b252196c29ce85cf2bd6d6).
**Integration:** [#39708870834](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39708870834) — **SUCCESS** for NestJS and modular Spring Boot on real PostgreSQL/Chromium.
**Quality:** [#39708870766](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39708870766) and [#39708875473](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39708875473) — **SUCCESS**.
The immutable v1.0.0 tag and main were not changed.

## Gap addressed

v1.1g cryptographically verified original-column rows after applying canonical additive SQL on a networkless restored PostgreSQL snapshot. The original test application was later upgraded on its test PostgreSQL volume. That did not yet prove that the **regenerated runtime itself** would start and work against an independently restored database *before* the original test app restarted.

The v1.1h oracle in scripts/vnext/probe-db-checkpoint.mjs now executes this intermediate staging acceptance:

1. Create a random Compose project, owner-only env file, unrelated secrets and a loopback-only ephemeral HTTP port. Start a **distinct, empty PostgreSQL 16.15** Compose DB and assert its container is not the original.
2. Restore the previously verified pg_dump custom archive into the separate DB. Assert original purchase_order, order_line and audit rows match the original snapshot exactly. Assert the source database is unchanged.
3. Start the **same verified regenerated Spring or Nest app** in the staging Compose project, letting its normal startup migration run against the restored data.
4. Assert HTTP 200 health; unchanged historical document ETag "2"; additive nullable note column; and the expected immutable migration ledger (Nest version 2; Spring Flyway versions 1, 2, 3).
5. POST a new order with the new note field, then query PostgreSQL and verify that field persisted. POST a child using stale If-Match "1" and require HTTP 409; retry with "2" and require HTTP 201; verify parent ETag becomes "3", stale attempt did not persist, and at least one related audit row exists.
6. Verify staging did not change the original DB container ID or old snapshot, then **destroy the staged volume**. Only afterwards restart the source test app with the new image and complete the prior in-place upgrade regression.

This CI acceptance emitted PROTOCOLIA_V11_STAGED_RUNTIME_PASS in **both** backends, along with the existing APP_EVOLUTION, DB_PREFLIGHT and DB_BACKUP_RESTORE pass markers. The browser bulk editor, versioned and legacy CLI conformance also passed.

## Reproduce

Runner requirements: Docker Engine/Compose, Node.js 24, Java 21 for Spring, npm lockfile dependencies.

~~~sh
npm ci
npm run app:build -- examples/vnext/dynamic-order-versioned \
  --target nestjs --out /tmp/protocolia-v11-generated
node scripts/vnext/probe-db-checkpoint.mjs /tmp/protocolia-v11-generated
~~~

Repeat with --target modular-spring and a new output directory. CI runs the complete conformance matrix as well.

## Precise limitations

- This tests **only disposable CI Compose environments**. It is *not* a new mandatory production enforcement step inside app:evolve:verified, a signed deployment attestation or an automated production rollback.
- The SQL-only migration preflight retains Docker --network none. The staged generated runtime uses a **private Docker Compose network** for app-to-DB communications and binds its HTTP port only to 127.0.0.1. These are distinct isolation models.
- The original live database might change after its checkpoint; neither CI nor SHA-256 archive integrity proves future source-database freshness or safe zero-downtime deployment.
- No destructive migrations or out-of-band app overwrites are supported. No production credentials or volumes should be passed to this test probe.
- The first [CI attempt #39708490151](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39708490151) failed a **test-only assumption** that each operation must emit exactly one audit row. Three valid audit rows were found. The oracle now checks actual persisted audit evidence without prescribing cardinality, and the full subsequent matrix passed.

**Next step:** consider an optional guarded operator workflow that binds stage image, database snapshot freshness, approved schema and explicit production authorization. Do not claim the CI gate alone protects a manual production rollout.
