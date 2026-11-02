# S2c — versioned event-bound replay markers (2026-11-02)

## Security gap

The original local replay marker (v1) stored the hash of its filename as
`eventMarkerSha256`, but omitted the underlying `eventId`. A locally forged
canonical-looking v1 marker could not be checked against the actual
`providerId + eventId` hash. The inspector could only validate a
self-referential filename and record. This did **not** authenticate providers
or prevent same-UID filesystem tampering.

## Functional change

- New durable event claims write **v2** records with `eventId`,
  `transactionId`, `kind`, exact decimal-string `amount`, and `currency`,
  alongside the existing statement SHA-256 and provider/order IDs.
- The read-only inspector checks exact v2 fields and reconstructs the
  domain-separated filename hash from `providerId + eventId`; mismatches,
  malformed amounts, currencies, IDs and unknown kinds fail closed.
- The writer rejects malformed or zero amounts, invalid currency codes and
  overlong whole-number precision before acquiring any lock.
- Historical **v1** records remain readable and replay-blocking. They are
  counted separately as `legacyUnboundEventMarkerCount` because their
  event identity **cannot** be reconstructed. No implicit rewrite, deletion,
  or migration of historical financial evidence occurs.
- Existing provider-scoped lock, fsync, inode fencing, operator-pinned
  checkpoint and multi-provider history checks remain in place. v2 changes
  the checkpoint digest for *new* markers; a separately retained checkpoint
  must be advanced using the returned value, never silently recalculated
  from untrusted state.

## Reproduction

```sh
node --check packages/adapters/provider-statement-event-replay.mjs
node --check packages/adapters/provider-statement-replay-inspection.mjs
node --test tests/vnext/provider-statement-replay-inspection.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs \
  tests/vnext/provider-statement-replay-dirfd-race.test.mjs
```

Tests cover positive v2 claims, v2 identity tampering, malformed financial
fields, legacy v1 read compatibility, new v2 claims beside v1, replay,
concurrency, checkpoint rollback and directory/lock inode substitution.
The dedicated S2c workflow runs Node 22/24; generated NestJS/Spring
PostgreSQL/HTTP acceptance remains an independent merge prerequisite.

## Limits and non-goals

A marker is local evidence of an attempted claim, **not** an independently
authenticated provider settlement, financial ledger entry, or bank receipt.
A valid signed statement SHA-256 is still required upstream. v1 history
cannot be retroactively proven. No distributed uniqueness, legal provider
identity, real refunds/chargebacks, production IAM or multi-tenant audit is
claimed. TL-14 (#57) stays open.
