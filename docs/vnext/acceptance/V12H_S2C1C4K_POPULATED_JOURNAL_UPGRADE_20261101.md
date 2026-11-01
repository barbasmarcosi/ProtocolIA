# S2c-1c4k — additive upgrade of populated provider journals

**Scope:** an opt-in, operator-reviewed PostgreSQL upgrade for the three synthetic, append-only provider journals previously generated without S2c-1c4j's `BEFORE TRUNCATE` guards. It is **not** a provider settlement, refund, chargeback, production migration approval, or bank reconciliation.

## Risk and behavior

A pre-S2c-1c4j generated database can contain real *internal* replay history while lacking the new statement-level TRUNCATE triggers. Rebuilding a new baseline does not migrate an existing database. Both Spring and NestJS now emit an identical, reviewable `protocolia-provider-journal-truncate-upgrade.sql` only when the canonical exact ledger opts into the synthetic provider inbox.

The SQL is a single atomic `DO` statement. It serializes concurrent attempts using a transaction-scoped advisory lock, obtains NOWAIT table locks to exclude concurrent TRUNCATE/writes during the upgrade; verifies all three existing tables, the expected immutable trigger function, and all three enabled row-level guards; rejects disabled, altered, missing or unexpected statement-level guards; then creates **only** missing TRUNCATE guards. A repeated execution is a no-op. It never creates/drops financial tables, changes receipt state, updates amounts, or rewrites historical migrations. Schema drift fails closed. The original baseline remains untouched.

**Important:** the upgrade is deliberately **not applied automatically** by app startup, app:build or contract evolution. Review the SQL and a verified database backup; rehearse on a restored, populated copy; use a separately authorized migration identity during a controlled maintenance window. A previously deployed DB's own migration history must not be rewritten. The SQL does not remove table-owner privileges or protect against a superuser/owner who can disable triggers; separate runtime and migration roles are still required. Only the three historical guard definitions are supported.

## Reproduce

In a trusted checkout with the pinned toolchains and Docker:

```bash
npm ci
node --test tests/vnext/provider-envelope-inbox.test.mjs tests/vnext/provider-journal-upgrade.test.mjs
npm run app:build -- examples/vnext/workshop-itemized-guard --target nestjs --out /tmp/pia-upgrade-nest
npm run app:test -- /tmp/pia-upgrade-nest
node scripts/vnext/probe-provider-inbox.mjs /tmp/pia-upgrade-nest
npm run app:build -- examples/vnext/workshop-itemized-guard --target modular-spring --out /tmp/pia-upgrade-spring
npm run app:test -- /tmp/pia-upgrade-spring
node scripts/vnext/probe-provider-inbox.mjs /tmp/pia-upgrade-spring
```

The disposable PostgreSQL probe seeds a candidate, provider envelopes, lifecycle observations, internal receipts and exact balances. It removes only the three TRUNCATE guards to emulate a **populated historical schema**, proves a transactionally rolled-back TRUNCATE would otherwise be permitted, rehearses a rolled-back upgrade, injects a disabled historical row guard and verifies fail-closed rollback, applies the upgrade twice, verifies three active guards, unchanged journal row counts and replay/integrity projections, and rechecks direct/multi-table/CASCADE TRUNCATE denial. All of this runs against isolated databases in both targets.

Expected per-target marker after actual successful CI:
`PROTOCOLIA_S2C1C4K_POPULATED_JOURNAL_UPGRADE_PASS`.

**Status at authoring:** source implementation only. Do not claim PASS, populated upgrade acceptance, or successful CI until the exact PR-head workflows complete and the marker is observed in both PostgreSQL logs. TL-14 #57 stays OPEN for real provider authority, independent clearing, refunds/chargebacks, production IAM/backup and independent business acceptance.
