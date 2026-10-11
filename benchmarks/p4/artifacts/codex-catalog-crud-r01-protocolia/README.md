# ProtocolIA P4 C — catalog-crud r01

`workspace/` is the runnable candidate project. `workspace/protocolia-generated/` preserves the untouched output of the ProtocolIA Java generator; it is evidence, not a Maven source root. The runnable manual classes implement the domain semantics the generator marks as 501 boundaries.

The contract is `workspace/contract.json`; it was validated and generated with the exact ProtocolIA commit recorded in `evidence.json`. No OpenAPI Generator was used.

For Render, set the root directory to `benchmarks/p4/artifacts/codex-catalog-crud-r01-protocolia/workspace`.
