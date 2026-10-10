# ProtocolIA — Execution State (single source of truth)

Updated: **2026-10-10**, planning checkpoint; no implementation change claimed here.

## Repository snapshot verified

- Repository: `barbasmarcosi/ProtocolIA`, default branch `main`.
- Active implementation PR: [#1](https://github.com/barbasmarcosi/ProtocolIA/pull/1), **open, Draft, unmerged**, head branch `feat/contract-compiler-v0`.
- Implementation HEAD at this checkpoint: `72ce089aba85c1d12409955e4591456a2cd0b454`.
- GitHub [quality run 38079598479](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38079598479): **completed/success**, exactly on implementation HEAD above. Another run 38079585168 also succeeded.
- PR description reports 14 local unit tests. The CI pass verifies its configured checks, **not** output conformance against external tools or an executable service.
- Current implementation: strict JSON contract compilation to canonical IR, OpenAPI 3.1, TS types and hash manifest; protected regeneration; no provider requirement.
- Known absences: package installation smoke; external emitted-format conformance; executable business invariants; service generation; runtime execution/capability enforcement; token/cost benchmark.

**Important:** The head SHA and workflow run above describe the original implementation baseline. Any later documentation commit necessarily changes branch HEAD; refresh the SHA and CI for that commit before making new success claims.

## Gate board

| Gate | Status | Evidence / explicit blocker | Next action |
| --- | --- | --- | --- |
| P0 baseline grammar/compiler | VERIFIED on baseline SHA | PR #1, 14 reported local tests, green quality workflow | Preserve behavior |
| P0 installed CLI smoke | NOT VERIFIED | CI currently invokes `PYTHONPATH=src` directly | Test clean wheel/install and CLI entry point |
| P0 external format conformance | NOT VERIFIED | Emission is not equivalent to external tool validation | OpenAPI 3.1 validator and TS compiler |
| P0 golden/adversarial corpus | INCOMPLETE | Unit tests exist; comprehensive fixtures not yet evidenced | Fixtures + negative cases |
| P1 formal contract semantics | NOT STARTED | Issue #2 | JSON Schema and matching negative corpus |
| P2 generated running service | NOT STARTED | Issue #3 | One bounded FastAPI vertical slice |
| P3 safe plan runtime | NOT STARTED | Issue #4 | Separate action IR and capability model |
| P4 independent benchmark | NOT STARTED | Issue #5 | Preregister tasks and event ledger early |
| P5 real project consumers | NOT STARTED | No integration evidence | Read-only TrueMaestro/GastroApp pilots |
| P6 v1/no-go decision | NOT STARTED | Requires all previous evidence | Independent assessment |

## Immediate next slice

**P0-B: clean packaging + generated artifact validation.**

Acceptance checklist:
- [ ] Build/install the project in a clean venv on supported Python versions.
- [ ] Verify the installed CLI entry point (not only `PYTHONPATH=src`).
- [ ] Externally validate generated OpenAPI (document *validator/version* used).
- [ ] Typecheck generated TypeScript with pinned TypeScript tooling.
- [ ] Capture deterministic golden output and negative fixtures, with exact commands.
- [ ] Ensure provider keys/network connectivity are not needed for deterministic checks.
- [ ] Record new commit SHA, CI result and any unresolved limitations here.

## Change control

- One PR/slice at a time; do not conflate writing code with obtaining evidence.
- Documentation changes alone never mark a technical gate complete.
- Before merging: check current HEAD, diff, tests, CI and independent contract/output validation relevant to the changed code.
- No new provider-backed operations or production permissions without a separately justified gate and explicit budget/authority.
- If the current task fails, record the **specific failed invariant** and next minimal discriminating experiment; don't repeat the same uninformative run.
