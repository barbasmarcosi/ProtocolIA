# S2c — optional independently pinned replay marker checkpoint (2026-11-02)

## Risk and scope

The single-host event replay directory previously validated each surviving record but
could not detect deletion of an old, otherwise well-formed marker or replacement of
the *entire* directory with an older valid snapshot. A later disjoint event could be
claimed after such a rollback. This is a real replay-integrity gap, not bank settlement.

This increment introduces an **opt-in operator-supplied baseline** over the
canonical marker names and exact bytes, with SHA-256 domain separation
`ProtocolIA-S2C-event-marker-checkpoint-v1\n`. Transient provider locks are
excluded; the existing full forensic snapshot digest remains unchanged.

## Contract and acceptance

1. `inspectLocalEventReplay(directory).eventMarkersSha256` is deterministic,
   including for an empty private directory. The read-only inspector CLI also
   accepts `--expected-event-markers-sha256 HEX`; unlike the full forensic
   snapshot, the marker checkpoint is stable across transient crash locks,
   which still produce exit 2 and require manual review. It is **not** an
   authenticated checkpoint until an operator stores/pins it **outside** that
   directory.
2. A signed statement can opt into
   `--local-event-replay-dir DIR --expected-event-markers-sha256 HEX`.
   Missing replay mode, malformed hex and duplicate flags fail before mutation.
3. The writer compares the independently supplied expected marker digest
   both **before** acquiring its provider lock and **after** acquiring it,
   before writing any new marker. A stale pin or a deletion between scans
   fails closed; an unwritten, descriptor-verified own lock is released.
4. On a successful claim, the CLI reports
   `externalStatementSignature.nextEventMarkersSha256` and the explicit
   `operator_pinned_local_markers_only` scope. The caller must independently
   retain the new digest before using it as the next baseline. An invalid
   claim never reports a next checkpoint.
5. Before lock release, checkpoint mode also rescans the entire resulting
   marker set, requires exactly the writer's lock and the expected count
   increase, recomputes the *historical* checkpoint excluding only newly
   claimed markers, and verifies pinned new marker inodes again. Canonical
   old-marker rewrites during the claim must not be silently incorporated.
6. Tests must cover the signed CLI, old-marker rollback, stale/malformed
   pins, 10 concurrent claims, deterministic deletion between the two
   baseline checks and canonical historical rewrites after marker durability. Existing Node 22/24 and dual NestJS/Spring workflows
   must remain green before merge.

## Reproduction

```sh
node --test tests/vnext/provider-statement-event-replay.test.mjs \
  tests/vnext/provider-statement-replay-dirfd-race.test.mjs \
  tests/vnext/provider-statement-replay-inspection.test.mjs
```

For a first empty store, obtain the baseline from the read-only inspector,
retain it in a separate trusted operator system, then supply it on the next
signed event claim. Store the returned next digest independently after each
successful claim. Never use an untrusted digest obtained from the same
potentially rolled-back directory as an authority.

## Explicit limitations

- **Not distributed replay.** This is a local Linux directory with a
  single-host O_EXCL provider lock. Same-UID tampering after the last check
  and replacement of both the directory and its *untrusted* checkpoint are
  outside the guarantee.
- **No atomic external checkpoint publication.** A crash after marker
  durability but before the operator records the new pin requires manual
  investigation; blindly retrying with the old pin is rejected.
- No independently authenticated legal provider identity, bank-cleared
  settlement, real refunds/chargebacks, multitenant audited reconciliation,
  production IAM/backups, or financial release acceptance.
- The optional mode does not alter TypeSpec IR, generated Spring/Nest
  financial contracts, production databases or real money.
- Keep TL-14 / issue #57 **OPEN**.
