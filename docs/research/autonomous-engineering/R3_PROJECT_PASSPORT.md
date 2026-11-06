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

R3.1 adds an opt-in Passport output to the full app:build pipeline, included in the generated application's ownership seal. It does not render a complete C4 container view, generate architecture decision rationale, derive business specifications from natural language, validate Mermaid in a browser, publish docs or establish independent deployment evidence. Those activities require R2/R3 subsequent gates and selected tools.

The two-year handoff exercise (R4) is NOT RUN. These documents are only the first verifiable building block. Do not close R2–R4 issue #106 because this tool passes unit tests.

## CI

The original R3 checks run Node tests, compile the canonical Taller TypeSpec, generate/verify the portable documents, then mutate a generated page and reject the drift. R3.1 additionally exercises the actual **generated NestJS application build** with `--passport`, verifies its app ownership seal and refuses modification of a bundled documentation page. Neither workflow substitutes for independent HTTP/PostgreSQL/browser behavioral conformance or an unseen-agent R4 handoff.

## R3.1 — Opt-in application bundle (2026-11-06)

The regular `app:build` command remains unchanged **unless** `--passport` is explicitly requested. Both NestJS and modular Spring use the **same canonical IR**, and the documentation is generated, verified, and sealed **before** the final ownership manifest is written:

```sh
npm run app:build -- examples/vnext/taller --target nestjs --out /tmp/taller-app --passport

node /tmp/taller-app/protocolia-passport-verify.mjs verify \
  --ir /tmp/taller-app/protocolia-contract-ir.json \
  --out /tmp/taller-app/passport
```

Optional externally supplied mapping and decision documents may be provided using `--passport-requirements <requirements.json>` and `--passport-decisions <decisions.json>` **together with** `--passport`. The builder makes byte-for-byte snapshots at `protocolia-passport-inputs/`, so future documentation-integrity verification can run with **the generated application alone**, not the original ChatGPT session, ProtocolIA source checkout or original input directory. This is a self-contained hash comparison, **not** a digital signature or independent proof that the bundled verifier itself was trusted. For mapped inputs, pass `--requirements /tmp/taller-app/protocolia-passport-inputs/requirements.json` and `--decisions /tmp/taller-app/protocolia-passport-inputs/decisions.json` to the standalone verifier.

The bundle includes:
- `passport/`: deterministic documentation, Mermaid, traceability and unsigned hashes;
- `protocolia-passport-inputs/` (only when source documents are provided): immutable copies of unverified declarations;
- `protocolia-passport-verify.mjs`: included dependency-free verifier for use from the generated application;
- `protocolia-build.json`: opt-in marker and source hash;
- `protocolia-ownership.json`: SHA-256 digest of **all** Passport files and snapshots, as well as regular generated-code ownership files.

Neither the builder nor the Passport claims that requirements were approved, a natural-language business rule was inferred correctly, the deployment is ready, or independent tests have passed. Without a mapping/decisions file, those facts remain **UNKNOWN**, never fabricated. `--passport` is not a permission for production deployment. The source-copy boundary is local, not cryptographic authentication of the owner.

The R3.1 CI performs unit adversarial checks, a **real NestJS TypeSpec → generated app build**, standalone Passport verification, ownership verification, and a deliberate modified-document rejection. Separate Spring/JWT/PostgreSQL/browser conformance remains required for business correctness; full R4 clean-room handoff is still NOT RUN.
