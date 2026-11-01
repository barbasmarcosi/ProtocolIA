# S2c-1c4j — PostgreSQL append-only provider journal TRUNCATE guard

**Scope:** generated, synthetic provider inbox, receipt-candidate binding and lifecycle journal for both Spring and NestJS. No real provider authority or bank settlement.

## Threat and correction

The existing three journals rejected row-level `UPDATE` and `DELETE` with a shared immutable trigger. PostgreSQL **does not execute row-level DELETE triggers for `TRUNCATE`**. A generated application database role with table-owner privileges could therefore erase replay/idempotency evidence using `TRUNCATE`, potentially allowing an event ID to be accepted again after history was lost.

The generator now emits a separate `BEFORE TRUNCATE FOR EACH STATEMENT` trigger for **each** journal, reusing the fail-closed immutable trigger function. This applies to ordinary, multi-table, `RESTART IDENTITY` and cascading truncation requests. It does not grant settlement authority or change any financial amount, proof, receipt, API or existing table definition.

**Limit:** PostgreSQL owners/superusers can still alter/drop tables or disable triggers. This protects ordinary DML/SQL paths, not an attacker with unrestricted schema ownership. Production requires least-privilege runtime roles and separate migration ownership. The generated fresh-baseline behavior is not evidence of an in-place upgrade for deployed databases.

## Reproduction

On a trusted checkout with Docker and the pinned toolchains, the PR's provider workflow runs for both targets:

```bash
npm ci
node --test tests/vnext/provider-envelope-inbox.test.mjs
npm run app:build -- examples/vnext/workshop-itemized-guard --target nestjs --out /tmp/provider-nest
npm run app:test -- /tmp/provider-nest
node scripts/vnext/probe-provider-inbox.mjs /tmp/provider-nest
# Repeat app:build/app:test/probe for --target modular-spring
```

The disposable PostgreSQL probe seeds immutable evidence, rejects direct `TRUNCATE` on each table and multi-table/cascading truncation, verifies counts unchanged after **each** attempt, then checks previously committed receipt/lifecycle replay, causal projection and unverified financial state. Expected per-target marker: `PROTOCOLIA_S2C1C4J_PROVIDER_JOURNAL_TRUNCATE_GUARD_PASS`.

**Evidence status:** proposed in PR; CI results must be checked at the final head before merging. This does not prove external clearing, refunds/chargebacks, production IAM, backup/restore or independent business acceptance. TL-14 #57 remains OPEN. No deployment, real payment or stable financial tag.
