# P2 / RLS-S0 — PostgreSQL role-pinned tenant isolation, disposable proof

**Status:** experimental **operator-only candidate** emitted for the bounded **tenant+maker-checker v0.7** contract. This is **NOT** an active generated runtime policy, not production migration, not tenant security certification.

## Why not simply use SET LOCAL protocolia.tenant?

PostgreSQL custom session settings can be changed by the connected SQL principal. A policy that trusts `current_setting('protocolia.tenant',true)` may hide rows from a forgotten WHERE clause, but a compromised runtime SQL session can set a different tenant value. Such a policy does **not** independently prove isolation against arbitrary runtime SQL.

This S0 alternative pins the organization to **the authenticated PostgreSQL LOGIN principal (`session_user`)**, in an owner-only mapping table. The read-only lookup is a carefully scoped `SECURITY DEFINER` function. Its `search_path` is pinned and `PUBLIC EXECUTE` is revoked. The runtime principals cannot read or alter the mapping table, inherit migration ownership or change roles. No application-supplied tenant GUC is consulted by the RLS policy.

## Generated artifact and scope

Both NestJS and modular Spring generation emit byte-identical `protocolia-tenant-rls-role-candidate.sql` from the same canonical compiled IR, **only** for one audited state-only v0.7 tenant+maker-checker entity with a reviewed seven-operation graph.

- The SQL is **not** appended to NestJS `src/schema.sql` or Spring Flyway `V1__contract_baseline.sql`; it is deliberately never executed during ordinary generation, app boot, automatic migration or deployment.
- Requires **two separately provisioned LOGIN roles** and a **non-superuser migration owner** owning `public` and the business table; no tenant role may own a schema or table, bypass RLS, create roles/databases, inherit the migration owner or possess `CREATE` on `public`.
- The operator, in one explicit transaction, supplies the two SQL role identifiers, applies the candidate and inserts their authenticated-principal→tenant mapping. The SQL rejects unknown/unsafe identifiers, unreviewed privileges, missing tenant column, mismatched owner, already enabled RLS and reapplication.
- The business table receives SELECT, INSERT and UPDATE policies using the private lookup function; **FORCE ROW LEVEL SECURITY** is enabled. DELETE, TRUNCATE, TRIGGER and REFERENCES are not granted to the tenant logins. The mapping table is owned exclusively by the migrator.
- The candidate does **not** alter the maker-checker triggers, issue JWTs, grant per-tenant HTTP authorities, or provide a tenant-aware DB pool.

## Real verification in disposable PostgreSQL 16

The focused GitHub workflow `.github/workflows/p2-tenant-rls-role-candidate.yml`:
1. Validates the source and old-profile opt-out, compiles the v0.7 TypeSpec contract, confirms both adapter outputs are byte-identical, and rejects silent activation in baseline migrations.
2. Starts a brand-new disposable PostgreSQL 16 container **without publishing a network port**, creates non-superuser SQL logins for the migration owner, Alpha, Beta and an unrelated outsider, and runs the generated SQL.
3. As Alpha, checks own rows visible, Beta rows invisible, no cross-tenant UPDATE/INSERT/reassignment, no DELETE/TRUNCATE, no mapping access or RLS disable, no `SET ROLE` escalation, and spoofed arbitrary `protocolia.tenant` / candidate role settings ineffective.
4. As Beta, confirms symmetrical isolation and own-tenant insert succeeds; outsider cannot read the protected table or execute the private function.
5. Checks forced RLS and final database rows from an independent admin session. The script must reject missing operator bindings and replay. Container cleanup is mandatory on success or failure.

Only an observed success marker `PROTOCOLIA_ROLE_PINNED_RLS_DB_PROOF_PASS` from the real PostgreSQL job qualifies as a passing database proof; unit tests alone do not.

## Security boundary and limitations

This **does not yet integrate RLS into the HTTP applications**. Their current PostgreSQL connections and generated schema are unchanged; do not describe v0.7 as DB-enforced multi-tenant. The role-per-tenant strategy implies an authenticated tenant→connection pool routing mechanism and secure credential lifecycle; those do **not** exist yet. Operators must never apply this candidate to production by improvising per-tenant credentials.

Other deferred requirements: production IdP membership validation, tenant-scoped audit event storage and query, per-organization joins/FK constraints, migration/backfill/idempotence across existing databases, connection pool isolation, incident/recovery drills, and independent positive maker-checker decisions **within Beta**. Superusers and table owners still have privileged pathways (RLS FORCED restricts owner DML but cannot stop ownership changes); tenant role credential theft remains in scope for a later threat model.

**Next RLS-S1:** decide and implement an explicit connection-authority interface for generated apps (authenticated issuer+subject+tenant→scoped SQL role), short-lived/separate credentials, fail-closed connection checkout, no leaked cross-tenant pool state, and tenant-aware audit DML in the same transaction. Only then attach this operator-proven SQL to the generated runtime and repeat NestJS/Spring real PostgreSQL/HTTP and recovery regressions. Leave existing v0.3–v0.7 profiles unchanged until a new version is independently accepted.

No external finance settlement or production authorization is implied; issue #57 remains open.
