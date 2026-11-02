# S2c — cross-provider replay lock contention (2026-11-02)

## Financial integrity and recovery risk

The optional local signed-event replay store uses one `O_EXCL` lock per provider. Its global forensic scan rejects any pre-existing lock, including one from another provider, to avoid claiming financial events while local crash state may be unresolved. That policy remains unchanged.

A race existed **after** the initial clean scan: providers A and B could independently create valid locks before either performed its second scan. Both then observed two locks, rejected, and left their own durable lock despite having written **zero** event markers. A later request could not distinguish these artificial crash locks from a genuine interrupted write and would require manual investigation. This is a recoverability/availability defect, not evidence of money settlement.

## Narrow correction

- If the second complete forensic inspection succeeds but reports more than our single lock, the writer releases **only its own unwritten** lock. It verifies the still-pinned directory and that the lock pathname identifies the same inode as its open `O_EXCL` file descriptor; it then unlinks and fsyncs the directory.
- The already-consumed-event rejection uses the same checked unwritten-lock cleanup.
- Invalid/malformed forensic scans, failed inode verification and failures after event-marker creation **do not trigger cleanup**. A previous provider's lock is never removed by this path.
- No changes to financial comparisons, signed inputs, NestJS/Spring generated contracts, statement markers, event uniqueness, or the read-only inspector's response format.

## Reproducible regression

```bash
node --test tests/vnext/provider-statement-event-replay.test.mjs
node --test tests/vnext/provider-statement-replay-inspection.test.mjs
```

The new regression test launches a child process, intercepts only its `O_EXCL` lock creation, and deterministically introduces a second **well-formed** provider lock between the first and second inspections. It asserts rejection, no event markers, no stranded own lock, and a successful event claim after removing only the synthetic foreign test lock. Existing tests cover ten concurrent duplicate claims, malformed markers, foreign crash locks, and replay rejection.

Run the S2c Node 22/24 workflow and all five relevant PR workflows before merge. Do not infer CI success from this document; use the actual run conclusions and SHA.

## Remaining limits

This remains a **single-host** private directory, not a distributed linearizable replay database or independently audited event ledger. A crash after writing any marker still requires manual review. Filesystem rollback/deletion, provider identity, actual bank settlement, returns/chargebacks, production tenant IAM and backups are not established. Keep [TL-14 #57](https://github.com/barbasmarcosi/ProtocolIA/issues/57) open. No production deployment, stable financial tag, or real-money operations.
