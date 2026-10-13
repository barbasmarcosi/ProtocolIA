# Architecture and semantics — ProtocolIA

> **HISTORICAL v0.1–v0.4 architecture reference.** The old JSON contract/compiler, deterministic artifact and P3 agent-execution design remains accurate in its historical scope. The **new planned contract-to-working-app architecture** adopts TypeSpec, ProtocolIA domain decorators, a technology-neutral semantic IR and replaceable full-stack adapters. See [vNext ADR-004](vnext/01_ARCHITECTURE_ADR.md), [requirements](vnext/00_PRODUCT_REQUIREMENTS.md) and [A0–A5 plan](vnext/02_IMPLEMENTATION_PLAN.md). No vNext implementation is yet claimed.

## Mission

Convert human/agent intent into **validated, typed, versioned contracts**, then into predictable, inspectable artifacts and eventually executable plans. Use an LLM only when a decision is genuinely open. Separate *desired behavior*, *declared effects*, *generated artifacts*, and *verified runtime behavior*.

## Layers

1. **Intent adapters (future):** humans, coding agents, domain schemas, existing OpenAPI/Smithy. These adapters may be probabilistic, untrusted and provider-specific.
2. **Contract AST and semantic validator (v0.1):** strict versioned JSON; reject unsupported constructs; resolve types and operations; enforce basic static policy.
3. **Canonical IR (v0.1):** normalized models, operations and stable DAG order. The IR is an interchange artifact, **not** executable code.
4. **Deterministic backends (v0.1):** OpenAPI 3.1, TypeScript wire types and provenance manifest. Planned: JSON Schema, clients, server stubs, domain code, verification harnesses.
5. **Planner, capability runtime and evidence store (future):** independent processes that compile actions into a DAG, authorize effects, execute sandboxed tools, cache reusable evidence with invalidation and recover after failure.
6. **Evaluation harness (future):** compare direct-code vs contract-first on the same benchmark tasks with external assessment.

## Contract v0.1

Input is a JSON object with exactly `version`, `namespace`, `models`, `operations`.

- `version`: exactly `"0.1"`; incompatible versions require explicit migration.
- `namespace`: conservative ASCII identifier.
- `models`: nonempty map of model names to field maps; each field exactly `{ "type": "string|integer|number|boolean|uuid|datetime|ModelName" (+ optional []), "required": boolean }`. Named types refer to other declared models. All model properties are closed in generated OpenAPI.
- `operations`: nonempty map; every operation needs `method`, static `path`, `response`, `capability`, `effects` and `depends_on`; `request` required on POST/PUT/PATCH. `capability` is `public` or a lowercase dotted namespace. `effects` is a unique subset of `[read, write]`; `depends_on` is a unique list of declared operation names.
- Explicit constraints: public writes and writes using GET are rejected; unknown model references, unknown keys, unsupported route placeholders and dependency cycles are rejected.
- Supported methods: GET/POST/PUT/PATCH/DELETE. Path parameters are intentionally disallowed until path binding is implemented.

### Non-guarantees

- `capability` and `effects` are **declarative** in v0.1; no authorized execution takes place. Backend servers **must independently enforce** permissions and transactions.
- `depends_on` orders logical operations but is not an assertion that their execution is safe or idempotent.
- The IR does not represent domain invariants, temporal behavior, isolation guarantees, retry policy, success criteria or UI composition yet. Adding a string `stock_must_not_be_negative` without executable semantics is explicitly forbidden as a supposed invariant implementation.
- OpenAPI plus TS output does not implement a working server; this is a contract compiler, not production deployment tooling.

## Determinism and canonicalization

Keys are sorted; independent DAG nodes are lexicographically ordered. SHA-256 is computed over stable serialized UTF-8 JSON with a final LF. Manifests record hashes of output artifacts and canonical IR. Reproducibility depends on this compiler version. The manifest is **tamper evidence against accidental edits**, not a cryptographic signature or trusted attestation.

## Next intermediate representation

Future versions should move from the shallow DAG into typed effects/capabilities, guarded branches, deterministic retry semantics, preconditions, postconditions, dataflow edges, idempotency scopes and provenance bindings. No arbitrary user-provided Python, shell commands or predicate expressions may be blindly executed by the compiler.

Example conceptual IR node:

```json
{
  "id": "generate-client",
  "kind": "artifact.generate",
  "requires": ["validate-contract"],
  "inputs": {"contract_ref": "sha256:<digest>"},
  "capabilities": ["artifact.write"],
  "effects": ["filesystem.write:generated/"],
  "verification": ["hash_match", "typecheck"],
  "cache": {"key_inputs": ["compiler_version", "contract_ref", "generator_version"]}
}
```

This shape is **a proposal**, not part of v0.1.

## Extension policy

Define a normative schema and compatibility semantics before adding grammar. Each backend gets deterministic golden tests. Generated content stays separated from hand-maintained code. Plugins run with explicit limits and must not be implicitly trusted. Prefer standards-compatible data models over bespoke languages until incompatibility is demonstrated.
