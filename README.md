# ProtocolIA

**Contracts before code. Evidence before claims. Intelligence only where it is needed.**

ProtocolIA is a provider-independent research and engineering project for compiling typed software contracts into deterministic artifacts, and eventually into auditable agent execution plans. It is **not** a general-purpose programming language, a replacement for LLMs, or an autonomous coding agent.

## Why

LLMs are powerful at ambiguity, design, and novel problems. They should not have to regenerate routine DTOs, interfaces, API schemas, and execution plans on every request. ProtocolIA tests the hypothesis that *verified contract compilation reduces model work per successful mission without reducing quality*.

## What actually works in v0.1

- Strict JSON contract validation, unknown-field rejection, reference checks, unique endpoints, typed dependencies, stable topological order, explicit capabilities and read/write effects.
- Deterministic IR (`ir.json`), OpenAPI 3.1 (`openapi.json`), TypeScript wire types (`types.ts`), and SHA-256 artifact manifest (`manifest.json`).
- Protected regeneration: refuses to overwrite manually modified/unmanaged output files; rejects symlinked output directories and filenames.
- Python standard library only. No model, API key, network service, database, cloud platform, or dynamic execution required.

**Not yet implemented:** runtime business invariants, server implementations, database migrations, tests for generated services, agent scheduler/executor, model integration, caching, latency/token claims, semantic compatibility verification. An OpenAPI schema is **not** proof that an implementation is secure or correct.

## Try it

Requires Python >=3.11. From the repository root:

```sh
PYTHONPATH=src python -m protocolia validate examples/sales.json
PYTHONPATH=src python -m protocolia compile examples/sales.json --out generated
PYTHONPATH=src python -m unittest discover -s tests -v
```

Inspect `generated/openapi.json`, `generated/types.ts`, `generated/ir.json`, and `generated/manifest.json`. Output is ignored by Git. Changing a contract regenerates its outputs; manually editing a generated file instead causes a fail-closed error. Delete a generated output folder consciously if you need to discard local edits.

## Design principles

1. **Semantics before syntax.** Contracts express supported structure and effects, not free-form instructions that are silently treated as executable truth.
2. **Never fabricate enforcement.** Capabilities and effects are declared metadata for now, not enforced permissions. No business invariant is claimed without executable support.
3. **Fail closed.** Reject unknown grammar, references, routes, effects, or modified artifacts.
4. **Provider-free core.** AI proposes contracts; ProtocolIA validates/compiles them deterministically.
5. **Reproducible first.** Stable output order, explicit spec version, pinned transformations, recorded content hashes.
6. **Adopt standards.** Generate OpenAPI; evaluate Smithy, CUE, JSON Schema, and Spec Kit rather than inventing a language casually.
7. **Measured benefit.** Optimize cost per *verified successful* task, correctness, latency, and verifiable evidence—not code volume or token count alone.
8. **Adapter architecture.** ProtocolIA's core must not import TrueMaestro or a single model SDK.

## Navigating the project

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): component boundaries, contract semantics and future IR/runtime design
- [`docs/RESEARCH.md`](docs/RESEARCH.md): prior art, hypothesis, experiment design and kill criteria
- [`docs/ROADMAP.md`](docs/ROADMAP.md): incremental milestones and gates
- [`docs/SECURITY.md`](docs/SECURITY.md): threat model and explicit non-guarantees
- [`examples/sales.json`](examples/sales.json): example contract

ProtocolIA starts with a narrow, falsifiable vertical slice. The vision is broad; the implemented scope is intentionally small.

## License
MIT; see [`LICENSE`](LICENSE).
