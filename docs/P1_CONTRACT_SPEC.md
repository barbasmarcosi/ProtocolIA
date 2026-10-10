# P1-A: Contract v0.1 structural schema

`schemas/contract-v0.1.schema.json` defines the **structural** v0.1 JSON Schema, based on draft 2020-12. It is intentionally separate from ProtocolIA's semantic validator. The CLI still validates semantics via `protocolia.core.validate`.

## Two acceptance levels

1. **JSON shape acceptance:** exact required keys, identifier syntax, model/operation counts, primitive/list type-string grammar, HTTP method, path grammar, request requirement for POST/PUT/PATCH, and unique string lists.
2. **Semantic acceptance (stricter):** named type references must resolve; models cannot use reserved TypeScript/primitive names; HTTP method/path pairs are unique; declared dependencies exist and are acyclic; public or GET writes fail.

Being shape-valid is **not** being a runnable, authorized or domain-correct contract. A JSON Schema cannot detect duplicate object members *after a JSON parser has silently discarded them*: the ProtocolIA CLI rejects duplicate JSON keys during parsing.

## Normative compatibility boundary

- v0.1 format and its existing golden generated-output hashes remain frozen; adding this schema must not change canonical v0.1 IR or emitted artifacts.
- No user expressions, arbitrary regular expressions, generated runtime authorization, temporal invariants, or executable business rules are supported by v0.1.
- Schema regexes use an end-of-string guard so a trailing newline is not accidentally accepted by JSON Schema implementations.
- Unknown JSON members fail closed at every supported object level.
- The schema checks grammar shape, not whether referenced model names or dependencies exist; `tools/check_contract_schema.py` tests that separation explicitly.

## Verification

With Python 3.11+ installed and the *test-only* `jsonschema==4.25.1` package:

```sh
python -m pip install .
python -m pip install jsonschema==4.25.1
python tools/check_contract_schema.py
python -m unittest discover -s tests -v
```

P1-A's differential corpus contains **34 deterministic cases** (accepted shapes, rejected shapes and syntactically valid but semantically rejected contracts). It is a targeted regression suite, not exhaustive mathematical equivalence over all JSON values.

Next P1 tasks: typed constraints with executable semantics, safe bound path params, compatibility rules, schema migrations, and external Smithy/CUE fidelity evaluation. Do not mark those as done based on this structural schema alone.
