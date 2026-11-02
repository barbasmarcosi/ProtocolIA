# S2c — PostgreSQL atomic event-replay research proof

## Motivation and boundary

The opt-in Linux filesystem replay marker is single-host and can strand a
durable lock on interruption. A separately pinned checkpoint is not atomic
with publication. This increment tests a different **database-level**
linearization primitive: a provider-scoped unique key and an append-only
audit entry in the **same PostgreSQL transaction**. It is an isolated,
framework-neutral research proof, not a production migration.

## Invariants implemented

- One claim per `(provider_id,event_id)`, even across orders, SQL sessions,
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
- Provider A and provider B may use the same event ID; provider A cannot
  reuse it under a different order or statement.
- The proof now creates a dedicated NOLOGIN owner, a NOLOGIN runtime role,
  and an untrusted role. The runtime has schema USAGE and EXECUTE on the
  validated `SECURITY DEFINER` function, but **no direct SELECT/INSERT/UPDATE/
  DELETE/TRUNCATE/ALTER/CREATE privileges** on evidence tables or schema.
  The function pins its search path to trusted catalog/schema names, with
  `pg_temp` last. Negative tests exercise direct bypass, unauthorized
  invocation and caller-created temporary-table shadowing. Concurrency,
  audit failure, rollback and terminated-session recovery all execute the
  claim function under the restricted role.

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
role; the test caller uses `SET ROLE` to emulate a restricted application
connection. **This is a database privilege proof, not authentication.**
A real deployment must independently authenticate the service and provider,
bind the verified tenant/provider to a trusted principal (never trust a
caller-supplied providerId), and use an actual authenticated login with only
the necessary role membership. None of that is wired into the signed-statement
CLI or either generated application. This disposable proof also does not
cover migrations on populated databases, post-commit acknowledgement loss,
provider-to-tenant isolation, durable backups, or recovery after data loss.
A privileged owner/superuser can still alter triggers or tables; the
runtime role cannot. Neither the database nor an external signature proves
bank settlement.

Do not run this schema in production, treat a recorded refund or chargeback
as executed, claim TL-14 complete, create a stable financial tag, or close
issue #57. This proof does not perform any financial operation.
