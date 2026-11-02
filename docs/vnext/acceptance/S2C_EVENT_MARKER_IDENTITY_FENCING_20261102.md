# S2c — event marker identity fencing (2026-11-02)

## Threat and scope

A valid signed statement can claim several event IDs under a single-host,
provider-scoped exclusive lock. Prior to this change the lock inode was
fenced, but newly created event marker pathnames were not: an actor with
write access to the private replay directory could replace a durable marker
with a new inode containing the **same canonical bytes**, or unlink it,
between the marker fsync and release of the provider lock. Returning success
would overstate replay protection for the event.

## Required behavior

1. Keep each new marker's original open descriptor until the writer has
   durably synced the replay directory and completed claim verification.
2. Verify each marker pathname still refers to the original inode, with
   unchanged size, timestamps, ownership, private mode and single link.
3. A replacement containing identical JSON, or deletion of any marker,
   must reject the entire claim and retain the provider lock for manual
   forensic review. Do not delete a partially committed event marker.
4. Normal signed event claims, overlapping/duplicate event rejection,
   10-process contention, crash and historical-state validation must not regress.
5. Both Node 22 and Node 24 S2c checks, repository quality and relevant
   Spring/Nest generated-workflow regressions must pass before merge.

## Reproduction

```sh
node --test tests/vnext/provider-statement-replay-dirfd-race.test.mjs
node --test tests/vnext/provider-statement-event-replay.test.mjs
```

The adversarial tests inject deterministic mutation immediately after the
second directory fsync, before the writer may release its lock.

## Security boundary

This is **not** a transactionally immutable filesystem, a trusted provider
identity, a complete historical replay proof, distributed replay protection,
bank-cleared settlement, or proof against same-UID mutation **after** the
last inode check. A crash or unsafe mutation intentionally requires
operator review. TL-14 / issue #57 remains open.
