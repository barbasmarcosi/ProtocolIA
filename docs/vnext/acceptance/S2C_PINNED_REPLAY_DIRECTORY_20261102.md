# S2c — replay directory descriptor anchoring (2026-11-02)

## Threat and invariant

The optional **single-host** replay guards previously verified a private
directory descriptor, but created their O_EXCL marker and provider lock through
the **mutable original pathname**. A concurrent rename/replacement of a parent
directory between that check and marker creation could redirect the write into
a different directory. Even though a later inode check rejected the current
attempt, the original replay directory could lack the durable marker, permitting
an unintended future acceptance after pathname restoration.

Both the per-statement and per-provider-event guards now anchor every marker,
provider lock, preflight and unlink operation to the **already-opened directory
descriptor** via Linux `/proc/self/fd/<fd>/...`. The pathname is still checked
for identity before success. If replaced, the attempt fails closed while any
partially written marker/lock remains in the original opened directory. Hosts
without Linux procfs fail closed rather than silently downgrade protection.

## Reproduce

```sh
node --check packages/adapters/provider-statement-local-replay.mjs
node --check packages/adapters/provider-statement-event-replay.mjs
node --test tests/vnext/provider-statement-replay-dirfd-race.test.mjs \
  tests/vnext/provider-statement-local-replay.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs
```

The deterministic negative tests intercept O_EXCL creation, rename the verified
private directory, create an equally private substitute at the original path,
then assert: the attempted comparison fails; the substitute remains empty; and
the displaced original contains the marker/lock. The complete Node 22/24 S2c
workflow runs the historical signature, CLI, event replay and financial
arithmetic suites as regression gates.

## Scope and residual risks

This protects the **write target**, not against an attacker who controls the
same process UID, the operating system, the procfs mount, or replay state
storage. It is Linux-only and single-host, not a distributed transaction,
independent provider authentication, a durable multitenant audit log, actual
bank settlement or production-grade refund execution. Manual investigation
is required for interrupted locks; do not delete them automatically.

Keep TL-14 (#57) open. No real financial operations, production deployment,
or stable financial release tag.
