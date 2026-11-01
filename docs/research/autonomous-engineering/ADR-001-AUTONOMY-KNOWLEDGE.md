# ADR-R1-001 — Autonomy, provenance and persistent Project Knowledge

**Status:** PROPOSED, not ratified; 2026-11-01.
**Deciders:** ProtocolIA project owner, after R1/R2 evidence.
**Compatibility:** no modification to normative TypeSpec/IR ownership or existing releases.

## Problem

The supported vNext profiles compile TypeSpec contracts into working Spring/Nest and React applications, but the current product begins after a technical user/agent closes the contracts. A generated application's future maintainer may lose the conversations containing business rationale, initial ambiguities, design decisions and useful operational explanation.

The intended user wants a near-complete application from natural-language requirements with **autonomy by default** and the ability to inspect/edit any proposed contract at any time. A requirement is not safe merely because an LLM sounds confident.

## Decision proposal: bounded layers, no redundant source of truth

```text
owner brief / verified constraints / project files
     |  agent discovery + critic + recorded evidence
     v
requirements change ledger (intent, decisions, unresolved questions)
     |  reconcile mapping; human edits allowed
     v
TypeSpec domain source (only executable canonical source)
     |  compiler validates -> canonical semantic IR + OpenAPI
     +------------------------+------------------------------+
     v                        v                              v
generated Spring/Nest + UI    Project Passport projections   independent conformance
and safe evolution            diagrams / rationale links     real DB / API / browser
     |                        |                              |
     +------------------------+------------------------------+
                          delivery/handoff
```

**Adapters, not mandatory dependencies:** an agent planner (Superpowers, Spec Kit, GSD Core or other) and a spec-change manager (e.g. OpenSpec/OPSX) can feed ProtocolIA through a narrow, versioned artifact interface. A Project Passport renderer (Mermaid/LikeC4, Starlight/Zensical) consumes verified IR and human-authored rationale. Source and dependencies must be pinned and licenses audited before installing.

## Decision ledger contract (future R2)

Each proposed decision carries:
- `id`, `scope`, `question`, `choice`, `classification`, `origin`, `evidenceRefs`, `policyRef`, `supersedes`.
- Origins: `explicit_owner`, `trusted_existing_contract`, `approved_policy`, `agent_assumption`.
- Classes: `reversible_technical`, `material_business`, `security_privilege`, `external_effect`, `destructive_change`.
- A human edit produces a versioned decision superseding the old one rather than silently mutating history.

**Default unattended rule:** agent assumptions for reversible technical choices may be retained as `provisional` and tested in isolated environments. A material business rule needs an explicit owner requirement or an approved policy grounded in evidence. Security privilege, external side effect and destructive change need narrow, current, explicit authorization before real action. Unsupported or unresolved material requirements remain clearly `BLOCKED`; a partial app is not represented as complete.

Approval is tied to scope, version, action, environment and expiration. A generic instruction to "be autonomous" is **not** blanket permission to deploy, charge, export customer data, alter IAM or destroy databases.

## Proposed Project Passport

Portable, text-first, versioned deliverables in each generated project:

```text
PROJECT_PASSPORT.md                  # orientation, boundaries, supported/unsupported matrix
docs/domain/glossary.md               # explicit definitions and provenance
docs/domain/decisions/ADR-*.md        # reasons, tradeoffs, supersessions
docs/architecture/context.mmd         # model-derived, testable diagram sources
docs/architecture/containers.mmd
docs/architecture/data-model.mmd
docs/flows/*.mmd                      # only if typed operation semantics support derivation
docs/operations/README.md            # build, run, backup/restore limitations
docs/traceability.json               # requirement -> contract -> IR -> tests -> evidence
AGENTS.md                             # short orientation, links, constraints, no secrets
protocolia-passport.lock.json         # contract SHA, IR SHA, toolchain, generation provenance
```

A figure is `derived` only when its assertions can be mechanically traced to IR/source. Unavailable intent is marked `unknown`, not backfilled from application code. Hand-authored architecture context may coexist with machine-derived facts only with an explicit origin. Drift checks reject silent contradictions, changed source hashes and orphaned links.

## The human-in-the-loop isn't a UI gate

Three selectable policies on a shared pipeline:
- `autonomous_reviewable` (default): automatically perform reversible, permitted tasks; persist decisions and allow interruption/edits.
- `review_contracts`: require owner approval of TypeSpec changes before generation.
- `review_milestones`: require approval at agreed milestones.

Under any policy, permission for actual external effects must be independently scoped. "Human review optional" means development can progress within safe bounds, **not** assumptions about money, compliance or client rights.

## Alternatives / risks

- Embedding an entire vendor workflow in ProtocolIA core: rejected for R1 (version lock-in, prompt-format coupling, long-term drift).
- Replacing TypeSpec with Markdown specs: rejected (loses executable semantics and existing verified adapters).
- Generating a wiki purely from source code: insufficient (cannot recover the 'why'; may hallucinate domain constraints).
- Always waiting for owner answers: rejected as default (contradicts autonomy objective).
- Always auto-resolving unknown business rules: rejected (undetectable misimplementation).

Unknowns to measure: extraction reliability, time/cost of formalization, false assumptions, documentation drift after manual changes, long-term package maintenance, UX of contract editing, regression rates under change.

## Acceptance

A future R2/R3/R4 PR must show: frozen synthetic and held-out cases; decision provenance and blocked materially ambiguous intents; independent generated app conformance; type-checked and traced diagrams; two-year handoff against a fresh agent without original chat; version upgrades and correct failed-run reporting. No claim of maturity before these gates.
