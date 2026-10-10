# ProtocolIA — Execution State (single source of truth)

Updated: 2026-10-10. This records independently verified **P1 contract-language scope**, not a completed generated application.

## Source control and evidence

| Gate | Repo / PR | Verified implementation commit | Passing CI |
| --- | --- | --- | --- |
| P0 provider-free compiler, installed CLI | [ProtocolIA #1](https://github.com/barbasmarcosi/ProtocolIA/pull/1) | `960c34c5ee1b137e77243483efa6cbde6d78f376` | [38081290729](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38081290729) |
| P1-A normative v0.1 schema | [ProtocolIA #9](https://github.com/barbasmarcosi/ProtocolIA/pull/9) | `8da92628798a659d4992747ca0faa3c588340865` | [38081809740](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38081809740) |
| P1-B conservative v0.1 diff | [ProtocolIA #10](https://github.com/barbasmarcosi/ProtocolIA/pull/10) | `9fe1e5ef262cbee263882e089929367ad237fbb6` | [38082074969](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38082074969) |
| P1-C v0.2 grammar/runtime/migration | [ProtocolIA #11](https://github.com/barbasmarcosi/ProtocolIA/pull/11) | `9650334f3396f34aecf9346202a29058660a9de9` | [38085777855](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38085777855), [38085775551](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38085775551) |
| P0 consumer | [ProtocolIA-Test #1](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/1) | `59dbf59210aaab25d4317d4023f0a68c24c35cf7` | [38081123609](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38081123609) |
| P1-A independent schema consumer | [ProtocolIA-Test #2](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/2) | `0eb7483d3e9fb09d40a19c81cfc3eb5453136bb3` | [38081868760](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38081868760) |
| P1-B independent compatibility consumer | [ProtocolIA-Test #3](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/3) | `ccef35a5614cf03622ca6a8652eef1ad6bd7b9de` | [38082131938](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38082131938) |
| P1-C independent v0.2 consumer | [ProtocolIA-Test #4](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/4) | `047cdfc6586191dfd032344500410584d42b2aa0` | [38085784887](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38085784887), [38085782948](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38085782948) |

P1-C validation includes Python 3.11 + 3.13 tests, the prior 34-case v0.1 differential gate, independent OpenAPI 3.1/TypeScript conformance, and a v0.2 JSON Schema+reference-runtime conformance job. Generated v0.1 hashes remain frozen. P1 implementation CI is green on the **exact code SHA above**; this document/README change makes newer commits and requires refreshed CI before a merge decision.

## What is proven in P1

- Strict versioned contract shape and semantic validation for v0.1 / v0.2, including a safe bounded pattern subset.
- Executable v0.2 wire-payload and parsed URI parameter validators with independent schema comparisons.
- Conservative same-version change classification, explicit v0.1→v0.2 grammar migration, read-only regeneration preview and versioned manifest ownership.
- OpenAPI 3.1, TypeScript, JSON Schema generation, reproducibility and separate test repository consuming **pinned upstream commits**.
- ADR-001 records feature-fidelity tradeoffs and the decision to **defer unimplemented Smithy/CUE importers**. No round-trip claims.

## Explicitly NOT proven

No generated FastAPI service, database schema/migration application, transactional guarantees, concurrent stock safety, production authorization, runtime executor/capability tokens, arbitrary model assertions, Smithy/CUE importer, formal proof, or reduction of model tokens/USD. Schema-conformance tests do not imply a production implementation is correct.

## Gate board

| Gate | State | Next action |
| --- | --- | --- |
| P0 — compiler baseline | VERIFIED | Preserve regression corpus |
| P1 — supported normative contract-language scope | VERIFIED on listed code SHA; **merge/CI refresh pending** | Review stacked PRs in order |
| P2 — running generated service | NOT STARTED | Generate a single bounded FastAPI application (DTOs/routes/validator) with executable isolated tests, then transactional inventory rules |
| P3 — capability-safe action runtime | NOT STARTED | Independent action IR (not HTTP op deps) and deny-by-default capabilities |
| P4 — comparative economic benchmark | NOT STARTED | Preregister held-out tests and independent success oracles |
| P5 — dry-run adoption and optional standards bridge | NOT STARTED | TrueMaestro, GastroApp, third party; preserve consumer security boundaries |
| P6 — stable v1 or documented no-go | NOT STARTED | Evidence-based release only |

## P2 first atomic execution slice

Build an independently executable FastAPI backend generator with supported DTO schema validations and route stubs explicitly indicating unimplemented behavior. Integrate with ProtocolIA-Test on isolated resources. Only after service conformance passes, add a **supported named** inventory-sale rule with transactional PostgreSQL tests, authorization checks, concurrency/replay/idempotency tests and safe schema-migration previews. Do not put unrestricted shell/SQL inside a contract or mistake generated OpenAPI security labels for enforcement.

## Change control

Each claim is bound to a commit and a completed workflow. Before merging, revalidate current PR bases, all checks, exact SHAs, diff, and target branch. After merging, verify CI on the merged main branch. Do not infer correctness from previous green SHAs.
