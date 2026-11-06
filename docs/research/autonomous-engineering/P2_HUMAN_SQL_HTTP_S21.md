# P2 / S2.1 — JWT-authenticated per-human PostgreSQL connection routing

**Status:** experimental, opt-in, restricted `v0.7` tenant+maker-checker workflow; never enabled for default generated applications. Only merge after direct generated NestJS and Spring HTTP + disposable PostgreSQL acceptance.

## Operator execution model

S2.0 added a verified PostgreSQL `session_user` → human subject mapping that can reject forged maker/checker session settings and forged audit actors. S2.1 connects that database authority to real generated applications:

- `PROTOCOLIA_TENANT_SQL_ROUTING=human-jwt-v1`;
- `PROTOCOLIA_EXECUTION_MODE=runtime` (one-shot migrator is separate);
- `PROTOCOLIA_AUTH_MODE=jwt`, with an independently verifiable issuer/audience and RS256 JWKS; Basic/demo auth and BFF sessions are forbidden in this bounded profile;
- `PROTOCOLIA_S2_HUMAN_SQL_BINDINGS_JSON` set by the deployment operator (secret): exactly four records `{tenant,subject,user,password}`, two independently authenticated human SQL LOGIN principals per organization. SQL names, subjects and passwords are never taken from HTTP, request headers, or unsigned/unverified claims;
- the ordinary runtime DB login must be exactly one of these four subject-bound roles. No privileged migration connection or background worker runs in the HTTP process. No unconfigured subject, third organization, role inheritance, CREATE privilege, or SQL role fallback.

Both backends verify the four connections **before serving traffic**, checking `session_user=current_user=operator-bound login`, tenant from the S1 owner-only mapping, human subject from the S2 owner-only mapping, forced RLS on both business and audit tables, absence of elevated grants/memberships and inability to read audit or DELETE rows. The alternative `alpha-beta-v1` S1 profile is preserved and disabled by default.

In NestJS, all reviewed business queries and transaction checkouts use a distinct `pg.Pool` selected inside `AsyncLocalStorage` from the independently verified JWT subject and tenant. Spring installs a no-fallback `AbstractRoutingDataSource` over four independently credentialed Hikari pools, selecting the key from the `JwtAuthenticationToken` in the Spring Security context before transactional JDBC connection acquisition.

## Security and test acceptance

The focused GitHub Actions flow constructs fresh random local PostgreSQL roles, operator-only S1 and S2 SQL mapping, separate NestJS and Spring generated binaries, and a disposable RS256 key + JWKS server. Real HTTP requests with signed JWTs exercise:
- Alpha/Beta maker-submit and another independently authenticated checker-decision, with no cross-tenant access;
- refusal of maker self-approval despite checker permissions and rejection of concurrent duplicate decisions;
- rejection of unconfigured human subjects or JWT tenant/subject combinations, expired tokens and spoofed tenant HTTP headers;
- tenant-specific listing/count and audit records attributed to all four independent SQL-login human subjects.

A success marker `PROTOCOLIA_S2_JWT_HUMAN_SQL_HTTP_PASS` for *each* target must come from its actual PostgreSQL-backed HTTP test. The previous S1 role-RLS, SQL S2 human and source-bound regression suites also remain mandatory.

## Deployment and threat limits

**Not production readiness.** Operator-managed per-user DB login passwords are an experimental trust anchor with significant connection scaling, rotation, revocation, availability, backup and credential custody consequences. The four-person fixed profile is intentionally finite; it is not an enterprise IdP membership or general-tenant model. A signed `protocolia_tenant` claim proves only what the trusted configured issuer asserted, not that a separate live directory/SCIM/organization system has checked current membership, deletion or suspension. Production requires delegated, revocable authorization and a verified tenant membership adapter.

An SQL role still can fabricate a fictitious audit event **using its own actual subject**; S2.1 prevents impersonation and preserves in-transaction application audit, but does not guarantee causal event validity/nonrepudiation against compromised SQL accounts. Long-term solution requires DB-controlled audit emission and constrained execute-only application DML. Historical non-empty audit migrations are not automated. No external settlement/recovery certification, no additional entity joins/FK tenant scoping, and no privileged DBA compromise mitigation. Keep #57 open.

## Startup guard integrity (S2.1 hardening)

A verified PostgreSQL login and forced business/audit RLS are **not enough** if a privileged migration disables the human maker guard or the audit actor trigger. Both generated HTTP runtimes also inspect PostgreSQL's system catalogs before startup, requiring the exact two enabled, unconditional BEFORE ROW trigger/function bindings, the expected UPDATE/INSERT event mask, and function ownership matching the corresponding protected table. A missing, disabled, event-rewritten or alternate-function trigger refuses startup. The CI deliberately disables each trigger independently using a disposable owner connection; the generated NestJS and Spring process must refuse HTTP, and then pass full signed JWT human-SQL E2E after the owner restores both guards. This does not protect against a compromised migration owner that replaces function bodies with malicious code; migration artifact signing and privilege separation remain required.
