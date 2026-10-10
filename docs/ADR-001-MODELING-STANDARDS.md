# ADR-001: JSON Schema / OpenAPI as portable interchange; no custom Smithy or CUE compiler yet

Status: **Accepted for P1; interoperability projections experimental/not implemented.** Date: 2026-10-10.

## Question

Should ProtocolIA invent a stand-alone general-purpose IDL, adopt Smithy as its language, use CUE to evaluate constraints, or maintain narrow versioned JSON with deterministic, standards-compliant outputs?

## Verified/grounded feature mapping

| ProtocolIA construct | JSON Schema 2020-12 / OpenAPI 3.1 | Smithy 2.0 | CUE | Fidelity / decision |
|---|---|---|---|---|
| Scalar/string/integer models, closed objects | Yes, object/properties/additionalProperties | Structure, string, integer | Struct and types | JSON Schema generated and tested; **Smithy/CUE importer unimplemented** |
| Numeric bounds | minimum/maximum | @range | >= and <= constraints | Syntax maps; numerical-width and format fidelity NOT proven |
| String length | minLength/maxLength | @length | length-based constraints | Unicode/code point semantics vary; do not claim equivalence without tests |
| Regex | pattern (ECMA 262 family) | @pattern (ECMA 262) | string regex supported | ProtocolIA intentionally supports a safe *subset*: no arbitrary backtracking regex accepted |
| Enums | enum | enum/intEnum shapes | Disjunction/constraints | ProtocolIA scalar-only enum; Smithy has additional versioning/shape rules |
| HTTP URI path binding | OpenAPI `in:path`, required | HTTP binding traits | No equivalent service semantic in core language | Generate OpenAPI directly; don't force CUE into service modeling |
| Semantics of capability + read/write effects | vendor extension only; **not enforced** | Traits extensible, no automatic executor | Can describe shape, not enforce tool effects | Retain ProtocolIA explicit metadata until a guarded runtime exists |
| Cross-field invariants, transactions, idempotency | Not expressible via standard schemas alone | Additional custom semantics/tools needed | Richer constraints possible | **Out of P1**. Requires executable rule templates in P2/P3 |

## Choice

- Keep narrow, formally versioned JSON contracts (v0.1 frozen, v0.2 additive language version) for authoring and compiler IR. Generate OpenAPI 3.1 and JSON Schema 2020-12 directly.
- Use an **independent** JSON Schema checker in CI, and a separate deterministic reference payload validator in the provider-free compiler. Cross-check representative payloads; treat discrepancies as blockers.
- Smithy is mature for interfaces, traits and service modeling; CUE is strong for constraints, composition and configuration. **Do not implement import/export** until an explicit field-by-field round-trip conformance suite and business justification exist.
- No claims of lossless Smithy/CUE round-trip today. This ADR is a documented **feature-fidelity analysis**, not an executed import/export benchmark.
- Avoid a custom grammar parser and arbitrarily expressive predicates. Restrict pattern expressions to safe ASCII classes with bounded input length.

## Reversibility / acceptance

P1 closes on a documented standards decision and verified native JSON Schema/OpenAPI output, not on speculative bridges. If an importer is later requested, it must report unsupported elements/loss of information rather than silently translating away security/effects annotations.

Sources: https://spec.openapis.org/oas/v3.1.0.html ; https://json-schema.org/draft/2020-12 ; https://smithy.io/2.0/spec/constraint-traits.html ; https://smithy.io/2.0/spec/http-bindings.html ; https://cuelang.org/docs/ .
