"""External JSON Schema vs ProtocolIA validator differential conformance gate.

Uses jsonschema ONLY as CI/test dependency, not inside the provider-free compiler.
This tests *shape parity* and explicitly documents semantic-only rejection cases.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator

from protocolia import ContractError, validate

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schemas" / "contract-v0.1.schema.json"
SOURCE = ROOT / "examples" / "sales.json"


def changed(source: dict, path: tuple, value: object) -> dict:
    target = copy.deepcopy(source)
    obj = target
    for part in path[:-1]:
        obj = obj[part]
    obj[path[-1]] = value
    return target


def corpus(source: dict) -> list[tuple[str, dict, bool, bool]]:
    # title, contract, schema accepts, full semantic validator accepts
    cases = [("example", source, True, True)]
    reordered = copy.deepcopy(source)
    reordered["operations"] = dict(reversed(list(reordered["operations"].items())))
    cases.append(("reordered-valid", reordered, True, True))
    extended = copy.deepcopy(source)
    extended["models"]["SaleRequest"]["tags"] = {"type": "string[]", "required": False}
    cases.append(("optional-string-array", extended, True, True))
    variants = [
        ("bad-version", ("version",), "0.2"),
        ("wrong-version-type", ("version",), 0.1),
        ("invalid-namespace", ("namespace",), "A\n"),
        ("wrong-namespace-type", ("namespace",), []),
        ("empty-models", ("models",), {}),
        ("wrong-model-type", ("models",), []),
        ("empty-ops", ("operations",), {}),
        ("wrong-op-type", ("operations",), 17),
        ("bad-model-key", ("models",), {"1bad": {"a": {"type": "string", "required": True}}}),
        ("bad-field-type", ("models", "SaleRequest", "quantity", "type"), "string[][]"),
        ("bad-required-bool", ("models", "SaleRequest", "quantity", "required"), 0),
        ("bad-method", ("operations", "health", "method"), "OPTIONS"),
        ("bad-path", ("operations", "health", "path"), "/foo/{id}"),
        ("bad-path-newline", ("operations", "health", "path"), "/foo\n"),
        ("invalid-capability", ("operations", "health", "capability"), "Bad.Name"),
        ("invalid-capability-type", ("operations", "health", "capability"), 22),
        ("empty-type", ("models", "SaleRequest", "quantity", "type"), ""),
        ("duplicate-effect", ("operations", "health", "effects"), ["read", "read"]),
        ("bad-effect", ("operations", "health", "effects"), ["shell.execute"]),
        ("bad-dep-type", ("operations", "health", "depends_on"), [1]),
    ]
    for title, path, value in variants:
        cases.append((title, changed(source, path, value), False, False))
    for title, key, value in [
        ("unknown-top-key", "surprise", True),
    ]:
        c = copy.deepcopy(source)
        c[key] = value
        cases.append((title, c, False, False))
    for title, path in [
        ("missing-version", ("version",)),
        ("missing-method", ("operations", "health", "method")),
        ("missing-required-field-key", ("models", "SaleRequest", "quantity", "required")),
        ("missing-request", ("operations", "registerSale", "request")),
    ]:
        c = copy.deepcopy(source)
        obj = c
        for part in path[:-1]:
            obj = obj[part]
        del obj[path[-1]]
        cases.append((title, c, False, False))
    cases += [
        ("unknown-model-ref", changed(source, ("models", "SaleRequest", "quantity", "type"), "Mystery"), True, False),
        ("reserved-model-name", changed(source, ("models",), {"string": {"a": {"type": "string", "required": True}}}), True, False),
        ("public-write", changed(source, ("operations", "registerSale", "capability"), "public"), True, False),
        ("missing-dep", changed(source, ("operations", "health", "depends_on"), ["unknownOperation"]), True, False),
        ("self-cycle", changed(source, ("operations", "health", "depends_on"), ["health"]), True, False),
        ("non-get-write", changed(source, ("operations", "health", "effects"), ["write"]), True, False),
    ]
    return cases


def main() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    outcomes = []
    for label, contract, expected_shape, expected_semantics in corpus(source):
        shape = validator.is_valid(contract)
        try:
            validate(contract)
        except ContractError:
            semantic = False
        else:
            semantic = True
        outcomes.append((label, shape, semantic))
        if (shape, semantic) != (expected_shape, expected_semantics):
            raise AssertionError(f"{label}: expected {(expected_shape,expected_semantics)} got {(shape,semantic)}")
        if semantic and not shape:
            raise AssertionError(f"{label}: compiler accepted input forbidden by normative schema")
    print(f"SCHEMA ACCEPTANCE PARITY: {len(outcomes)} cases passed ({sum(x[1] for x in outcomes)} shape-accepted; {sum(x[2] for x in outcomes)} semantically valid)")


if __name__ == "__main__":
    main()
