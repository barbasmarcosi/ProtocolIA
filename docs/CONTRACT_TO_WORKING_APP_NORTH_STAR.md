# ProtocolIA — Product North Star (vNext supersedes this initial note)

**Status:** original product-priority decision RETAINED; its former A1–A5
architecture and milestone sequence are **SUPERSEDED** by the vNext plan
approved 2026-10-13. Use the documents below rather than this historical
entry for implementation.

**Unchanged goal:** reviewed requirements → formal contracts →
**working, verifiable, deployable application** (actual DB, business
operations, API, access controls, UI, tests), without writing
entity-specific Java/SQL/React after the contracts, within a
clearly supported feature profile. Token savings are not the KPI.

**New architecture:** TypeSpec-based source + ProtocolIA semantic
library/IR + replaceable adapters, starting with an A0 empirical
JHipster/React/Spring/PostgreSQL spike and later NestJS parity.

- [Requirements](vnext/00_PRODUCT_REQUIREMENTS.md)
- [Architecture](vnext/01_ARCHITECTURE_ADR.md)
- [Authoritative A0–A5 implementation plan](vnext/02_IMPLEMENTATION_PLAN.md)
- [Acceptance matrix](vnext/03_ACCEPTANCE_MATRIX.md)
- [Execution runbook](vnext/04_EXECUTION_RUNBOOK.md)

**Legacy evidence remains unchanged:** [G5 Books](G5_CONTRACT_EVOLUTION_PROGRESS.md)
and [Taller manually integrated](https://github.com/barbasmarcosi/ProtocolIA/blob/experiments/p5-taller-real-requirements-v1/experiments/taller-requirements-v1/EVIDENCE.md).
No new implementation claims are implied by the planning update.
