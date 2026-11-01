# S2c-1c4o — distinct provider-ingress DB principal (opt-in)

**Status: candidate; final-head CI pending after an additional negative financial-ACL assertion.** This changes only the generated, operator-reviewed PostgreSQL role-isolation artifact, not production credentials or settlement state.

## Risk and invariant

The prior S2c-1c4n opt-in isolation removes direct journal DML from the application runtime, but still grants the **same** DB principal EXECUTE on three `SECURITY DEFINER` journal writers. A compromised general app connection can therefore insert *synthetic* events without passing through the HTTP HMAC verifier. Those events are not bank-cleared, but their fabrication compromises the synthetic evidence trail.

An operator can now additionally supply `protocolia.provider_ingress_role` in the same transaction as `protocolia.provider_runtime_role`. When explicitly configured, the general runtime may execute **only** the two read-only diagnostic projections; the separately provisioned ingress principal may execute **only** the three journal-writing functions. Neither role may read/write the journal tables directly. Neither application runtime nor ingress role receives payment write privileges from this artifact; the separately authorized migration owner retains its existing privileges.

The default one-role mode remains backward compatible, but does **not** close this trust-boundary risk. Reapplying that legacy mode after a split fails closed instead of silently restoring writer rights.

## Preconditions and operational limits

- Run only after the S2c-1c4k populated-journal upgrade, with a verified backup and restore rehearsal. Use a dedicated non-superuser migration owner of the trusted `public` schema, provider tables and functions.
- Precreate two **different**, nonprivileged PostgreSQL roles, with no inherited migration-owner privileges, schema CREATE or untrusted members of the ingress role.
- Example inside a separately authorized operator transaction:

```sql
BEGIN;
SET ROLE protocolia_migration_owner;
SET LOCAL protocolia.provider_runtime_role = 'protocolia_runtime';
SET LOCAL protocolia.provider_ingress_role = 'protocolia_webhook_ingress';
-- Execute the generated protocolia-provider-journal-runtime-isolation.sql here.
COMMIT;
```

- **Do not apply this split to a deployed generated application until its signed webhook path is configured to use a distinct, securely managed ingress DB connection.** Current generated Spring/Nest HTTP paths do not automatically select that credential; applying it prematurely would deliberately deny their writes. This PR does not provision credentials or modify deployed connection pools.
- This boundary trusts the webhook-ingress connection to have already authenticated an incoming payload. PostgreSQL cannot infer HMAC validity from the provided event fields. No provider authority, cleared settlement, real refund or chargeback is asserted.

## Test matrix (to be verified on PR head)

The existing dual-target provider workflow builds Spring and NestJS from the unchanged workshop TypeSpec and runs `scripts/vnext/probe-provider-inbox.mjs` against disposable PostgreSQL. New checks assert:

1. Same role, schema CREATE and third-party ingress-role membership rejected without partial privilege changes.
2. A valid operator transaction rolled back leaves the old grants intact; two concurrent operator transitions and repeated application converge.
3. Runtime journal writer calls are denied; runtime read-only projections still work.
4. Ingress journal writes, replay and conflict classification work; ingress direct table access and diagnostic projections are denied.
5. Reapplying the legacy one-role SQL after separation is rejected without a privilege downgrade.
6. Ingress transaction rollback leaves no envelope; both low-privilege roles are denied direct settlement updates, and payment settlement remains `unverified`.

Unit tests check deterministic SQL, expected fail-closed branches and role separation. Real PostgreSQL, HTTP, prior finance and itemized regressions must all pass before merge.

## Remaining TL-14 blockers

Independent provider authority and signed real-provider integration; independent cleared-settlement reconciliation; refunds/chargebacks; end-to-end ingress credential wiring for generated HTTP; production IAM, backups and external acceptance. Keep [issue #57](https://github.com/barbasmarcosi/ProtocolIA/issues/57) open.

## Observed initial CI (before final negative assertion)

Functional SHA `53e7ec47c0d559031ca138023614f5b540f1f94a`: four PR workflows completed successfully, including [provider conformance #41290777972](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41290777972). Its two real PostgreSQL job logs contain `PROTOCOLIA_S2C1C4O_INGRESS_RUNTIME_SPLIT_PASS` for NestJS and Spring. [Quality #41290778126](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41290778126), [finance #41290778085](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41290778085) and [itemized #41290777975](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41290777975) also passed. A subsequent test-only assertion now explicitly checks direct settlement-write denial for both roles; its final-head CI is not yet claimed.
