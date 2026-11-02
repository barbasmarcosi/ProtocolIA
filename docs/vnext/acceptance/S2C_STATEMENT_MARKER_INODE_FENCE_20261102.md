# S2c — signed-statement replay marker inode fence (2026-11-02)

## Risk

The optional **whole-statement** local replay guard previously used O_EXCL and
fsync, but could return success after the marker pathname was deleted,
replaced with a fresh inode containing identical bytes, or made publicly
accessible before return. The event-ID replay mode already had an inode fence;
the alternate signed-statement mode did not. A successful report must not
certify an observable missing or substituted replay marker.

## Functional increment

- Hold the newly created marker descriptor through the directory fsync and
  verify that its pathname still names the original device/inode.
- Recheck owner, private mode, single hard link, size and modification/change
  timestamps on both the open descriptor and current pathname.
- Recheck the pinned directory descriptor and its pathname after fsync.
- Fail closed on any mismatch; never delete a marker on failure. No automatic
  recovery or rewrite of historical markers.

## Reproducible tests

```sh
node --check packages/adapters/provider-statement-local-replay.mjs
node --test tests/vnext/provider-statement-local-replay-race.test.mjs \
  tests/vnext/provider-statement-local-replay.test.mjs
```

Five deterministic tests include post-directory-fsync replacement with
identical empty contents, deletion, permission tampering, directory pathname
substitution and a positive one-time claim. The existing signed CLI suite
covers 10 concurrent processes, SIGKILL and invalid signatures. S2c CI must
pass on Node 22/24 and independent generated NestJS/Spring PostgreSQL/HTTP
acceptance before merge.

## Limitations

This is a **single-host, best-effort within-claim** integrity fence. It cannot
prevent same-UID mutation after the final check, restore a deleted marker,
detect historical rollback without an independently pinned checkpoint, or
provide distributed replay protection. A missing marker after malicious
deletion may permit later replay: the operation fails rather than claiming
durability, but the filesystem alone is not a trustworthy adversarial ledger.
No bank-cleared settlement, real refunds, independently established provider
identity, production deployment, stable financial tag or real-money operation
is implied. TL-14 / issue #57 remains open.
