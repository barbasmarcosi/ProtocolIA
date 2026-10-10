# P1-B: Conservative API compatibility diagnostics

New provider-free entry point: `protocolia diff old.json candidate.json` and `protocolia.compare_contracts(old, new)`. Both contracts must pass the **full** v0.1 semantic validator before a diff is computed.

## Contract for the compatibility report

- JSON output, deterministic sorted change list, including the old and new normalized-IR SHA-256.
- Compatible status means **no breaking change under the conservative v0.1 syntactic rules**. It is not a claim of behavioral equivalence, binary ABI stability, database migration safety, authorization enforcement, or runtime correctness.
- New model/operation or an *optional* field added to an existing model are additive.
- Removed models/operations/fields, new required fields, type/requiredness changes, namespace changes, or any change to an existing operation's method/path/request/response/capability/effects/dependencies are classified as **breaking**.
- Reordered keys, operation maps or reordered set-like effect/dependency arrays do not change the classification.
- This is intentionally conservative: an optional field may not be tolerated by a strict third-party consumer; additive therefore does **not** guarantee deploy-time compatibility. Consumer-driven contract tests still govern rollout.
- Strict v0.1 only; a v0.2 contract is rejected, not silently downgraded. No automatic schema migration.

## CLI

```sh
protocolia diff old.json candidate.json
# exit code 0 = no syntactic breaking diagnostics
# exit code 2 = breaking diagnostics reported as JSON
# exit code 1 = unreadable or invalid contract
```

The tool returns an inspectable report rather than modifying the source or data stores. Tests cover stable ordering, additive/required changes, removed types and operations, capability changes, invalid contract rejection and CLI exit codes.

## Next P1 work

Typed executable constraints and a safely versioned v0.2 grammar, source/schema/parser agreement, path parameter binding, external conformance fixtures and formal migration rules. Do not merge this PR independently of P1-A; both are currently stacked on a draft P0 implementation.
