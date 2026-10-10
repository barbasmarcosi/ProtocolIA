# ProtocolIA v0.2 normative subset / migration, executable data validation

**Only explicitly supported grammar is valid.** No arbitrary model strings, code, SQL, subprocess or Python callbacks in the contract. `version: "0.1"` remains frozen and its hashes remain unchanged.

## Fields and executable semantics

- `constraints` is optional per field. Its supported keys are `minimum`, `maximum` for numeric scalar values, `minLength`, `maxLength`, `pattern` for scalar strings, `enum` for scalar string, integer, finite number or boolean.
- **Only scalar primitive fields** may have constraints. Lists, nested model objects, UUID and datetime constraints are not yet supported. This is enforced, not ignored.
- Integer fields require JSON integers, *never booleans*. Numeric fields require finite numbers; implicit string→number coercion is forbidden.
- All strings are capped at 4096 Unicode codepoints by v0.2 policy, including items inside arrays. No implicit `null` values; optional means missing, not null.
- Patterns are restricted to anchored ASCII character classes (e.g. `^[A-Za-z0-9_-]+$`) with `+` or a bounded quantifier. The validator will reject regex groups, backreferences, nested quantifiers or lookarounds. Input sizes and allowed repetitions are bounded.
- Enum values must be nonempty, unique, correctly typed, and satisfy any additional declared constraints.
- `validate_payload(contract, model, instance)` is a provider-free **executable validator** for supported wire-data guarantees. It performs recursive model/array/reference checks with depth/item limits, unknown-property rejection, and type/constraint enforcement. Generated `payload.schema.json` is separately verified using a JSON Schema implementation with explicit format checking. Passing either does **not** prove transactional correctness or authorization.

## Exact path binding

Every v0.2 operation has a `params` object, even when empty. A `{name}` placeholder must occur **exactly once** in the path and exactly once in params; only `string`, `integer` or `uuid` types are allowed. Duplicate/overlapping same-method route templates fail closed. OpenAPI emits required `in:path` parameters; `validate_path_params` is an executable value validator **after** a framework routes/parses URL parameters. It does not parse URLs or enforce capability tokens.

## Migrating v0.1 without mutation

`protocolia migrate examples/sales.json > migrated-v0.2.json` performs strict validation before returning a new v0.2 document, adding empty `params` to all operations. It never changes a source file, database, deployed application or existing generated output directory. Output artifacts use a different `compiler` manifest version; attempting to regenerate v0.2 into a v0.1-owned directory is rejected. Use a fresh output directory and review differences.

`protocolia diff old.json new.json` compares contracts **only within the same version**, classifying conservative changes as breaking/additive. Cross-version diff requires explicitly migrating the older contract first. This reports syntactic contract drift, **not** backwards compatibility of real clients, schema migrations or correctness under concurrency.

`protocolia preview new-contract.json --out existing-generated` inspects managed output and reports create/update/unchanged without writing. It rechecks ownership but provides no race-free guarantee: a subsequent write must validate again.

## Boundaries

No nullable fields, floating-decimal precision guarantees, extensible user predicates, ownership migration of existing generated files, arbitrary regex, runtime business invariants, auth enforcement, or lossy auto-import from Smithy/CUE. v0.1 remains backward compatible as a compiler input, not as a claim that a particular deployed API cannot change. v0.2 is an **experimental language version**, not a complete SaaS generator.
