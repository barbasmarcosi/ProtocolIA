# P2 — Tenant + maker-checker v0.7: bounded composition

**Status: experimental opt-in, nonproduction.** Schema `protocolia-operator-assembly/v0.7`, authorization `tenant-maker-checker/v1`. One entity, three audited transitions and seven declared operations. Generated Spring/NestJS backends consume the same contract and PostgreSQL guards.

## Invariants

- Verified signed tenant claim `protocolia_tenant` (issuer/audience checked) and authenticated subject; isolated Docker demo subjects get tenant from server test configuration, never a client header/body/path.
- Public TypeSpec/HTTP inputs omit both `protocolia_tenant_id` and `protocolia_submitted_by`. CREATE binds tenant server-side. GET and LIST/COUNT predicate on tenant.
- Submit and terminal decision use one SQL CAS with **tenant + public identity + previous state + maker identity**. The submitter is set in the same transaction as the transition; decision requires a different authenticated subject. Cross-tenant guesses return 404, self-approval of a visible pending record returns 403, stale transitions 409.
- The generated PostgreSQL maker trigger independently enforces approved state edges and immutable submitter, using transaction-local authenticated `protocolia.subject`. A separate tenant guard forbids tenant reassignment and direct DELETE/TRUNCATE. Both independent-session SQL proofs must pass on both generated engines.
- No unauthenticated default privileges or agent-defined permission strings. This profile does not permit reserve/release, payment, external side effects, extra state edges, multi-entity joins or client-driven tenant selection.

## Isolated test subjects

| Subject | Tenant | Demo capabilities | Intent |
|---|---|---|---|
| manager | org_alpha | read.tenant, write.tenant, submit, decide.checked | Create and check another Alpha identity's submissions; self-decide forbidden |
| reader | org_alpha | read.tenant, submit | Independent Alpha maker with no create/decision grant |
| scoped | org_beta | read.tenant, write.tenant, submit, decide.checked | Prove Beta create/read/submit and cross-tenant denial; self-decide forbidden |

Only in this exact v0.7 isolated demo profile the reader gains submit. Production signed JWT grants are unchanged. The three-subject test **does not prove a positive independent Beta checker decision**.

## Gate

TypeSpec and IR semantic lock, negative privilege/effect/graph tests, real PostgreSQL 16 and HTTP tests for both Java and NestJS, tenant spoof rejection, simultaneous 10-request CAS races, Alpha checker independence, Beta self-decision denial, two independent SQL trigger proofs, and v0.3/v0.4/v0.5/v0.6 plus S2a/S2b/S2c regressions. Pass/fail must come from actual CI logs and never be claimed ahead of execution.

## Limits

**No RLS or tenant-isolated SQL role**: a privileged/unrestricted SQL principal can still query across tenants, insert with arbitrary tenant, alter/drop triggers, and inspect unscoped audit records. No production IdP organization-membership proof, no tenant-scoped audit API, cross-entity FK/joins, production migration, offsite recovery or penetration test. No finance or production deploy. Issue TL-14 #57 stays open.

Next: durable PostgreSQL RLS with least-privilege runtime role, transaction-scoped verified tenant set safely without trusting runtime-written GUCs as authorization, audited event containment, and separate principals inside each tenant.
