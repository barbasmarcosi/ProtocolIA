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
  must yield exactly one commit; ten distinct events must all commit. A\n  terminated PostgreSQL backend after event and audit inserts but before\n  COMMIT must roll back both, permitting a clean subsequent retry.
- Provider A and provider B may use the same event ID; provider A cannot
  reuse it under a different order or statement.

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

The SQL function deliberately uses `SECURITY INVOKER`. It does not
authenticate a provider, a tenant, or the caller, and it is **not** wired into
the signed-statement CLI or either generated application. In a real design,
an independently authenticated ingress principal must validate the signed
payload and bind tenant/provider identity; a dedicated non-superuser owner,
restricted schema/function/table privileges, migration/recovery and durable
backup are mandatory. A direct table writer could otherwise bypass this
research function, and a privileged DB owner can alter triggers. Neither
the database nor an external signature establishes actual bank settlement.

Do not run this schema in production, treat a recorded refund or chargeback
as executed, claim TL-14 complete, create a stable financial tag, or close
issue #57. This proof does not perform any financial operation.
