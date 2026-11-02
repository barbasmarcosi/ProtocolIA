# S2c — post-claim input freshness fence (2026-11-02)

## Defect and invariant

The offline reconciliation CLI checked every financial input file immediately **before** committing the optional local signed replay claim. Both local replay modes then performed filesystem writes and fsync before publishing the JSON comparison, leaving a time-of-check/time-of-use window. A same-host actor could replace the internal receipt, external statement, link mapping or signed attestation during that interval. The CLI would previously return a successful report describing an observably stale input snapshot.

**Invariant:** a CLI comparison must not be published if any original financial input path/inode/bytes changed during its durable replay claim.

## Functional change

The CLI now repeats the existing strict, descriptor-bound `assertStatementSnapshotsUnchanged` verification **after** the replay claim, immediately before stdout. This includes optional internal returns, provider registry and operator bundle manifest whenever supplied. Both `--local-event-replay-dir` and `--local-replay-dir` are covered. The check also applies in unsigned mode; it never relaxes the pre-claim check.

The late rejection is intentionally **fail-closed**, not a rollback: the durable marker remains consumed, no report is printed and the command exits 1. Releasing or deleting the marker could permit duplicate acceptance after an uncertain commit. Recovery requires independent operator review. This is not an atomic multi-file snapshot, a distributed transaction, or proof of provider identity or settlement.

## Reproduce

```sh
node --check scripts/vnext/reconcile-provider-statement.mjs
node --check tests/vnext/provider-statement-post-claim-freshness.test.mjs
node --test tests/vnext/provider-statement-post-claim-freshness.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs \
  tests/vnext/provider-statement-local-replay.test.mjs
```

The deterministic child-process preload hooks the real directory fsync, changes a real input only once a durable replay marker exists, and verifies **exit 1, empty stdout, stale-snapshot rejection, marker retained and replay denied**. Four adversarial cases cover internal receipts, external statement, mapping and attestation across both replay modes; two positive tests preserve successful one-time consumption. No production hook or real payment service is used.

## Explicit limits

A same-UID actor may still change a file after the final check. A source can be mutated and restored between reads. The replay claim and publication are not a single database transaction; an input change discovered after a durable claim may strand that claim for manual recovery. For strong completeness and cross-host uniqueness use independently trusted immutable exports and a transactional distributed replay store. TL-14/#57 remains open. No financial release, bank settlement, live refunds or production deployment is implied.
