# S2c — private replay directory mode-freshness fence (2026-11-02)

## Threat and invariant

A private, owner-only directory is a precondition of the opt-in single-host
signed-event replay store. The event writer compared the directory's live
path to an **old** `fstat` snapshot, but rechecked the old snapshot's mode,
not the current directory mode. An actor with the same UID could `chmod 0755`
the unchanged inode after the initial private-directory preflight and during
the final directory `fsync`; the writer could still return success. The
read-only forensic scanner similarly inspected directory permissions before
its last `readdir` but did not recheck them afterward.

**Invariant:** neither a replay claim nor its forensic scan may report success
after observing that its live directory was made group/world-accessible during
the operation. A rejected claim must not be rolled back after durability.

## Changes

- The event writer rechecks both current pathname and open descriptor
  `dev/ino`, ownership, type and private mode at its existing fences.
- After the final directory `fsync`, the writer rechecks live privacy and
  the retained event marker descriptors before returning success.
- The forensic inspector rechecks the open descriptor's mode at each final
  scan fence and both live directory views after its last `readdir`.
- A deterministic Node `fsyncSync` hook changes directory mode at the first
  directory sync (pre-claim) and the third (after durable marker and lock
  removal). A separate `readdirSync` hook changes it during the inspector's
  final enumeration. Tests assert failure, absence of falsely accepted
  reports, preservation of lock/marker evidence, and safe rejection of replay.

## Reproduce

```sh
node --test tests/vnext/provider-statement-directory-mode-race.test.mjs
node --test tests/vnext/provider-statement-replay-dirfd-race.test.mjs \
  tests/vnext/provider-statement-replay-inspection.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs
```

The S2c GitHub Actions workflow executes the new suite on Node 22 and 24.
The same PR also requires repository quality and independent generated
NestJS/Spring PostgreSQL/HTTP workflows before merge.

## Limitations

This is an observable single-host race fence, not tamper-proof evidence,
distributed replay protection, independent provider identity, or real bank
settlement. Same-UID mutation *after* the last check is not preventable by a
local filesystem API. After a late post-commit rejection the marker remains
consumed; manual review may be required. No financial production release,
stable financial tag, live payments, or actual refunds are authorized.
Keep TL-14/#57 open.
