# S2c — original-lock identity fencing (2026-11-02)

## Risk and invariant

The single-host event replay writer previously relied on the number of canonical provider locks in the post-acquisition scan. A count of one does **not** prove the remaining lock is the writer's original `O_EXCL` inode. An external pathname replacement could substitute another provider's canonical lock during the scan, allowing event markers to be written without the writer's own lock. A second substitution after durable marker writes could cause the writer to unlink a different lock and incorrectly return success.

The writer now captures the exact lock inode and metadata after writing and syncing its lock. It requires the same owner-owned, private, single-link file and stable inode/size/mtime/ctime both after the post-lock scan and immediately before final unlink. The unwritten-lock contention/duplicate cleanup uses the same guard. Any mismatch fails closed, preserving event markers and substituted locks for manual inspection; no automatic recovery is attempted.

## Deterministic regression

```bash
node --test tests/vnext/provider-statement-replay-dirfd-race.test.mjs
node --test tests/vnext/provider-statement-event-replay.test.mjs
node --test tests/vnext/provider-statement-replay-inspection.test.mjs
```

Two new adversarial filesystem-hook cases: (1) replace the writer's lock with a different valid provider lock during the second scan and require zero event claims; (2) replace the writer's lock with a new inode of the same name and canonical contents after event markers have been synced, requiring rejection, retained foreign inode and durable marker for manual review. The tests exercise the actual exported writer, not a mocked replay algorithm.

## Scope and release gate

This is local crash/replay-state integrity, not proof of provider legal identity, bank-cleared settlement, global replay uniqueness, tenant isolation, rollback prevention or safe automatic crash recovery. A process with write access to the private directory can still attack filesystem state between checks; use a transactional shared store for distributed protection. Generated NestJS/Spring business semantics are unchanged; their existing PostgreSQL/HTTP CI remains a required merge gate. TL-14 issue #57 stays open. No production deployment, financial release tag or real-money operations.

CI evidence and exact PR head must be checked separately; this document does not assert success.
