# ProtocolIA — Guidance for coding agents

## Current priority (2026-10-30)

The central mission is **reviewed TypeSpec contracts → complete working applications**. Evidence of a functioning API, persistent PostgreSQL, server-side authorization and generated browser UI matters more than additional deployment infrastructure, model-token ROI or ornamental planning.

**Repository reality (not historical plans):**
- `main` is the immutable `v1.0.0` baseline at `cf4f768a`: functional modular Spring Boot, NestJS, PostgreSQL, generated React and bounded B17 collection behavior.
- Draft [PR #55](https://github.com/barbasmarcosi/ProtocolIA/pull/55) is the unreleased v1.1 line: generic If-Match conformance, generated batch editor, checkpoint/preflight, additive evolution and disposable one-shot migrator recovery. Exact-image SIGKILL recovery was verified in both generated adapters on real GitHub-hosted PostgreSQL/Chromium, but **no production release or live cutover is certified**. Main and v1.0.0 tag must not be rewritten.
- `feature/v1.2-independent-contract-acceptance-20261030` is a **separate, experimental successor** based on the latest v1.1 draft. The CommunityArchive contract is deliberately independent from Taller/Books/Maintenance; **scoped TypeSpec → generated Spring/Nest/PostgreSQL/Chromium acceptance is VERIFIED ×2** by [public Actions run #41000626735](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41000626735), including real mobile FK-picker creation, reader isolation, and zero browser JS errors. The frozen 12-case customer-style [rubric](docs/vnext/acceptance/COMMUNITY_ARCHIVE_BLACKBOX_RUBRIC.md) also passed **12/12 on both adapters** in [CI #41001733630](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41001733630). This is a project-authored simulated customer rubric, not external customer signoff. Full external customer acceptance and production readiness remain open. Do not retrospectively change the frozen A13 13/16 score.
- **v1.2c workshop proof:** independent [workshop ledger business brief](docs/vnext/acceptance/WORKSHOP_LEDGER_BUSINESS_BRIEF.md) and [exact two-target evidence](docs/vnext/evidence/V12_WORKSHOP_LEDGER_20261030.md). Four TypeSpec-only linked resources, server audit, query filtering, guarded transitions and exact payment strings achieved **TL-01…TL-12 12/12 PASS in both Spring and Nest** at [real PostgreSQL/Chromium CI #41084878066](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41084878066). Required finance balance and overpayment safety, PDF/Excel and external backups are **UNSUPPORTED/NOT VERIFIED**; never describe this bounded working skeleton as a complete financial application.
- **v1.2d bounded finance safety:** separate stacked [Draft PR #58](https://github.com/barbasmarcosi/ProtocolIA/pull/58) adds a TypeSpec-only workshop receipt guard using existing general decimal debit, reversal and reconciliation primitives. [Actual dual-engine PostgreSQL CI #41088807245](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41088807245) confirms **11/11 per-engine scenarios** and PG-12 cross-target parity, including exactly 3 commits and 7 conflicts for ten simultaneous 1.00 receipts against 3.00. See [scope](docs/vnext/acceptance/WORKSHOP_EXACT_PAYMENT_GUARD_20261030.md) and [evidence](docs/vnext/evidence/V12D_EXACT_WORKSHOP_PAYMENT_20261030.md). **v1.2e update:** starting `openingBalance`/`available` are now checked against source-declared exact `laborCharge` in [real CI #41095976944](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41095976944), including forged-balance HTTP negatives and invalid TypeSpec source rejection. See [amendment](docs/vnext/acceptance/WORKSHOP_EXACT_CHARGE_SOURCE_20261030.md) and [evidence](docs/vnext/evidence/V12E_EXACT_CHARGE_SOURCE_20261030.md). **v1.2f verified:** CREATE no longer accepts or requires redundant balances when `@reconcileExact(..., chargeSource, true)` is declared; both generated backends and real Chromium passed [CI #41149861215](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41149861215), including server-side derivation, forged field rejection, no client POST balances, 11/11 prior financial scenarios and 5 fail-closed TypeSpec negatives. See [evidence](docs/vnext/evidence/V12F_SERVER_ONLY_EXACT_OPENING_20261030.md). **BLOCKER:** this still uses one immutable `laborCharge`, not `labor + parts + tax`. Production finance remains unverified and issue #57 OPEN.
- **v1.2g bounded multi-charge:** separately stacked [Draft PR #59](https://github.com/barbasmarcosi/ProtocolIA/pull/59), frozen [rubric](docs/vnext/acceptance/V12G_EXACT_MULTICHARGE_20261030.md), [real two-target PostgreSQL/Chromium CI #41152843250](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/41152843250), [evidence](docs/vnext/evidence/V12G_EXACT_MULTICHARGE_20261030.md). Immutable `laborCharge + partsCharge` initializes server-only exact money on both adapters, forbids unsafe/derived source vectors, returns 400 on overflowing sums before INSERT, preserves 11 prior financial tests and mobile POST. **Not** dynamic parts, tax, fee, discount, payment provider, refund, real invoice or production tenant security. TL-14/issue #57 still OPEN.
- Historic branches A14 `@filterBy` and UX6 are superseded by integrated `@queryFilter`/`@queryOrder` and unsaved-form guards; do not cherry-pick their old implementations. Preserve divergence and comparison oracles.

**Immediate objective (v1.2h):** freeze and implement a source-of-truth financial lifecycle for **typed charge line items, payments, reversals and restricted repricing**, not just a sum of two fixed scalars. Specify a small generic safe transition primitive, atomic preconditions and idempotent audit; include rollback, concurrent receipt/posting and no-double-refund negatives before code. Test Spring/Nest on real PostgreSQL and mobile browsers with the existing 11-case ledger and multi-charge v1.2g suites as non-negotiable regressions. Do not infer tax/legal invoice, payment provider, true refund accounting, customer approval or production readiness; keep #57 OPEN.

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
