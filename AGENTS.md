# ProtocolIA — Guidance for coding agents

## Current priority (2026-10-13)

The primary engineering mission is **contract-to-working-app vNext**, not
token savings, P4 benchmarks, repeated process reviews or a Java-only demo.
An application is successful only when its API, persistence, business
operations, server-side authorization and real browser UI work directly
from the supported reviewed contracts **without application-specific code
written after the contracts are finalized**.

**Read before making implementation changes:**

1. [docs/vnext/README.md](docs/vnext/README.md)
2. [Product requirements](docs/vnext/00_PRODUCT_REQUIREMENTS.md)
3. [Architecture/ADR-004](docs/vnext/01_ARCHITECTURE_ADR.md)
4. [Implementation plan A0–A5](docs/vnext/02_IMPLEMENTATION_PLAN.md)
5. [Conformance matrix](docs/vnext/03_ACCEPTANCE_MATRIX.md)
6. [Runbook](docs/vnext/04_EXECUTION_RUNBOOK.md)

**Verified vNext outcomes:** A0 TypeSpec/IR and modular fallback PASS (JHipster stock NO-GO); A1 backend/HTTP/DB/auth PASS acotado; A4 multi-entity FK + browser PASS acotado; A5 additive Flyway V1→V2 on a populated PostgreSQL DB PASS acotado (see `docs/vnext/evidence/A5.md`). A2 complete generated Docker Compose lifecycle is still **NOT RUN** due unavailable Docker Engine. A3 NestJS portability is NOT STARTED. All stages are profile-scoped and do not imply production security.

**Next useful work:** (1) validate the generated Compose stack on an actual engine without mutating consumer volumes; (2) implement NestJS target against the unchanged Taller TypeSpec/IR and P-01..P-06 conformance; (3) expand A5 compatibility only with new real DB preservation tests. No parallel planning document is needed. TypeSpec remains the authority. The sandbox Render service publishes a **marker only**, not the generated app.


## Invariants

- Current v0.1–v0.4 Python/JSON, G0–G5 Books and P3/P4 experiments are
  historical, useful and not proof of vNext. Preserve them and their
  frozen benchmarking artifacts. The experiment branch
  `experiments/p5-taller-real-requirements-v1` is the manual Taller
  comparison oracle, **not** an implementation starting branch.
- TypeSpec contracts and ProtocolIA-owned semantic decorators define
  the domain; JDL, OpenAPI, JSON Schema, ORM metadata, UI manifests,
  database/migration files and HTTP implementations are **derived**.
- Every adapter must reject unsupported or ambiguous domain behavior
  **before** emitting an app. No 501 placeholder or HTTP 200 fake success
  counts as implementation.
- Keep business semantics platform-neutral. A tool's internal SQL primary
  key cannot silently change the contract's public identity.
- Put generated and consumer-owned files in separate managed trees;
  fail closed on accidental overwrite and destructive migration.
- Do not embed production secrets, use paid model APIs or consume GitHub
  Actions minutes as required prerequisites. Real builds/tests may use
  local/isolated Docker.
- Demonstrate progress through an actual user-visible behavior and a
  small reproducible test. Record observed PASS/FAIL/BLOCKED honestly
  with commit, toolchain and command; no ornamental quality bureaucracy.
- Implement incrementally and continue until the milestone has either
  runnable evidence or an actionable concrete blocker. Do not create
  arbitrary step/retry limits solely for reporting.
- Keep P3 privileged-agent action permissions distinct from security
  capabilities enforced by generated business applications.

## Delivery/communication

For each stage, use a short feature branch, report exactly which
acceptance IDs passed, and update `docs/vnext/evidence/Ax.md` only
after observing the corresponding execution. Do not describe
A0–A5 as implemented until that evidence exists.
