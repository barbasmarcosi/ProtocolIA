# S2c — reject observable cross-file snapshot drift (2026-11-01)

## Risk and bounded behavior

The offline reconciler previously validated each financial JSON file **only during its
own descriptor read**. If a concurrent exporter replaced or rewrote the internal
receipt snapshot after it was loaded but before the external statement and
crosswalk were parsed, the CLI could report an apparently matching comparison
against a no-longer-current mix of files. In replay-guard mode it could also
consume event markers based on that stale mix.

The CLI now retains the original file SHA-256 and descriptor identity
(device, inode, size, mtime, ctime) for every participating source:
internal receipts, provider links, external events, optional internal returns,
and optional detached attestation. Immediately after validation and comparison,
**before either replay-guard mutation or stdout**, it reopens and strictly
reparses every original path, verifying unchanged bytes and identity. The
loader also checks that the pathname still points to the opened inode at the
end of each read. Any observable rewrite, rename, removal, malformed rewrite,
symlink substitution or changed content is a fatal input rejection (exit 1,
no JSON report). A same-content inode replacement is rejected too.

This deliberately does **not** claim a multi-file atomic snapshot, transaction
isolation or adversarial protection against a change-and-restore race between
checks. Exporters must still publish an immutable, consistent batch (or use
a database transaction with a separately verified export manifest). This
improves local evidence freshness only; it does not establish bank settlement,
provider identity, distributed replay protection, or production tenancy.

## Reproducible acceptance

```sh
node --check packages/adapters/provider-statement-input.mjs
node --check scripts/vnext/reconcile-provider-statement.mjs
node --test tests/vnext/provider-statement-input.test.mjs \
  tests/vnext/provider-statement-cli.test.mjs \
  tests/vnext/provider-statement-signature.test.mjs \
  tests/vnext/provider-statement-event-replay.test.mjs
```

Deterministic negative cases: rewrite a previously loaded internal source,
replace an inode with identical bytes, delete a source before final validation,
and substitute a pathname between opening and finishing a descriptor read.
Positive case: unchanged internal/external/attestation sources pass the final
barrier. Existing signed/unsigned comparison and event replay cases remain
regression tests.

GitHub Actions S2c Node 22/24 and provider preflight NestJS/Spring with
isolated PostgreSQL/HTTP are the required independent checks. Their status
must be verified on the actual PR SHA before merge. Issue #57 remains open.
