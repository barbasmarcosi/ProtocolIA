# S2c-1c4n — third-party journal ACL boundary

**Scope:** fail-closed correction to the operator-only S2c-1c4l/m PostgreSQL privilege-isolation artifact. This is synthetic provider evidence, **not** bank-cleared settlement, real provider authentication, refunds or chargebacks. The artifact remains opt-in; it is not run during generation, application startup or normal migrations.

## Risk and invariant

The existing SQL revoked direct journal table privileges only from `PUBLIC` and the selected runtime principal. An unrelated third-party role could retain an explicit `SELECT` or `INSERT` grant on any of the three append-only provider journals after a successful isolation migration. Row/TRUNCATE immutability triggers do **not** prevent unauthorized INSERT. A third party could therefore inspect private evidence or insert fabricated records without using a validated provider entrypoint.

**Invariant:** after the privilege split, only the dedicated migration owner retains direct table privileges on `protocolia_provider_envelope_inbox`, `protocolia_provider_receipt_candidate`, and `protocolia_provider_lifecycle_observation`. The runtime principal may only invoke the five approved SECURITY DEFINER functions. No unrelated role retains direct table privileges. A privileged database administrator remains outside this boundary.

## Implementation

- Reject any non-superuser role that is directly or indirectly a member of the migration-owner role (even with no explicit table ACL): such a principal can use owner-level access. Superusers remain outside the boundary.
- During the preflight, after verifying each journal is owned by the dedicated operator but **before any ALTER/REVOKE/GRANT**, enumerate PostgreSQL ACL entries using `aclexplode(coalesce(relacl,acldefault('r',relowner)))`. Reject **any** unrelated grantee (including future privilege types) with SQLSTATE `23514`. Explicit runtime and PUBLIC grants are allowed solely because the same atomic statement revokes them.
- After revocation, independently verify the effective runtime table privilege set is empty **and** every explicit ACL grantee on each journal is the operator. Rejecting either postcondition rolls back all changes.
- Preserve the previous owner, trusted `public` schema, function owner, row/TRUNCATE guards, advisory/table locks, function EXECUTE restrictions, and read-only provider settlement semantics.

## Reproduction

```bash
npm ci
node --test tests/vnext/provider-envelope-inbox.test.mjs tests/vnext/provider-journal-upgrade.test.mjs tests/vnext/provider-journal-runtime-isolation.test.mjs
npm run app:build -- examples/vnext/workshop-itemized-guard --target nestjs --out /tmp/pia-n-nest
npm run app:test -- /tmp/pia-n-nest
node scripts/vnext/probe-provider-inbox.mjs /tmp/pia-n-nest
npm run app:build -- examples/vnext/workshop-itemized-guard --target modular-spring --out /tmp/pia-n-spring
npm run app:test -- /tmp/pia-n-spring
node scripts/vnext/probe-provider-inbox.mjs /tmp/pia-n-spring
```

The disposable PostgreSQL probe first grants a third-party role membership in the migration owner and requires atomic refusal. It then explicitly grants unrelated roles `SELECT` and `INSERT` on different journals, verifies those grants exist, requires isolation to fail without elevating functions or changing historical rows, and revokes the test grants. It then grants historical direct `PUBLIC SELECT` and runtime `INSERT`, verifies a successful concurrent/repeated isolation removes both, and exercises function-mediated writes, replay, denied direct journal access, rollback and unchanged financial settlement. The new expected marker is `PROTOCOLIA_S2C1C4N_THIRD_PARTY_JOURNAL_ACL_PASS` **on both** generated targets. This marker is an expectation until exact-head CI is inspected; a passing unit test alone is not PostgreSQL acceptance.

## Limitations / next gates

A previously compromised journal cannot be certified by this migration: verify historical data and the provenance of grants independently. The trusted migration owner or database administrator can change grants after the check; production separation requires external access governance, audit and backup/restore procedures. Existing databases with legitimate third-party read grants will now fail closed; review and revoke those grants separately before applying this opt-in SQL. Do not automatically revoke unrelated grants or change production credentials.

TL-14 remains open for independent provider authority, bank-cleared reconciliation, refunds/chargebacks, operational IAM and external acceptance. No production deployment, real payments or stable financial tag.
