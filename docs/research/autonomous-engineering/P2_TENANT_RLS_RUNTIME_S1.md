# P2 / RLS-S1 — experimental runtime SQL routing, bounded two-tenant profile

**Status: Draft; do not deploy, merge or claim HTTP isolation until real tests complete.** Extends RLS-S0 (PR #166) only for the reviewed one-entity v0.7 tenant+maker-checker application. Legacy v0.3–v0.7 behaviour remains off by default.

## Architecture

Operator-only RLS SQL now also guards `protocolia_audit_event`. The audit table must exist, be migration-owner controlled, have no preexisting data or unreviewed grants. It receives an immutable source-derived `protocolia_tenant_id` default bound to the session PostgreSQL LOGIN identity; INSERT-only privileges and FORCED RLS apply. Existing non-empty audit records require an explicit separate backfill/reconciliation; **never silently activate on existing data**.

Runtime opt-in: `PROTOCOLIA_TENANT_SQL_ROUTING=alpha-beta-v1`, `PROTOCOLIA_EXECUTION_MODE=runtime`, no migration credentials in the HTTP process, no BFF, overdue worker or sandbox provider ingress. The only supported target organizations are `org_alpha` and `org_beta`, each with a distinct operator-issued SQL LOGIN. The server requires:
- `PROTOCOLIA_TENANT_SQL_ALPHA_USER` and `PROTOCOLIA_TENANT_SQL_ALPHA_PASSWORD`;
- `PROTOCOLIA_TENANT_SQL_BETA_USER` and `PROTOCOLIA_TENANT_SQL_BETA_PASSWORD`;
- `PROTOCOLIA_JDBC_USER`/`PROTOCOLIA_JDBC_PASSWORD` equal the Alpha role, with no unrestricted base-runtime or migration credential;
- the pinned connection must return the exact session_user/current_user, private principal→tenant mapping, non-elevated privileges and both FORCED RLS policies.

NestJS runs the authorized operation in an `AsyncLocalStorage` context that selects the correct **independent `pg.Pool`**. Every business SQL query and transactional client checkout on the reviewed path uses the context-selected pool, and an unbound SQL call fails rather than reusing Alpha. Other features are unavailable in this bounded profile.

Spring uses a distinct, non-fallback `AbstractRoutingDataSource` backed by **independent Hikari pools**. Routing derives only from the Spring Security-authenticated principal: verified signed JWT `protocolia_tenant` or trusted isolated demo identity mapping. Since Spring Security runs before MVC/@Transactional dispatch, the SQL identity is selected when transaction acquisition obtains a connection; it is never selected from URL, body, request header or arbitrary session settings. Both SQL roles are checked before admitting traffic.

## Acceptance requirements

- Real generated NestJS and Spring PostgreSQL HTTP tests against RLS-enforced roles.
- Test a valid Alpha and Beta maker/decision flow with **two independent subjects per tenant**; reject self-approval, cross-tenant read/count/list/write and identity spoofing.
- Test request concurrency (mixed tenants and same tenant), rollback, reused pools and no tenant state leakage.
- Test SQL-owner/migrator never reaches the HTTP runtime, missing/wrong mapping fails startup, stale/disabled RLS fails startup, unknown org rejects.
- Audit integrity: verified tenant-scoped insert, no cross-tenant audit read/insert, no migration of non-empty audit until a reviewed backfill exists.
- R2 v0.3–v0.7 and cross-language/regression suite must remain green.

## Known security limits

Even with approved routing, shared SQL credentials per organization do **not** give cryptographic per-human maker identity proof in PostgreSQL: the `protocolia.subject` transaction variable used by the maker-checker trigger can be set by a compromised role. HTTP authentication and the same-row CAS still enforce maker separation on the vetted execution path; full DB-adversarial maker identity will need a database-issued identity binding or per-subject authority. An SQL principal with INSERT permission can fabricate audit entries **within its own organization**; this profile enforces organization containment, not event nonrepudiation. Superusers, migration owner, backup/restore, key management and compromised tenant SQL credentials are separate threats. Neither SQL RLS nor this adapter route proves IdP organization membership or full tenant join/FK safety.

No production deployment or general multi-tenancy. Keep issue #57 open. This is a bounded incremental experiment.

## S1.1 adversarial startup acceptance

The disposable generated NestJS and Spring HTTP harness now must prove that both runtimes **refuse to start** under two database authority drifts, before testing a restored healthy startup:

1. A migration owner deliberately maps the Beta SQL login to `org_alpha`. The candidate must reject the resulting identity mismatch and remain offline; owner restores the binding afterward.
2. A migration owner disables RLS on the audit table while business-table RLS stays active. The candidate must refuse startup and remain offline; owner reenables and forces audit RLS afterward.

Both controls require explicit startup-error evidence and a nonresponsive HTTP health route; a slow process without the expected guard failure does **not** pass. Docker containers, roles, credentials and database volumes are removed after testing. The existing positive, real PostgreSQL role-bound HTTP flows must then pass unchanged.
