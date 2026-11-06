# R4 prerequisite — rehydrating the authoritative contract from a generated app

**Scope:** experimental source portability and deterministic regeneration, *not* the independent R4 two-year agent handoff. No deployment, data migration, new business policy, remote LLM or model comparison is authorized by this work.

## The concrete gap

R3.1 packaged generated code, its canonical IR, Passport diagrams, requirement/decision claims and portable hash verifiers. It did **not** contain the editable TypeSpec input files. A new maintainer could inspect the model but could not rebuild it from a source contract extracted solely from the handed-off application.

## New handoff package

An explicit `app:build --passport` includes, in addition to the R3.1 artifacts:

| Path in generated application | Purpose |
|---|---|
| `protocolia-contract-source/tspconfig.yaml` | Exact compiler configuration bytes |
| `protocolia-contract-source/contracts/**/*.tsp` | Original editable TypeSpec files, not reconstructed from IR |
| `protocolia-contract-source.lock.json` | Unsigned SHA-256 hashes of each source file and the CLI's original pre-build contract digest |
| `protocolia-contract-source-verify.mjs` | Self-contained Node verifier; no ProtocolIA checkout needed to **verify bytes** |
| `PROJECT_HANDOFF.md` | Cold-start reading, verification and safe-change instructions |

All of these are included in the app's `protocolia-ownership.json` seal. A source snapshot whose content changed since the original build fingerprint is rejected. Symlinks, unreviewed source files, oversized files and unexpected paths fail closed. Only `contracts/**/*.tsp` and `tspconfig.yaml` are covered by the compiler-source digest; optional project README/metadata are **not** independently attested as business context. Outputs like `tsp-output` are excluded.

The source copy is intentionally part of the explicitly requested Passport. Regular builds without `--passport` are unchanged. Do not opt in when the TypeSpec source contains confidential material that must not travel with the generated application.

## Portable integrity check

From the handed-off **generated application directory**:

```sh
node protocolia-contract-source-verify.mjs verify \
  protocolia-contract-source protocolia-contract-source.lock.json

node protocolia-passport-verify.mjs verify \
  --ir protocolia-contract-ir.json --out passport
```

If optional claims were bundled, pass the bundled `--requirements` and/or `--decisions` inputs to the Passport verifier. These tests demonstrate **local byte consistency only**. They are not a cryptographic publisher signature or an authenticated human-approval trail.

## Reproducibility acceptance in CI

The dedicated R4 prerequisite step:

1. Builds a normal NestJS application with `--passport`, using the canonical Taller TypeSpec.
2. Starts a fresh project under the workspace and copies **only** the bundled TypeSpec input directory; no original contract project files are read during rehydration.
3. Verifies the extracted source bytes against the bundle's original lock file.
4. Builds a **second** NestJS application from that fresh project, with the same pinned ProtocolIA checkout/Node/TypeSpec dependencies.
5. Requires byte-identical emitted canonical IR and official OpenAPI, equal contract digest and an independently verifiable second Passport.
6. Separately builds the modular Spring application with `--passport` and verifies its source/Passport/ownership files.
7. Unit tests reject drift, missing/unknown source files, unsafe entries and post-build tampering.

**Evidence must be actual GitHub Actions success for the exact PR head.** Do not claim this works just because these steps appear in YAML.

## What this proves — and what it does not

**When CI succeeds:** the TypeSpec source can be recovered from the generated artifact and regenerated into the same canonical IR/OpenAPI with the **same pinned** ProtocolIA toolchain. It demonstrates source integrity and deterministic source-to-contract reconstruction across a new project directory.

**Not yet demonstrated:**
- A previously uninformed independent agent understanding the business, identifying unknown policies, changing a requirement and updating the generated system.
- A safe nontrivial evolution against an **already populated** PostgreSQL database, including exact data preservation, migration/rollback and authorization checks.
- Compatibility with arbitrary future ProtocolIA/TypeSpec versions, portability of the entire compiler/toolchain, supply-chain signatures or owner approvals.
- Equivalent browser/HTTP/DB operation after a changed contract, independent adversarial/domain oracle, or competitive performance versus a direct coding agent.

R4 issue #106 must remain open. The next legitimate step is a **clean-room maintenance exercise**: freeze an unknown project and independent oracle, give a separate agent only the bundle and declared change request, then require a revised TypeSpec, a real generated app, disposable PostgreSQL data-preserving migration and negative HTTP/browser tests. Unknown material policies must block rather than be invented.
