# ProtocolIA — Execution State (single source of truth)

Updated: 2026-10-10. No provider-backed runs, production migrations or runtime authorization claimed.

## Verified P0 implementation baseline

- Implementation: [ProtocolIA PR #1](https://github.com/barbasmarcosi/ProtocolIA/pull/1), branch `feat/contract-compiler-v0`. Draft and unmerged.
- Code SHA: `788fe9d67cc3d6e502482a7f8e0eb766ac46a881`.
- GitHub [quality run 38081045712](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38081045712): **completed/success** for that SHA. Jobs: unit Python 3.11, unit Python 3.13, external artifact conformance.
- Independent consumer: [ProtocolIA-Test PR #1](https://github.com/barbasmarcosi/ProtocolIA-Test/pull/1), pinned upstream to the above code SHA; [run 38081123609](https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38081123609) completed/success. It uses its **own** inventory contract, not ProtocolIA's Sales fixture.
- Tests: 22 ProtocolIA unit/adversarial tests and 5 consumer unit tests; external OpenAPI 3.1 validator and TypeScript 5.8.3 checks passed in GitHub CI.
- Package: `pip install .` and installed `protocolia` console command both exercised. Python 3.11 and 3.13 verified in CI.
- Reproducibility: frozen SHA-256 golden fixture and repeated deterministic compilation/regeneration tests.
- Security checks: unknown keys, path traversal via manifest, public writes, symlink targets, duplicate JSON members, invalid contract non-mutation. **No claim** of race-free privileged filesystem handling.
- Core remains provider-free. OpenAPI authorization declarations and effect labels **do not enforce runtime permissions**.
- Benchmark contracts/run-record *registration* is in the P0 documentation slice; no model comparisons or savings measured.

**SHA discipline:** the code SHA above is the independently verified baseline, not necessarily the latest documentation commit. Revalidate current HEAD and CI before updating this checkpoint or merging.

## Gate board

| Gate | State | Verified evidence / blocker | Next slice |
| --- | --- | --- | --- |
| P0 package+CLI | VERIFIED on code SHA | Python 3.11/3.13 installed CLI CI green | Keep stable |
| P0 external output conformance | VERIFIED on code SHA | OpenAPI spec validator and TS compiler CI green | Keep independent checks |
| P0 golden/adversarial checks | VERIFIED on code SHA | 22 unit tests; pinned golden hashes | Extend if new grammar |
| P0 downstream smoke | VERIFIED on pinned SHA | ProtocolIA-Test CI + 5 independent tests | Keep consumer pinned |
| P0 benchmark registry | DOCUMENTED; NOT YET EVALUATED | Task registry and run-record schema only | P4 must lock held-out corpus |
| P1 normative typed contracts | IN PROGRESS (A/B verified) | [#2](https://github.com/barbasmarcosi/ProtocolIA/issues/2) | Typed v0.2 constraints and version transitions |
| P2 executable generated service | NOT STARTED | [#3](https://github.com/barbasmarcosi/ProtocolIA/issues/3) | FastAPI bounded vertical slice |
| P3 capability runtime | NOT STARTED | [#4](https://github.com/barbasmarcosi/ProtocolIA/issues/4) | Separate action IR before effects |
| P4 independent comparison | NOT STARTED | [#5](https://github.com/barbasmarcosi/ProtocolIA/issues/5) | Pre-register real held-out tasks |
| P5 external pilots | NOT STARTED | [#7](https://github.com/barbasmarcosi/ProtocolIA/issues/7) | Read-only consumers first |
| P6 v1/no-go decision | NOT STARTED | [#8](https://github.com/barbasmarcosi/ProtocolIA/issues/8) | Evidence required |

## Immediate next independent slice: P1-A

1. Define normative JSON Schema 2020-12 for supported contract v0.1 syntax. Preserve strict unknown-field rejection and bound cardinalities.
2. Corpus-compare JSON Schema acceptance with `validate()` acceptance on positive and adversarial negative fixtures; mismatches are blockers and must not be papered over.
3. Precisely describe differences between **shape validation** and semantic checks (references, cycles, permissions).
4. Add external JSON Schema validator to CI as test tooling only, without making the provider-free compiler dependent on it.
5. Add cross-version conformance fixtures, keeping v0.1 frozen and defining any v0.2 semantics separately.
6. Use ProtocolIA-Test for an independent acceptance/rejection fixture not copied from the compiler's tests.

## Change control

Every completed gate needs an exact commit, verified workflow ID, independent evidence and any residual limitations; writing code or passing only local tests is not sufficient. Do not introduce a paid-model requirement for P0/P1. No production or privileged tool actions without a separately reviewed runtime policy gate.

## P1 verification checkpoint — 2026-10-10

PR lineage: ProtocolIA #1 (P0) → #9 (P1-A schema) → #10 (P1-B compatibility); all Draft and unmerged. Consumer lineage ProtocolIA-Test #1 → #2 → #3, also Draft.

| Gate | Implementation SHA | Main CI | Independent consumer SHA / CI | State |
| --- | --- | --- | --- | --- |
| P1-A: normative v0.1 JSON Schema / 34 differential acceptance cases | 8da92628798a659d4992747ca0faa3c588340865 | https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38081809740 | 0eb7483d3e9fb09d40a19c81cfc3eb5453136bb3 / https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38081868760 | VERIFIED |
| P1-B: deterministic conservative compatibility diff / 32 unit tests total | 9fe1e5ef262cbee263882e089929367ad237fbb6 | https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38082074969 | ccef35a5614cf03622ca6a8652eef1ad6bd7b9de / https://github.com/barbasmarcosi/ProtocolIA-Test/actions/runs/38082131938 | VERIFIED |

Shape-valid is NOT semantically valid: references, DAG cycles and write capabilities are checked separately. Compatibility means a conservative v0.1 syntactic change classification, not behavioral equivalence. Both are provider-free and do not establish runtime authorization or model-token savings.

**Remaining P1:** typed executable constraints in a separate v0.2 contract, path-parameter binding, true version migration/deprecation, regeneration ownership policy, and independent Smithy/CUE fidelity ADR. P1 overall remains IN PROGRESS. No generated service, safe action runtime or A/B/C benchmark yet.

**Next isolated slice:** design and implement v0.2 scalar restrictions (numeric bounds, string bounds, scalar enum) with strict incompatible-combination rejection, reference validation, external JSON Schema conformance and an executable payload checker; preserve all v0.1 golden hashes.
