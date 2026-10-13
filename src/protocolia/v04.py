"""Bounded v0.4 evolution: optional nullable scalar fields only.

Missing JSON fields and explicit null both map to a Java record null.
Optional nonnullable / required nullable are rejected until target runtimes
support their distinct wire semantics. Historical compilers stay unchanged.
"""
from __future__ import annotations
import copy
import json
from typing import Any
from . import core, v02, v03


def _project(contract: Any) -> dict:
    core._keys(contract, {"version", "namespace", "models", "operations"}, set(), "v0.4 contract")
    if contract["version"] != "0.4":
        core._fail("v0.4 validator requires version 0.4")
    if not isinstance(contract["models"], dict):
        core._fail("v0.4.models: expected object")
    projected = copy.deepcopy(contract)
    projected["version"] = "0.3"
    for model, fields in projected["models"].items():
        if not isinstance(fields, dict):
            core._fail(f"{model}: expected field mapping")
        for field, spec in fields.items():
            where = f"{model}.{field}"
            core._keys(spec, {"type", "required"}, {"constraints", "nullable"}, where)
            if type(spec["required"]) is not bool:
                core._fail(f"{where}: required must be boolean")
            if not spec["required"]:
                if spec.get("nullable") is not True or spec["type"] not in core.PRIMITIVES:
                    core._fail(f"{where}: only optional nullable scalar primitives supported")
            elif "nullable" in spec:
                core._fail(f"{where}: required nullable fields unsupported")
            spec.pop("nullable", None)
    return projected


def validate(contract: Any) -> dict:
    ir = v03.validate(_project(contract))
    ir["version"] = "0.4"
    for model, fields in contract["models"].items():
        for field, spec in fields.items():
            if not spec["required"]:
                ir["models"][model][field]["nullable"] = True
    return ir


def compile_contract(contract: Any) -> dict[str, str]:
    ir = validate(contract)
    artifacts = v03.compile_contract(_project(contract))
    api = json.loads(artifacts["openapi.json"])
    payload = json.loads(artifacts["payload.schema.json"])
    ts = artifacts["types.ts"].replace("v0.3", "v0.4", 1)
    for model, fields in ir["models"].items():
        for field, spec in fields.items():
            if spec.get("nullable") is not True:
                continue
            for definition in (api["components"]["schemas"][model], payload["$defs"][model]):
                prop = definition["properties"][field]
                if not isinstance(prop.get("type"), str):
                    core._fail(f"{model}.{field}: nullable property schema unsupported")
                prop["type"] = [prop["type"], "null"]
                if field in definition["required"]:
                    core._fail(f"{model}.{field}: optional field erroneously required")
            kind = {"string": "string", "integer": "number", "number": "number",
                    "boolean": "boolean", "uuid": "string", "datetime": "string"}[spec["type"]]
            start = ts.index(f"export interface {model} {{")
            end = ts.index("\n}", start)
            section = ts[start:end]
            original = f"  {field}?: {kind};"
            if section.count(original) != 1:
                core._fail(f"{model}.{field}: ambiguous TS field projection")
            ts = ts[:start] + section.replace(original, f"  {field}?: {kind} | null;", 1) + ts[end:]
    api["info"]["version"] = "0.4"
    artifacts.update({"ir.json": core._json(ir), "openapi.json": core._json(api),
                      "payload.schema.json": core._json(payload), "types.ts": ts})
    artifacts["manifest.json"] = core._json({
        "compiler": "protocolia/0.4", "contract_sha256": core._sha(artifacts["ir.json"]),
        "artifacts": {k: core._sha(v) for k, v in sorted(artifacts.items()) if k != "manifest.json"},
    })
    return dict(sorted(artifacts.items()))


def validate_payload(contract: Any, model: str, payload: Any) -> bool:
    """Strict reference payload validator, no coercion or unknown fields."""
    ir = validate(contract)
    if model not in ir["models"]:
        core._fail("unknown model " + model)

    def check(value: Any, typ: str, limits: dict, depth: int) -> bool:
        if depth > 24:
            return False
        base, array = core._parse_type(typ, ir["models"], "payload type")
        if array:
            return isinstance(value, list) and len(value) <= 10000 and all(
                check(v, base, {}, depth + 1) for v in value)
        if base in ir["models"]:
            return check_model(value, base, depth + 1)
        return v02._value_matches(value, base, limits)

    def check_model(value: Any, name: str, depth: int) -> bool:
        if depth > 24 or not isinstance(value, dict):
            return False
        fields = ir["models"][name]
        if set(value) - set(fields) or any(s["required"] and f not in value for f, s in fields.items()):
            return False
        for field, item in value.items():
            spec = fields[field]
            if item is None and spec.get("nullable") is True:
                continue
            if not check(item, spec["type"], spec.get("constraints", {}), depth + 1):
                return False
        return True

    return check_model(payload, model, 0)
