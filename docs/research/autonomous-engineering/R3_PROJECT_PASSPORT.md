# R3 — Project Passport, first executable slice

**Status: experimental, developer-facing, not independently audited.**
This increment is stacked on the R1 research branch. It does not change vNext's authoritative TypeSpec, semantic IR, Spring/Nest generators, deployments, migration tools, or financial lifecycle.

## Why

A future maintainer should understand what the compiler knows without replaying two years of conversations. The first Passport is a **deterministic projection** of the canonical semantic IR, not another authored source of domain rules.

From a real TypeSpec project:

    npm ci
    npm run build:vnext
    ./node_modules/.bin/tsp compile examples/vnext/taller
    node scripts/research/project-passport.mjs generate \
      --ir examples/vnext/taller/tsp-output/@protocolia/compiler/ir.json \
      --out /tmp/taller-passport
    node scripts/research/project-passport.mjs verify \
      --ir examples/vnext/taller/tsp-output/@protocolia/compiler/ir.json \
      --out /tmp/taller-passport

Requires Node 22+ for this standalone command and the pinned TypeSpec toolchain for compilation. A real project may also provide a separate, explicitly authored requirement-to-operation mapping:

    node scripts/research/project-passport.mjs generate \
      --ir /path/to/ir.json \
      --requirements /path/to/requirements.json \
      --out /tmp/documentation

Input schema for the optional mapping:

    {
      "schemaVersion": "protocolia-requirements/v1",
      "requirements": [
        {
          "id": "K-01",
          "text": "Sale records must be preserved",
          "origin": "explicit_owner",
          "evidenceRefs": ["owner-brief-v1"],
          "operations": ["createSale"]
        }
      ]
    }

Requirement origin must be one of explicit_owner, approved_policy, trusted_existing_contract or agent_assumption. An agent_assumption may have **zero mapped operations** only; it cannot claim executable business coverage. All user-supplied mappings are still **DECLARED_UNVERIFIED** and all test verification statuses are NOT_RUN. Owner assertions, URLs and evidenceRefs are not independently authenticated in v0.1.

## Artifacts

- PROJECT_PASSPORT.md: overview, source fingerprint, links and explicitly unknown facts.
- AGENTS.md: safe future-session entrypoint.
- docs/domain/entities.md: identity, fields, constraints and references derived from actual IR.
- docs/domain/operations.md: HTTP route, declared behavior and capability.
- docs/architecture/data-model.mmd: Mermaid ER declarations from FK metadata.
- docs/architecture/states.mmd: Mermaid state transitions declared in IR.
- docs/traceability.json: optional requirements → canonical operation IDs; no fake test PASS.
- docs/operations/README.md: operating limits and safe-evolution reminders.
- protocolia-passport.lock.json: source and generated-file hashes, not digital signatures.

## Invariants

- No dependence on external LLMs, network, API keys or hosted documentation tools.
- Output MUST be a new/empty directory. Neither build nor verification overwrites modified consumer files.
- verify rejects missing, extra or edited generated artifacts and any change in canonical input bytes.
- Unsafe identifiers, unsupported IR versions, unknown references, unknown operation mappings and AI assumptions posing as implemented behavior fail closed.
- The source remains TypeSpec/IR: Mermaid and docs are projections. Modifying the Markdown never changes the contract.
- A diagram is evidence of the **declared graph**, not of correct DB migration, actual HTTP permissions or production topology.

## Explicitly unfinished

R3 is not yet integrated as an opt-in output of the full app:build pipeline. It does not render a complete C4 container view, generate architecture decision rationale, derive business specifications from natural language, validate Mermaid in a browser, publish docs or establish independent deployment evidence. Those activities require R2/R3 subsequent gates and selected tools.

The two-year handoff exercise (R4) is NOT RUN. These documents are only the first verifiable building block. Do not close R2–R4 issue #106 because this tool passes unit tests.

## CI

The R3 workflow runs Node tests and compiles the existing canonical Taller TypeSpec in the same pinned workspace before generating/verifying documents. It deliberately mutates a generated documentation file and requires verification to reject the drift. The real TypeSpec probe demonstrates integration with an existing IR, **not** a generated Spring/Nest application run.
