# S2c — optional local signed-statement replay guard (2026-11-01)

## Threat and contract

Detached Ed25519 verification proves the bytes match a pinned key, not that the
statement was issued by a legally verified provider or that funds cleared.
Previously, the **same signed snapshot could be reconciled repeatedly**, which
is dangerous if downstream operators mistake repeated reports for new evidence.

The CLI now accepts **`--local-replay-dir <existing-private-directory>`** only
alongside all three signature trust flags, `--expected-order` and the now
mandatory independent operator `--expected-provider`. The directory
must be a real (not symlinked) POSIX directory owned by the invoking UID, with
no group/other permissions. The operator must provision it on **trusted local
storage**, for example `mkdir -m 700 /path/to/private-s2c-state`. Do not put
this state on shared, remotely mutable or ephemeral storage.

After the same descriptor-verified external statement, pinned signature,
internal receipts, returns and crosswalk have been validated and reconciled,
the CLI atomically creates an `O_EXCL|O_NOFOLLOW` marker keyed by SHA-256 of
(provider ID, order ID, exact statement byte SHA-256), with a domain separator.
It syncs the marker and directory before emitting JSON. Across ten simultaneous
processes sharing the same private directory, at most one should emit a report.
Re-signing the same bytes with another key ID or validity window does not
change the marker. The first run consumes the statement **even if it returns
discrepancies (exit 2)**; malformed/tampered inputs never consume it.

Exit statuses remain 0 (comparison without detected exceptions), 2 (comparison
with exceptions), and 1 (rejected). On replay, exit 1 with no JSON output. A
successful opt-in report contains `replayProtection: "single_host_local_marker"`
and the non-secret marker digest; legacy signed and unsigned modes still say
`none_offline` or omit the signature object.

## Important limitations

This is **not** a production-grade replay ledger. There is no shared database,
trusted provider sequence number, provider identity attestation, tenant
authorization, rollback-resistant state, backup, disaster recovery or bank
settlement verification. A user with access to the state directory can delete
markers; a new directory, host, restored snapshot, or lost volume permits
replay. A crash after marker creation but before stdout leaves a consumed
statement: fail-closed and **not automatically retryable**. Never delete markers
to recover automatically; manual recovery requires independent review of
the statement and the prior execution outcome. Do not treat this as financial
idempotency or production acceptance. No real money is moved.

## Reproduction and evidence gate

```sh
node --check packages/adapters/provider-statement-local-replay.mjs
node --test tests/vnext/provider-statement-local-replay.test.mjs
node --test tests/vnext/provider-statement-*.test.mjs
```

The S2c Node 22/24 workflow runs the new tests on PR and push; the
NestJS/Spring PostgreSQL financial and provider workflows remain separate
regression gates. No CI result is asserted by this document until Actions
completes. TL-14 #57 remains open.
