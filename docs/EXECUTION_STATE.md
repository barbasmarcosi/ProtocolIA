# ProtocolIA — Execution State

Updated: 2026-10-10. P0, P1 and the bounded P2 Java/Spring service are MERGED and verified.

## Merged baseline

- ProtocolIA main P2 code merge: 2df9dc77cb76ab10d70ecc1a10a4d95c28b38468 (PR #13); Java ADR merged via PR #12.
- ProtocolIA-Test main consumer P2 merge: ab705513fed5c5071737f6288b4be791456fd75f (PR #5).
- ProtocolIA source HEAD before merge: 5b4f16733acd1dc6f14b1dec51aa22cd2d48ece7; full tests on exact SHA: https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088656004 (HTTP/PostgreSQL/JUnit/Testcontainers), https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088655993 (Java Maven), https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088655983 (P0/P1 quality), https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38088652081 (OpenAPI Generator Spring reference); all success.
- Independent ProtocolIA-Test commit 2c78ca2167dab7ab33dd043dca8d82272dbca963: https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38088760781 (HTTP/PostgreSQL) and https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38088760657 (regressions); both success.
- Later documentation commits need their own checks; do not treat previous runs as proof for a different exact SHA.

## Gate status

| Gate | State | Verified scope |
| --- | --- | --- |
| P0 | COMPLETE | Provider-free Python compiler, deterministic artifacts, protected regeneration and external format validation |
| P1 | COMPLETE | Normative v0.1/v0.2 contracts, executable data checks, compatibility and controlled migration |
| P2 | COMPLETE — bounded | Generated Java 21/Spring Boot 4.0.2/Maven backend, Spring HTTP and PostgreSQL sales, JUnit 5/Testcontainers and independent downstream CI |
| P3 | NOT STARTED | Safe typed agent action IR, runtime effects, permissions, budget/evidence/replay |
| P4 | NOT STARTED | Independently evaluated matched A/B/C coding-agent cost-per-verified-success |
| P5 | NOT STARTED | Controlled real-project pilots |
| P6 | NOT STARTED | Release/no-go evidence and stability |

## What P2 actually demonstrates

- Generic generated Spring controllers explicitly return 501 for business behavior not implemented.
- An explicitly recognized inventory-sale contract generates an ACTUAL service: request validation, Spring Security with 401/403, JDBC transaction, atomic PostgreSQL stock decrement, SQL constraints, idempotency-key replay/conflict, rollback and concurrent oversell prevention.
- Generated JUnit5/Testcontainers tests exercise transaction rollback, concurrent sales and repeat-key replay on disposable PostgreSQL. Independent consumer checks equivalent HTTP behavior using its own contract, including unknown-field rejection.
- All Java model fields must use supported v0.2 constraint semantics; currently optional/null and scalar enum mapping fail closed rather than being emitted incorrectly.
- Spring security identities are environment-configured for test/dev use with bcrypt and a viewer role. No production OIDC/TLS policy or network perimeter is guaranteed.
- Flyway migrations default OFF and are only enabled by an explicit flag in CI ephemeral databases. No production DDL executed. No general approval workflow for destructive migrations is claimed.
- Output hash manifest prevents common unmanaged/manual-edit overwrite patterns but is not cryptographic attestation or race-free hostile filesystem isolation.
- Conventional OpenAPI Generator Spring Boot 4 was generated from the SAME emitted OpenAPI as a baseline scaffold. No independently matched economic superiority, model-token/USD savings or universal business-rule synthesis is claimed.

## Next

P3: separate typed action DAG and constrained executor with actual budget/capability enforcement and replay/evidence validity. P4: preregister held-out tasks comparing direct agent, normal generator, ProtocolIA; count all-in cost per independently verified success and correctness/security.

See ROADMAP.md, ADR-002-JAVA-BACKEND.md and P2-BASELINE.md. This file is the execution record, not a promise of work completed beyond these gates.
