# ProtocolIA — Guidance for coding agents

## Current priority (2026-10-30)

The central mission is **reviewed TypeSpec contracts → complete working applications**. Evidence of a functioning API, persistent PostgreSQL, server-side authorization and generated browser UI matters more than additional deployment infrastructure, model-token ROI or ornamental planning.

**Repository reality (not historical plans):**
- `main` is the immutable `v1.0.0` baseline at `cf4f768a`: functional modular Spring Boot, NestJS, PostgreSQL, generated React and bounded B17 collection behavior.
- Draft [PR #55](https://github.com/barbasmarcosi/ProtocolIA/pull/55) is the unreleased v1.1 line: generic If-Match conformance, generated batch editor, checkpoint/preflight, additive evolution and disposable one-shot migrator recovery. Exact-image SIGKILL recovery was verified in both generated adapters on real GitHub-hosted PostgreSQL/Chromium, but **no production release or live cutover is certified**. Main and v1.0.0 tag must not be rewritten.
- `feature/v1.2-independent-contract-acceptance-20261030` is a **separate, experimental successor** based on the latest v1.1 draft. The CommunityArchive contract is deliberately independent from Taller/Books/Maintenance; **scoped TypeSpec → generated Spring/Nest/PostgreSQL/Chromium acceptance is VERIFIED ×2** by [public Actions run #41000626735](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41000626735), including real mobile FK-picker creation, reader isolation, and zero browser JS errors. Full external customer acceptance and production readiness remain open. Do not retrospectively change the frozen A13 13/16 score.
- Historic branches A14 `@filterBy` and UX6 are superseded by integrated `@queryFilter`/`@queryOrder` and unsaved-form guards; do not cherry-pick their old implementations. Preserve divergence and comparison oracles.

**Immediate objective:** use the independently verified CommunityArchive as a new generalization regression and define the next externally judged customer brief. Improve generated functionality only when that independent rubric exposes gaps. Keep production-operational hardening separated from customer-facing acceptance; never conflate one passing application with universal software generation.

**Read before making changes:** [normative product requirements](docs/vnext/00_PRODUCT_REQUIREMENTS.md), [architecture](docs/vnext/01_ARCHITECTURE_ADR.md), [acceptance matrix](docs/vnext/03_ACCEPTANCE_MATRIX.md), [v1 scope](docs/releases/v1.0.0.md), [v1.1 SIGKILL evidence](docs/vnext/evidence/V11_REAL_SIGKILL_RECOVERY_20261029.md).

Never equate historical A0–A5 plans or prior NOT RUN statements with the current repository status; always cite exact applicable, successfully completed CI run.

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
