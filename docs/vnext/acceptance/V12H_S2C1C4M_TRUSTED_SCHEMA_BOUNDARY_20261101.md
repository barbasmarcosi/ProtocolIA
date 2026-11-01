# S2c-1c4m — trusted namespace boundary for provider SECURITY DEFINER

**Scope:** additive hardening of the optional S2c-1c4l synthetic provider-journal privilege isolation artifact. No actual provider authentication, external settlement, refund, bank reconciliation, live migration, or financial operation is authorized or claimed.

## Risk and root cause

The previous isolation script converted five canonical provider functions to `SECURITY DEFINER` with `search_path = pg_catalog, public, pg_temp`. It checked `CREATE` on `public` for the runtime and `PUBLIC`, but **not a third-party login/group granted CREATE**. Such a role could create objects in a trusted function lookup namespace even when the runtime itself could not create anything. Separately, an unrelated owner of the `public` schema could grant `CREATE` after a one-time check. This violates the privilege boundary assumed by the generated functions.

## Behavior change

Before any function is elevated or ACLs changed, the operator-reviewed SQL now requires:

1. The `public` schema is owned by the same dedicated, non-elevated migration principal that owns all six canonical provider functions and three journals.
2. **No explicit CREATE grant on public** exists for any other principal, including `PUBLIC`, a currently unused third-party login, or an inherited group. The owner's implicit CREATE is permitted.
3. Existing role, row/TRUNCATE trigger, function-owner, journal-owner, locking and postcondition checks from S2c-1c4l still apply.

Any violation raises SQLSTATE `23514` and the single atomic `DO` statement does not elevate functions or change grants. This is intentionally fail-closed: databases with the default `pg_database_owner` ownership of `public` may **not** qualify. A schema ownership change must be independently reviewed and rehearsed, not performed automatically by ProtocolIA. A trusted administrator/superuser still controls the database and can bypass these measures; no claim of production-grade provider evidence is made.

## Reproduction

```bash
npm ci
node --test tests/vnext/provider-envelope-inbox.test.mjs tests/vnext/provider-journal-upgrade.test.mjs tests/vnext/provider-journal-runtime-isolation.test.mjs
npm run app:build -- examples/vnext/workshop-itemized-guard --target nestjs --out /tmp/pia-m-nest
npm run app:test -- /tmp/pia-m-nest
node scripts/vnext/probe-provider-inbox.mjs /tmp/pia-m-nest
npm run app:build -- examples/vnext/workshop-itemized-guard --target modular-spring --out /tmp/pia-m-spring
npm run app:test -- /tmp/pia-m-spring
node scripts/vnext/probe-provider-inbox.mjs /tmp/pia-m-spring
```

The real disposable PostgreSQL probe, for **each generated backend**, must reject (a) an unrelated owner of `public`, (b) a separate role with an explicit `CREATE` grant, and (c) `PUBLIC CREATE`, while preserving `prosecdef=false` after each rejected attempt. In the `PUBLIC CREATE` case the existing effective runtime-privilege guard rejects first (because the runtime inherits `PUBLIC`); the unrelated-role case exercises the new all-grantees check. It then restores the trusted namespace, executes the preexisting rollback/concurrent/idempotent privilege-isolation scenarios, and proves valid function-mediated first-time writes, replay, denied direct journal DML/DDL, and unchanged settlement state. Expected additional log marker: `PROTOCOLIA_S2C1C4M_TRUSTED_SCHEMA_BOUNDARY_PASS`. This marker is an **acceptance expectation**, not proof until exact-commit CI logs show it for Spring and NestJS.

## Operational boundaries and next gates

Do not automatically transfer ownership of an existing production `public` schema: doing so can affect unrelated applications, extensions, privileges and migrations. Prefer a separately reviewed database or a future dedicated schema with fully qualified generated SQL. The opt-in artifact is not applied on build, startup, or ordinary contract evolution.

TL-14 remains open for real provider authority, independent cleared settlement, refunds/chargebacks, production IAM/backup, and external business acceptance. No production deployment, real payments, or stable financial tag.
