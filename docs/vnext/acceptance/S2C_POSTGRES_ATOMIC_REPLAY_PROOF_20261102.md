# S2c — PostgreSQL atomic event-replay research proof

## Motivation and boundary

The opt-in Linux filesystem replay marker is single-host and can strand a
durable lock on interruption. A separately pinned checkpoint is not atomic
with publication. This increment tests a different **database-level**
linearization primitive: a provider-scoped unique key and an append-only
audit entry in the **same PostgreSQL transaction**. It is an isolated,
framework-neutral research proof, not a production migration.

## Invariants implemented

- One claim per `(tenant_id,provider_id,event_id)`, even across orders, SQL sessions,
  and concurrent processes. A conflicting event is rejected; it is not
  silently treated as an idempotent success.
- A bounded batch (1–512) either writes every event **and** one corresponding
  audit row for each, or writes nothing. Unique-key failure in a later event
  rolls back earlier inserts and audit rows. Injected audit failure rolls
  back its corresponding event claim.
- Strict provider/order/statement digest, six-field event shape, exact
  decimal string, PostgreSQL `NUMERIC(38,6)`, and capture/refund/chargeback
  kind validation. Textual amount evidence is preserved independently of
  numeric storage. No floating-point arithmetic.
- Immutable row and TRUNCATE guards protect the disposable journals against
  accidental mutation. Ten competing PostgreSQL sessions for one event
  must yield exactly one commit; ten distinct events must all commit. A
  terminated PostgreSQL backend after event and audit inserts but before
  COMMIT must roll back both, permitting a clean subsequent retry.
- Providers in one tenant and the same provider in two distinct tenants may
  reuse an event ID. Within a tenant/provider, an event ID cannot be reused
  under a different order or statement.
- The proof now creates a dedicated NOLOGIN owner, a NOLOGIN runtime role,
  and an untrusted role. The runtime has schema USAGE and EXECUTE on the
  validated `SECURITY DEFINER` function, but **no direct SELECT/INSERT/UPDATE/
  DELETE/TRUNCATE/ALTER/CREATE privileges** on evidence tables or schema.
  The function pins its search path to trusted catalog/schema names, with
  `pg_temp` last. Negative tests exercise direct bypass, unauthorized
  invocation and caller-created temporary-table shadowing. Concurrency,
  audit failure, rollback and terminated-session recovery all execute the
  claim function under the restricted role.

- Three disposable PostgreSQL LOGIN principals receive independent random
  passwords at test runtime and membership in the NOLOGIN runtime role.
  The SECURITY DEFINER function reads `session_user` and binds it to an
  owner-only `principal_binding` table, deriving the tenant rather than
  accepting tenant input. An authenticated sandbox login cannot claim as
  another provider or impersonate another tenant, and cannot inspect or edit
  the mapping. Tests use actual password-authenticated connections rather
  than admin-only `SET SESSION AUTHORIZATION` impersonation.

## Reproduce with disposable PostgreSQL 16+

```sh
export PGHOST=127.0.0.1 PGUSER=postgres PGDATABASE=protocolia_s2c_replay_ci
# Supply credentials through PGPASSWORD or your isolated test connection.
psql -X -v ON_ERROR_STOP=1 -f experiments/s2c-pg-replay/atomic-replay.sql
bash tests/vnext/provider-statement-pg-atomic-replay.sh
```

GitHub Actions workflow `s2c-pg-atomic-replay.yml` starts its own disposable
PostgreSQL 16 service. This is separate from, and does not replace, the
independent generated NestJS and Spring PostgreSQL/HTTP acceptance workflows.

## Explicit blockers before product integration

The SQL function now uses `SECURITY DEFINER` owned by a dedicated NOLOGIN
role. Test callers connect using real, separate password-authenticated LOGIN
principals and then assume the restricted runtime role. The private mapping
binds each database login to a tenant/provider and rejects a mismatched
caller-supplied provider ID. This is a **disposable PostgreSQL identity and
isolation proof**, not independent verification of an HTTP provider signature,
a production IAM integration, or an externally verified financial event.
The schema deliberately provisions test-only role names with no password;
the test assigns random credentials in the disposable database. Real account
provisioning, credential rotation, connection pooling semantics, tenant
onboarding and trust-root binding are not implemented. None of this is wired
into the signed-statement CLI or either generated application. This proof
also does not cover migrations on populated databases, post-commit
acknowledgement loss, production tenant onboarding, durable backups, or
recovery after data loss.
A privileged owner/superuser can still alter triggers or tables; the
runtime role cannot. Neither the database nor an external signature proves
bank settlement.

Do not run this schema in production, treat a recorded refund or chargeback
as executed, claim TL-14 complete, create a stable financial tag, or close
issue #57. This proof does not perform any financial operation.

## Experimental committed-outcome recovery (post-commit acknowledgement loss)

