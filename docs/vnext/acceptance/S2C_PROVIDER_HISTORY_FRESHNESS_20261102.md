# S2c — provider-scoped historical replay freshness fence (2026-11-02)

## Risk

Without an operator-supplied checkpoint, the local signed-event replay writer
validated historical marker bytes before acquiring its provider lock, but after
writing new durable markers it checked only the new marker inodes. A concurrent
canonical rewrite of a *previously existing* marker belonging to the same
provider could therefore be accepted with a successful claim. This was a
within-operation freshness gap, **not** proof of historical completeness.

## Implementation and invariants

- The read-only inspector accepts an optional validated `providerId` filter
  and produces domain-separated SHA-256 digests/counts for that provider's
  canonical marker entries, including a historical digest that excludes only
  explicitly named new markers. Existing unfiltered inspector output is unchanged.
- The event writer captures the provider-scoped history **under its own lock**
  and, after fsync of all new marker files and the directory, rescans the
  resulting state. It requires exactly the expected provider-specific marker
  count and a byte-identical historical digest excluding the new claims.
  New marker descriptors are checked again before lock removal.
- The scoped fence permits a different provider's valid markers to appear
  during the write. The existing optional operator-pinned whole-directory
  checkpoint retains its stronger, explicit whole-store equality requirement.
- A failed final inspection preserves the durable provider lock and any
  partially written markers for manual recovery. No automatic rollback or
  unsafe marker deletion is attempted.

## Reproducible adversarial tests

```sh
node --test tests/vnext/provider-statement-replay-dirfd-race.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs \
  tests/vnext/provider-statement-replay-inspection.test.mjs
```

Tests inject an old same-provider marker rewrite **after** the new event's
directory fsync, without enabling the optional operator checkpoint, and
require rejection with a retained lock. A separate test inserts a valid
different-provider marker at the same point and requires the local claim
to succeed without a false historical mismatch. Existing checkpoint,
replacement, deletion, concurrency and signed CLI tests remain in CI.

## Boundary

This protects only **observable changes during one local claim**. It cannot
detect pre-existing deleted or rolled-back history without an independently
retained operator checkpoint. The inspector is not an atomic filesystem
snapshot, and an unsafe concurrent scan may conservatively fail closed.
Same-UID hostile mutations after the final check, distributed replay, legal
provider identity, external settlement, production tenancy, refunds and
chargebacks remain unverified. Both generated NestJS/Spring integration suites
must pass before any merge. TL-14 / issue #57 stays **OPEN**.
