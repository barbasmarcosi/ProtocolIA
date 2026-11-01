# S2c-1c4r — Complete provider journal ACL preflight

**Status:** implementation in PR #98; dual-target CI pending until the workflow jobs finish. Synthetic sandbox only, never production provider authority.

## Risk and invariant

The S2c-1c4p startup checks covered the envelope digest writer, a single projection and one journal. They did not detect privilege drift in the receipt-candidate or lifecycle writer, or an unrelated immutable journal. A database role could also gain a `NOINHERIT` membership and use `SET ROLE` without acquiring the privilege through ordinary inheritance.

With the optional distinct HMAC ingress PostgreSQL connection configured, **both generated NestJS and Spring** now refuse HTTP startup unless the following exact matrix holds:

| Capability | General runtime SQL role | Dedicated HMAC ingress SQL role |
| --- | --- | --- |
| Envelope digest, receipt candidate and lifecycle writers (3 functions) | DENY all | ALLOW all |
| Causal and receipt-integrity projections (2 functions) | ALLOW both | DENY both |
| Direct table-level **and column-level** access to all three immutable provider journals | DENY all | DENY all |
| PostgreSQL superuser/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS | DENY | DENY |
| `CREATE` in trusted `public` schema | DENY | DENY |
| Membership in other roles, including non-inheriting `SET ROLE` escalation | DENY | DENY |
| Delegation of either dedicated role to unrelated non-superusers | DENY | DENY |

Missing SQL objects and permission query errors also fail closed. This is a **boot-time** assertion, not a continuous authorization monitor. The original optional/legacy behavior without a distinct ingress connection is preserved for disposable local tests and must not be represented as production-safe.

## Reproduce (disposable PostgreSQL only)

```sh
node --test tests/vnext/runtime-stage.test.mjs
npm run app:build -- examples/vnext/workshop-itemized-guard --target nestjs --out /tmp/pia-provider-nest
node scripts/vnext/probe-provider-http.mjs /tmp/pia-provider-nest
npm run app:build -- examples/vnext/workshop-itemized-guard --target modular-spring --out /tmp/pia-provider-spring
node scripts/vnext/probe-provider-http.mjs /tmp/pia-provider-spring
```

The existing probe creates an isolated Docker Compose project and disposable PostgreSQL database, signs HMAC requests, and performs a one-shot migrator/runtime handoff. S2c-1c4r deliberately grants the ordinary runtime access to a **secondary** receipt-candidate writer, grants ingress both table-level and column-only read privileges on the **lifecycle** journal (separate trials), and grants the ordinary runtime a **NOINHERIT** membership in the ingress role. For each drift, the generated HTTP process must exit before accepting traffic. The probe then restores permissions, restarts the exact pinned image, confirms replay remains idempotent and the synthetic receipt remains `unverified`, and destroys the disposable database.

Expected marker **only after observed success**: `PROTOCOLIA_S2C1C4R_COMPLETE_ACL_BOOT_PREFLIGHT_PASS` for each independently generated target. Existing positive HMAC/concurrency, migration handoff, exact finance and browser regression suites remain required.

## Scope not established

No independently verified external provider, cleared bank settlement, refund or chargeback, production tenant IAM, external backup/restore, live payment, production deployment or stable financial tag. Issue #57 (TL-14) remains open.
