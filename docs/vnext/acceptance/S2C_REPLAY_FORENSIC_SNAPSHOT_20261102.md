# S2c — replay directory forensic snapshot witness (2026-11-02)

## Bounded behavior

The read-only local signed-event replay inspector now returns a deterministic `snapshotSha256` over sorted file names and SHA-256 hashes of their exact canonical bytes, domain separated by `ProtocolIA-S2C-local-replay-snapshot-v1`. A second descriptor-bound pass checks that every inspected file retains the same inode, size, timestamps and bytes before returning. The CLI accepts an independently retained `--expected-snapshot-sha256` (64 lowercase hex) and fails closed (exit 1, no report) on a changed, malformed or missing baseline. Without that flag, it still reports current state; exit 2 still means a durable lock requiring manual review.

Reproducible on Linux with Node 22/24 (set `EXPECTED_SNAPSHOT_SHA256` to the digest independently retained from a prior inspection):

```bash
node --test tests/vnext/provider-statement-replay-inspection.test.mjs
node scripts/vnext/inspect-provider-event-replay.mjs --local-event-replay-dir /path/to/private-state
node scripts/vnext/inspect-provider-event-replay.mjs --local-event-replay-dir /path/to/private-state --expected-snapshot-sha256 "$EXPECTED_SNAPSHOT_SHA256"
```

The test uses disposable local directories, signed synthetic event markers, and proves stable fingerprints, additions, in-place valid canonical edits, deletions, mismatched pins, malformed flags, and no writes by the inspector.

## Critical limitations

A digest from the same untrusted host is **not** a signed or externally anchored checkpoint. An attacker able to replace both the state and the supplied expected digest defeats this check; a deleted marker can match a previously empty baseline. The second scan only detects observable races, not an atomic filesystem snapshot. Never automatically clear crash locks or interpret a matching digest as complete event history, provider legal identity, financial settlement, distributed replay protection or verified refund. Persist any baseline outside the mutable replay directory with separately controlled operator custody. This does not change generated NestJS/Spring financial APIs, migrations or ledger state. TL-14 stays open.
