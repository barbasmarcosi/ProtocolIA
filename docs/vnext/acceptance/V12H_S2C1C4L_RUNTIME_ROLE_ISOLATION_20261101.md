# S2c-1c4l — provider journal runtime privilege isolation (operator opt-in)

**Purpose.** Separate a low-privilege generated application database identity from the owner/migration principal for the *synthetic* provider inbox, receipt-candidate and lifecycle journals. This does **not** verify a real provider, settle money, implement refunds, or authorize production deployment.

## What changes

Both Spring and NestJS now emit `protocolia-provider-journal-runtime-isolation.sql` alongside the prior operator-reviewed populated journal upgrade, only for a canonical exact-ledger contract that opts into the provider inbox. Neither script is automatically executed by app build, startup or normal contract evolution.

The script requires an **existing unprivileged runtime role**, supplied through a transaction-local PostgreSQL setting. It checks that a dedicated **non-superuser, non-elevated migration owner** owns all three provider tables and all six functions, that row-level and statement-level immutable triggers are enabled and correctly bound, that the runtime is not the owner or a member of the owner role, that the runtime cannot CREATE in public, and that public schema CREATE is not granted to PUBLIC. A transaction-scoped advisory lock plus NOWAIT table locks serialize changes and avoid a partial privilege transition.

On success it revokes PUBLIC and direct runtime privileges on the three journals, grants only schema USAGE, revokes PUBLIC function EXECUTE and grants runtime EXECUTE only on five canonical parameterized write/read functions. These five functions become SECURITY DEFINER with a pinned `pg_catalog, public, pg_temp` search path. The immutable trigger function is not callable by runtime. A final effective-privilege check detects inherited table grants and aborts the entire transaction. No table DML or settlement authority is granted to runtime. A privileged owner/superuser still has authority to alter triggers; this is not a substitute for independent administration, backups or audit.

## Reproduce (disposable generated databases)

```bash
npm ci
node --test tests/vnext/provider-envelope-inbox.test.mjs tests/vnext/provider-journal-upgrade.test.mjs tests/vnext/provider-journal-runtime-isolation.test.mjs
npm run app:build -- examples/vnext/workshop-itemized-guard --target nestjs --out /tmp/pia-acl-nest
npm run app:test -- /tmp/pia-acl-nest
node scripts/vnext/probe-provider-inbox.mjs /tmp/pia-acl-nest
npm run app:build -- examples/vnext/workshop-itemized-guard --target modular-spring --out /tmp/pia-acl-spring
npm run app:test -- /tmp/pia-acl-spring
node scripts/vnext/probe-provider-inbox.mjs /tmp/pia-acl-spring
```

The disposable PostgreSQL test uses a separate runtime role and verifies: missing/elevated identity rejection; disabled TRUNCATE guard rejection; full rollback of a valid rehearsal; inherited-grant rejection with no partial function changes; concurrent operator application and repeat; denied direct SELECT/INSERT/UPDATE/DELETE/TRUNCATE, ALTER FUNCTION and schema CREATE; successful replay-safe entrypoints and read-only integrity projection through SECURITY DEFINER; unchanged financial state.

Expected marker **only after real successful execution** in each generated target: `PROTOCOLIA_S2C1C4L_RUNTIME_ROLE_ISOLATION_PASS`.

## Operator application contract (not an instruction to run in production)

Only after an independently verified backup, a restored rehearsal, an approved maintenance window and creation of a separate runtime role:

```sql
BEGIN;
SET LOCAL protocolia.provider_runtime_role = 'precreated_unprivileged_role';
-- Execute the reviewed generated protocolia-provider-journal-runtime-isolation.sql
-- in THIS transaction and connection (psql: \i path/to/file.sql).
COMMIT;
```

The operator must separately provision the migration owner's minimal read access to referenced receipt tables and control schema ownership/USAGE; do not make a superuser the owner of SECURITY DEFINER functions. A normal generated database owner is often a superuser in disposable test stacks and must not be reused as the migration owner for this operation. The operator must configure the deployed application's **database connection** to use that runtime role separately; merely applying the SQL does not switch application credentials. The generated application still needs its domain-table permissions provisioned by the operator; this script intentionally changes only the synthetic provider-journal privilege boundary. If the runtime role inherits journal privileges from another group, the operation rejects rather than silently weakening isolation.

**Remaining TL-14 blockers:** provider-authoritative identity/settlement evidence, independent reconciliation, real refunds/chargebacks, production tenancy/IAM, durable backup/restore, external customer acceptance and real deployed upgrade. Keep [issue #57](https://github.com/barbasmarcosi/ProtocolIA/issues/57) open. No live payments, production deployment or financial release tag.