An opt-in disposable upgrade `experiments/s2c-pg-replay/committed-outcome.sql`
is applied **after** the 19-row legacy PostgreSQL fixture. It creates a
separately immutable `batch_receipt` written inside the same transaction as
the existing claim and audit rows, with a SHA-256 fingerprint of a canonical
JSONB envelope containing provider, order, signed-statement digest and exact
event array. The old runtime EXECUTE grant is revoked to prevent bypassing
the receipt; only the new `claim_with_receipt` function can create claims.

The restricted `inspect_committed_batch` returns `committed` only when the
authenticated database principal's tenant/provider, exact original batch,
receipt and **every** claim/audit record match. It returns `not_observed`
when none of the supplied event IDs are visible in the current PostgreSQL
snapshot. **This is not proof of non-commit or permission to retry:** an
in-flight transaction may still commit. Partial, mismatched, duplicate,
legacy/unreceipted or corrupt evidence is rejected rather than guessed.
The lookup is read-only and never resubmits a financial event. It is intended
to disambiguate an interrupted response after PostgreSQL COMMIT, not to
declare a provider capture or bank settlement successful.

The workflow tests a populated-schema upgrade, restricted grants, 10-way
same-event contention, rollback on a later duplicate, tenant isolation,
a deliberately altered audit row, old unreceipted evidence, and forced
database-backend termination **after COMMIT but before acknowledgement**,
and a separate in-flight/pre-COMMIT termination probe demonstrating the
snapshot limitation. A retry must still rely on the unique key and explicit
operator/provider recovery policy, never on `not_observed` alone.
The CI must finish before these claims are treated as verified.

This is **not** a production-safe migration: no external signed-provider
verification is bound to the database principal, no IAM onboarding or
credential rotation, no generated Spring/Nest integration, no disaster
recovery/backup, and no externally confirmed refunds/chargebacks. A
privileged database owner remains in the trusted computing base. Issue #57
must remain open; no production deployment or financial tag.

## Disposable populated logical-backup recovery gate (S2c follow-up)

The same isolated PostgreSQL 16 workflow now runs
`tests/vnext/provider-statement-pg-backup-restore.sh` **after** the legacy
fixture, receipt upgrade, and acknowledgement-loss tests. The test takes a
consistent `pg_dump -Fc --schema=protocolia_s2c_replay` snapshot with 25
claims, 25 audits and five immutable receipts; restores it into a new
`template0` database using `pg_restore --single-transaction --exit-on-error`;
and verifies all evidence counts and claim/audit correspondence.

The restored database must preserve the dedicated NOLOGIN function owner,
restricted runtime EXECUTE grants, denial of the legacy writer and direct
table reads, tenant-scoped recovery of a committed receipt, and append-only
guards. It must reject a replay and an altered amount, then accept one new
synthetic receipt with exactly one audit and leave the original source at
25/25/5. The new restored state must be 26/26/6. The test database is dropped
afterwards. The CI marker is `PROTOCOLIA_S2C_PG_RESTORE_PASS` **only if**
the PostgreSQL workflow reaches it; documentation alone is not evidence.

**Recovery boundary:** this is a *logical schema/data restore drill in the
same disposable PostgreSQL cluster*. Global roles, their memberships, server
configuration, cluster-level trust roots and login provisioning are NOT
backed up by schema-scoped `pg_dump`; the fixture's existing cluster roles
are a deliberate prerequisite, and test login passwords are rotated.
There is no production PITR, encrypted off-site backup, WAL continuity,
independent-cluster restoration, IAM onboarding, RPO/RTO guarantee, or
generated NestJS/Spring/CLI integration. It cannot establish external
settlement, refund execution or financial acceptance. Keep TL-14 #57 open.


## Independent-cluster cold recovery (experimental)

The existing logical backup/restore test restores into a new **database in the
same PostgreSQL cluster**; it cannot establish recovery from complete cluster
loss. The additional `provider-statement-pg-cold-restore.sh` acceptance starts
an entirely separate disposable PostgreSQL 16 container with a newly generated
admin credential and an empty database. It exports the populated 25-event,
25-audit, 5-receipt schema from the source, then:

1. Requires an owner/role-less `pg_restore --single-transaction` to fail and
   leave no partially restored schema.
2. Recreates minimum NOLOGIN owner/runtime identities and LOGIN memberships
   from `cold-restore-roles.sql`, without importing credentials.
3. Restores the custom archive **with ownership and ACLs** into the new cluster,
   checks exact evidence fingerprints and principal privilege boundaries.
4. Assigns new disposable login credentials, verifies authenticated tenant
   isolation, receipt lookup, duplicate rejection, old-writer bypass rejection,
   and acceptance of one new receipt-backed event.
5. Verifies the original source is still 25/25/5 and unchanged.

This is a reproducible **cold-cluster recovery test**, not a production backup
policy or an automated disaster recovery procedure. It assumes the independent
archive was captured and preserved, that the operator can provision trusted
role identities, and that PostgreSQL 16 and Docker are available. It does not
prove offsite retention, encryption at rest, restore-point objectives,
provider key recovery, signed HTTP identity, settlement, or production IAM.
The fixture uses only synthetic events and disposable credentials.
