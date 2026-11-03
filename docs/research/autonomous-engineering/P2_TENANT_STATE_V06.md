# P2 — Tenant-state v0.6: first bounded organization scoping proof

## Status

Experimental **opt-in** for one state-only entity and 7 fixed operations. Does **not** replace maker-checker v0.5, does **not** implement PostgreSQL RLS, and is not a general multi-tenant platform.

## Authentication trust boundary

New grammar `protocolia-operator-assembly/v0.6` requires `authorizationProfile=tenant-state/v1`. Capabilities are pinned to `<entity>.read.tenant` and `<entity>.write.tenant`, not agent-defined or client-controlled. The generated runtime takes `protocolia_tenant` only from a signature-verified, issuer-and-audience-checked JWT. Missing or invalid tenant is rejected with 401 before CRUD. Browser BFF / OIDC sessions without an accessible verified tenant claim are not yet supported for this profile and fail closed.

For isolated local Docker CI with explicitly enabled demo authentication, the server maps the *authenticated demo principal* to tenant `org_alpha` or `org_beta` through test-only environment configuration; it does not read an arbitrary tenant header, path, query, or request body. This is test evidence, not enterprise tenant membership validation.

## Data boundary

Both generators add server-only `protocolia_tenant_id VARCHAR(64) NOT NULL`, absent from public TypeSpec and request bodies. CREATE populates the column from the verified tenant. GET uses tenant and identity predicates; LIST uses the same tenant predicate for both items and count/pagination; state UPDATE includes tenant and expected state atomically. Cross-tenant direct lookup or transition returns 404 so it does not disclose whether a foreign identity exists. The existing state audit is generated from the executed transition within the same transaction; this profile exposes no audit-read endpoint.

The PostgreSQL guard prevents UPDATE from changing the tenant key and rejects direct DELETE and TRUNCATE for this append-only, state-only profile (no delete transition exists). An independent-session psql proof attempts tenant reassignment, DELETE and TRUNCATE, then checks that the original tenant and row count are unchanged. **This does not prevent a privileged DB principal from bypassing or dropping the guard, querying across tenants, or inserting rows with arbitrary tenant IDs**: row-level security, database role separation and explicit tenant boundaries for audit/query/joins remain future work.

## Test acceptance

The generated tests use a manager in org_alpha and a peer in org_beta with identical business read/write grants. They create distinct records and prove: successful same-tenant create, GET, LIST and state transitions; cross-tenant GET 404 in both directions; no foreign records in LIST nor its count; cross-tenant transition 404 in both directions; spoofed `X-ProtocolIA-Tenant` header changes nothing; ten same-tenant concurrent transitions produce one success and nine conflicts. Every test runs in independent NestJS/Spring generated applications against isolated PostgreSQL. An additional independent psql session verifies immutable tenant reassignment, denied DELETE and denied TRUNCATE, and preserved row count.

Existing v0.3, v0.4 and v0.5 are unchanged and remain in CI as regression jobs. Two separate source vocabularies (ServiceTicket and ReviewCase) are validated by unit tests; E2E matrix uses ServiceTicket.

## Explicit limits before production

- No DB RLS, dedicated runtime/migration roles, tenant-scoped audit queries, tenant-scoped joins, provider inbox isolation, multi-entity FK containment, or per-organization key namespaces.
- No proof of verified organization membership beyond the signed issuer assertion; the upstream issuer must be trusted to assign membership.
- Maker-checker and tenant isolation are **separate profiles** today and cannot be silently combined. v0.6 has the original state-only write policy; do not use it for approval flows requiring v0.5 maker-checker.
- The public identity is globally unique within the generated table. The two organizations in tests use distinct IDs.
- No external LLM, commercial user authority, real IdP E2E, or production deployment.

Next: a composable versioned tenant+maker-checker profile, trusted issuer+subject+organization reconciliation, per-tenant access to audited events and PostgreSQL RLS with runtime least privilege. Only then claim broad tenant isolation.
