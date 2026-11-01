# S2c — optional single-host provider event replay guard (2026-11-01)

## Motivation and interface

The existing `--local-replay-dir` gate prevents byte-identical statements from
being reported twice. Re-encoding the **same provider event** into different JSON
bytes, reordering entries, or re-signing a revised snapshot changes that digest
and can bypass byte-level replay detection.

New opt-in `--local-event-replay-dir <existing-private-directory>` requires
the complete detached Ed25519 trust flags and `--expected-order`. It cannot be
combined with `--local-replay-dir` (two independent commits would be unsafe).
A statement must contain **1–512** distinct valid provider events. The caller
must provision a POSIX directory owned by its UID, mode 0700, on trusted local
storage. All statements for the same provider and tenant MUST use the same
directory, including different orders; do not share one directory across
unrelated tenants or merchant accounts.

After signature verification, strict input parsing and complete read-only
reconciliation, a provider-scoped O_EXCL lock is created and fsynced. The gate
checks every provider/eventId digest for prior consumption before writing any
new event markers. It fsyncs each marker and the directory, then removes and
syncs the lock. A statement with even one previously seen event fails with
exit 1 and no JSON report; no additional event is consumed in that ordinary
duplicate case. An accepted comparison (even with exceptions, exit 2) consumes
all its event IDs. The report says
`replayProtection: "single_host_local_event_markers"` and includes only the
number of consumed events, not a claim of bank settlement.

A crash or I/O error after lock creation can leave a persistent provider lock,
potentially with partial event markers. Future statements for that provider
fail closed. **Never automatically remove a stale lock.** Inspect filesystem
state and independently verify prior reports before any manual intervention.
A lock held by another concurrent process also fails closed rather than
waiting or claiming successful reconciliation.

## Trust boundary and limitations

This is an offline, single-host **local event-identity** safeguard, not a
distributed database, tamper-proof audit, production authorization or
bank/provider attestation. A provider can reuse event IDs incorrectly; those
statements will be rejected until reviewed. Provider/tenant directory scoping
is the operator's responsibility. Replacing, deleting or restoring the state
directory can permit replay. The lock and markers are not an externally
anchored audit trail. No guarantee of completeness of external statements,
bank-cleared funds, real refunds, chargebacks or legal invoices is made.

The operator-supplied key pin verifies signatures only relative to that key.
The system does not independently establish the legal provider's identity.
Do not deploy for live financial processing.

## Reproducibility

```sh
node --check packages/adapters/provider-statement-event-replay.mjs
node --test tests/vnext/provider-statement-event-replay.test.mjs
node --test tests/vnext/provider-statement-*.test.mjs
```

The S2c workflow covers Node 22/24 and the independent NestJS/Spring
PostgreSQL/HTTP workflows remain required regression gates. TL-14 #57 stays open.
