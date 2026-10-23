# ProtocolIA v1.1g — Cryptographic preservation of historic rows during migration rehearsal

**Date:** 2026-10-21. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), Draft; immutable `v1.0.0` and `main` unchanged.  
**Verified functional commit:** `6c4bee425e7c3f1e40d8e25f79bbce27604b4ec4`.  
**Live integration:** [GitHub Actions #39624843621](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39624843621) — **SUCCESS**, NestJS and modular Spring Boot, real PostgreSQL/Chromium.  
**Quality:** [#39624852122](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39624852122) and [#39624843584](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39624843584) — **SUCCESS**.

## Why the extra gate is necessary

Previous `app:db:preflight` compared row counts and a sum of PostgreSQL's `hashtextextended` of the original columns. This is a non-cryptographic aggregate: it can miss collisions and conceals opposing row modifications when the aggregate cancels. A positive preflight therefore did **not** meaningfully attest to exact preservation of every old row.

## Implementation

In `packages/cli/database-preflight.mjs`, for **every existing public table** in the restored checkpoint:

1. Query the exact names and ordinal order of the **old columns**.
2. For each full old-column row, calculate PostgreSQL's built-in `SHA-256(convert_to(row_to_json(t)::text,'UTF8'))`; encode the result as 64 lowercase hex characters.
3. Sort the hexadecimal row hashes lexicographically. Equal rows are intentionally **not deduplicated**: their multiplicity remains part of the digest.
4. Use `COPY ... TO STDOUT` to stream these hashes into a random-named, owner-only temporary file; no plaintext business records are saved in the temporary file or JSON report.
5. Read the stream in bounded 1 MiB chunks and compute a second SHA-256 of its exact bytes. Validate the 64-hex-plus-newline format, count every row, reject unexpected output and remove the temporary file in `finally`.
6. Execute only the **canonical, compatible additive TypeSpec SQL** against the isolated networkless restored PostgreSQL instance with one transactional `psql -1`.
7. Repeat the exact process on all original columns and tables and fail if any original table is missing, a count differs or a cryptographic multiset digest differs. Newly added nullable columns are excluded from the historical-row comparison.

The preflight report is now **schema version 2** and declares `rowAttestation: "sha256-sorted-row-json-v1"`. The verified evolution gate `packages/cli/evolution-approval.mjs` requires both values, in addition to the existing source TypeSpec digest, target, checkpoint bytes SHA-256, proposed IR SHA-256, SQL SHA-256, change count and isolation evidence. A legacy v1 report can **no longer be reused as approval**.

## Reproducible acceptance

The same [CI #39624843621](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39624843621) generated and exercised **both** application targets with PostgreSQL and Chromium before running the backup, SQL rehearsal and verified real application evolution.

Each target independently emitted:

```text
PROTOCOLIA_V11_APP_EVOLUTION_PASS
PROTOCOLIA_V11_DB_PREFLIGHT_PASS
  cryptographicOldRows=true
  countPreservingTamperRejected=true
  allExistingRowsPreserved=true
  originalDatabaseUntouched=true
PROTOCOLIA_V11_DB_BACKUP_RESTORE_PASS
```

The crucial regression test restored a checkpoint into an **independent database** and captured every old-row digest. It then changed the `product` value of one retained `order_line` **without changing the count (3)**. The SHA-256 verifier rejected the collection. After reverting that value, the same old-row digest verified successfully. The original Compose database was never altered by this tamper test.

Unit tests also verify a valid schema-2 report can approve the exact imminent evolution, while `schema=1`, missing/new-invalid `rowAttestation`, wrong checkpoint, wrong SQL/IR, missing or forged status, insecure report permissions and symlinks fail closed.

## Scope, threats and remaining limits

- This checks preservation of **all original-column rows** within an isolated restored checkpoint; it does **not** certify the future state of the running origin database, which may receive writes after the backup.
- Per-row SHA-256 plus sorted stream provides a strong **computational collision-resistant multiset check**, not a formally perfect equality proof; it is tied to PostgreSQL's row-to-JSON serialization and the captured old-column ordering.
- The report contains no row contents or passwords. Temporary files contain only row hashes and are deleted on completion, but operators should still treat both checkpoint and report as sensitive artifacts requiring private storage.
- The report and checkpoint manifest are **not independently signed**. An attacker able to forge both and control the generator is outside the guarantee.
- Large tables impose real PostgreSQL sorting and hashing cost; this is a **maintenance-time safety gate**, not a zero-downtime high-throughput online migration.
- The existing `app:evolve` remains an **unverified development escape hatch**; use `app:evolve:verified` to enforce the report. No unconditional block exists against a separately administered deploy.
- Destructive contract migrations, production backups, point-in-time rollback, per-instance authorization and a **staged generated-runtime test against the restored migrated DB** remain separate work.

**Next priority:** verify the newly generated runtime itself against the isolated, migrated database, including health, query compatibility and migration ledger — beyond a successful isolated SQL-only rehearsal.
