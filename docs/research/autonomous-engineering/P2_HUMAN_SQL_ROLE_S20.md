# P2 / S2.0 — per-human SQL identity proof (candidate only)

**Status:** experimental operator-only SQL, not production migration, not an HTTP per-human connection router. Existing S1 (#167) continues to run unchanged.

## Motivation

The maker-checker SQL guard in v0.7 relies on `current_setting('protocolia.subject', true)`. It is set by authenticated HTTP code for the normal application path, but **a caller controlling a tenant PostgreSQL connection can set that same GUC**, and the original maker guard cannot independently identify the human. S1 RLS pins the *organization* to a SQL login but does not solve this per-human identity problem.

PostgreSQL documents that `session_user` ordinarily represents the authenticated SQL login, whereas `current_user` changes in `SECURITY DEFINER` functions or via `SET ROLE`. Session-local parameters and `set_config` are alterable where allowed. See <https://www.postgresql.org/docs/16/functions-info.html> and <https://www.postgresql.org/docs/16/config-setting.html>.

## S2.0 experiment

Both NestJS and modular Spring generators now emit **the same** `protocolia-subject-role-guard-candidate.sql` from the reviewed single-entity, seven-operation `v0.7` tenant+maker-checker TypeSpec profile.

The candidate can only be applied by the separate, non-superuser S1 schema owner, after S1 RLS and the maker-checker guard are installed. It refuses unknown/replayed state, wrong tenant-to-principal mapping, missing SQL checker roles, unsafe privilege elevation, role membership, or missing forced RLS. Application startup, Flyway and Nest baseline migrations **never apply it**.

In an isolated four-principal experiment, the operator provisions **one maker and one checker LOGIN in each of two organizations**:

| Organization | Authenticated SQL role | Operator-verified human subject |
|---|---|---|
| Alpha | `protocolia_rls_alpha` | `alpha-maker` |
| Alpha | `protocolia_s2_alpha_checker` | `alpha-checker` |
| Beta | `protocolia_rls_beta` | `beta-maker` |
| Beta | `protocolia_s2_beta_checker` | `beta-checker` |

These are **disposable test examples**, not identities for customer deployment. Production names and subject IDs must be operator-managed and tied to verified IdP subjects. SQL bindings are stored in a new migration-owner-only table with unique subject per organization.

A restricted `SECURITY DEFINER` lookup uses **`session_user`** and the S1 private tenant mapping, not `protocolia.subject` or a client-provided actor. Extra PostgreSQL triggers independently check:

1. State submission must identify the SQL-login-bound human as maker.
2. Terminal decision must identify a different SQL-login-bound human from the stored maker; changing the session GUC to the checker's name is insufficient.
3. An inserted audit event's `actor` must match that same login-bound human.

The existing S1 tenant RLS policies are explicitly extended to two additional independently authenticated checker roles. They receive limited SELECT/INSERT/UPDATE on the business table, INSERT-only on audit, sequence usage, and EXECUTE on private subject/tenant lookups. No table ownership, membership escalation or private mapping-table access is granted. PostgreSQL login roles are never taken from headers, request bodies or arbitrary JWT claims.

## Evidence/acceptance

`.github/workflows/p2-tenant-rls-role-candidate.yml` compiles the same TypeSpec source for both generators, checks candidate byte parity and excludes it from automatic migrations. In a **disposable PostgreSQL 16** instance, the S2 shell proof:

- Rejects activation without distinct SQL checker logins.
- Rejects a forged maker transaction GUC, and rejects a forged checker GUC that would bypass the original v0.7 trigger.
- Permits an actual independent human checker in Alpha and Beta.
- Rejects self-approval even if the submitter falsifies `protocolia.subject`.
- Rejects forged audit `actor`, SQL role switching, and reads/updates of the human identity mapping.
- Verifies persisted business states and audit organization columns with an independent admin query.

Only the marker `PROTOCOLIA_S2_ROLE_PINNED_HUMAN_DB_PROOF_PASS` on a successful real-Postgres CI job constitutes proof of those claims.

## Important limitations

**HTTP apps continue using S1 tenant-level pooled connections.** They cannot use this S2 candidate as-is, since each tenant pool would represent only one human. Enabling S2 triggers against those shared pools would reject otherwise valid legitimate HTTP operations. Do not combine this candidate with S1 production deployment. S2.1 must introduce verified IdP subject -> independently authenticated SQL principal routing, per-subject pool lifetime and quotas, credential rotation/revocation, strict refusal on unexpected subjects and tenant associations, no authorization from client-supplied IDs, and actual concurrent Nest/Spring HTTP acceptance tests.

**Audit authenticity is still incomplete:** a SQL principal can INSERT a fictitious event *using its true human actor* and manipulate description/content. The candidate prevents impersonating another human but is not tamperproof event nonrepudiation or verified causal event provenance. That needs transactional, database-controlled audit emission with append-only policy and vetted, least-privilege API functions. Superuser/migration-owner compromise, revoked-access reuse, tenant-specific FKs and migration of existing data are out of scope.

The profile is not a generalized multi-tenant system or production-grade IdP integration. Preserve issue #57 and do not make a production claim.
