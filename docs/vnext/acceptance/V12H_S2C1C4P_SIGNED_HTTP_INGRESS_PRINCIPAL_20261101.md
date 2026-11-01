# S2c-1c4p — Signed sandbox HTTP through distinct PostgreSQL ingress principal

**Status: implemented in feature branch; acceptance pending real dual-target CI.** This is a bounded, demo-only security hardening, not provider/bank settlement authority.

## Threat and invariant

The operator-reviewed S2c-1c4o SQL can revoke journal writer functions from the general application principal and grant them only to a dedicated webhook-ingress principal. Until this increment, the generated Spring and NestJS HTTP handlers still used the general application's SQL connection. Applying the SQL split would cause signed HTTP requests to fail, while retaining the legacy grants would leave general runtime SQL able to fabricate synthetic evidence.

Both generators now optionally accept `PROTOCOLIA_PROVIDER_INGRESS_JDBC_USER` and `PROTOCOLIA_PROVIDER_INGRESS_JDBC_PASSWORD` (mapped from `PROTOCOLIA_PROVIDER_INGRESS_DB_USER/PASSWORD` in generated Compose). They create an independent connection limited to the three **HMAC-verified sandbox HTTP** journal writer calls. All ordinary application queries, migrations, notifications and read-only projections continue to use their existing connections. The Nest target uses a bounded independent `pg` pool; the Spring target uses independent, short-lived JDBC connections. Neither uses a superuser or reuses the migrator identity for ingress.

The optional mode fails closed when credentials are incomplete, the target lacks the provider inbox, sandbox/demo is disabled, the ingress user equals runtime/migrator, or the password is too short. On startup, each generated app queries PostgreSQL to prove the ingress principal is the expected non-superuser with writer but no direct journal insert or diagnostic reader access, and the general runtime has **no** journal writer EXECUTE. A missing/misapplied operator ACL split prevents startup rather than accepting webhooks under the wrong DB identity.

## Operator prerequisites (not automatically applied)

1. Generate the application and review the S2c-1c4k populated-journal upgrade and S2c-1c4o role-isolation SQL. Rehearse backup/restore on a disposable DB.
2. Create three different roles: non-superuser trusted migration owner, general runtime, and ingress. Only the migration owner may own the trusted schema and journal functions. The ingress must not inherit owner privileges, hold CREATE on `public`, or receive direct journal table grants.
3. Apply the **generated** `protocolia-provider-journal-runtime-isolation.sql` in an operator transaction, with `SET LOCAL protocolia.provider_runtime_role` and `SET LOCAL protocolia.provider_ingress_role` set to the reviewed roles.
4. Configure both runtime/migration credentials and the separate ingress credentials through a secrets manager or the local disposable test environment. Never place real secrets in TypeSpec, Git, CI logs or the generated application.
5. Enable `PROTOCOLIA_PROVIDER_SANDBOX_ENABLED=true` and `PROTOCOLIA_AUTH_MODE=demo` only for isolated test environments. The HMAC verifier remains mandatory and signs original raw bytes.

**No production deployment, migration, real provider call or financial operation is authorized by this feature.** PostgreSQL role separation cannot establish that a provider is genuine or that any funds were cleared.

## Reproduction and expected evidence

The existing CI matrix runs against `nestjs` and `modular-spring`:

```sh
npm run app:build -- examples/vnext/workshop-itemized-guard --target nestjs --out /tmp/protocolia-nest
npm run app:build -- examples/vnext/workshop-itemized-guard --target modular-spring --out /tmp/protocolia-spring
node scripts/vnext/probe-provider-http.mjs /tmp/protocolia-nest
node scripts/vnext/probe-provider-http.mjs /tmp/protocolia-spring
```

Each HTTP probe starts disposable PostgreSQL, proves the historical HMAC/replay/candidate/lifecycle behavior, transfers only the provider journal ownership to a trusted test migration role, applies the actual generated opt-in SQL split, and restarts the **generated app** with different runtime, migration and ingress credentials. The new marker `PROTOCOLIA_S2C1C4P_SIGNED_HTTP_DISTINCT_DB_PRINCIPAL_PASS` is emitted only after: runtime direct writer denied, 10 concurrent signed HTTP replays produce exactly one stored event, bad signatures rejected, signed candidate/lifecycle accepted and deduplicated, an interrupted ingress transaction rolls back and can be retried over HTTP, restart preserves replay identity, and the payment settlement state remains `unverified`.

Prior tests also cover PostgreSQL role inheritance, ACL downgrade, immutable journals and populated migrations. This probe does not test externally authenticated bank providers, external refunds, real chargebacks, production IAM or backups.

## Remaining TL-14 blockers

Provider-authoritative identity and event semantics; independent cleared-settlement reconciliation; real refunds/chargebacks and negative adjustments; operational credentials, tenant isolation, backup/restore and external acceptance. Keep [#57](https://github.com/barbasmarcosi/ProtocolIA/issues/57) open.
