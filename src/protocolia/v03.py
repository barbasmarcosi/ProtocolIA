"""ProtocolIA v0.3: versioned, bounded integer HTTP query parameters.

v0.1 and v0.2 parsers and hashes remain unchanged. This initial v0.3 profile
only admits GET integer query arguments with explicit finite bounds and
defaults: enough for real limit/offset pagination without optional payload
or arbitrary URL-query coercion. Nontrivial filters require future grammar.
"""
from __future__ import annotations

import copy
import json
from typing import Any

from . import core
from . import v02

QUERY_MAX = 1_000_000


def _project_v02(contract: Any) -> dict:
    core._keys(contract, {"version", "namespace", "models", "operations"}, set(), "v0.3 contract")
    if contract["version"] != "0.3":
        core._fail("v0.3 validator requires version 0.3")
    if not isinstance(contract["operations"], dict):
        core._fail("v0.3.operations: expected mapping")
    projected = copy.deepcopy(contract)
    projected["version"] = "0.2"
    for name, operation in projected["operations"].items():
        if not isinstance(operation, dict):
            core._fail(f"{name}: expected operation object")
        operation.pop("query", None)
    return projected


def validate(contract: Any) -> dict:
    projected = _project_v02(contract)
    result = v02.validate(projected)
    result["version"] = "0.3"
    for name, raw_op in contract["operations"].items():
        if "query" not in raw_op:
            continue
        query = raw_op["query"]
        if (raw_op.get("method") != "GET" or not isinstance(query, dict) or
                not 1 <= len(query) <= 8):
            core._fail(f"{name}.query: only nonempty bounded GET parameters supported (1..8)")
        normalized = {}
        for key in sorted(query):
            core._name(key, f"{name}.query")
            if key in raw_op["params"]:
                core._fail(f"{name}.query.{key}: collides with path parameter")
            field = query[key]
            core._keys(field, {"type", "required", "default", "constraints"},
                       set(), f"{name}.query.{key}")
            if field["type"] != "integer" or field["required"] is not False:
                core._fail(f"{name}.query.{key}: only optional integer with explicit default supported")
            constraints = field["constraints"]
            core._keys(constraints, {"minimum", "maximum"}, set(), f"{name}.query.{key}.constraints")
            low, high = constraints["minimum"], constraints["maximum"]
            default = field["default"]
            if (any(type(v) is not int for v in (low, high, default)) or
                    low < 0 or high > QUERY_MAX or low > high or not low <= default <= high):
                core._fail(f"{name}.query.{key}: require finite integer bounds and in-range default")
            normalized[key] = {
                "type": "integer", "required": False, "default": default,
                "constraints": {"minimum": low, "maximum": high},
            }
        result["operations"][name]["query"] = normalized
    return result


def compile_contract(contract: Any) -> dict[str, str]:
    ir = validate(contract)
    legacy = v02.compile_contract(_project_v02(contract))
    api = json.loads(legacy["openapi.json"])
    api["info"]["version"] = "0.3"
    for name, op in ir["operations"].items():
        if not op.get("query"):
            continue
        endpoint = api["paths"][op["path"]][op["method"].lower()]
        if endpoint["operationId"] != name:
            core._fail("inconsistent OpenAPI operationId for " + name)
        params = endpoint.setdefault("parameters", [])
        for key, field in sorted(op["query"].items()):
            params.append({
                "in": "query", "name": key, "required": False,
                "schema": {
                    "type": "integer", "minimum": field["constraints"]["minimum"],
                    "maximum": field["constraints"]["maximum"],
                    "default": field["default"],
                },
            })
    legacy["openapi.json"] = core._json(api)
    legacy["ir.json"] = core._json(ir)
    legacy["types.ts"] = legacy["types.ts"].replace("v0.2", "v0.3", 1)
    legacy["manifest.json"] = core._json({
        "compiler": "protocolia/0.3",
        "contract_sha256": core._sha(legacy["ir.json"]),
        "artifacts": {k: core._sha(v) for k, v in sorted(legacy.items())
                      if k != "manifest.json"},
    })
    return dict(sorted(legacy.items()))

def validate_query_params(contract: Any, operation: str, values: Any) -> bool:
    """Validate already-parsed query values without coercion or executing data access.

    Missing optional parameters use the defaults declared in the contract.
    HTTP string coercion belongs to the target web framework, never this IR.
    """
    ir = validate(contract)
    if operation not in ir["operations"]:
        core._fail("unknown operation: " + operation)
    query = ir["operations"][operation].get("query", {})
    if not isinstance(values, dict) or set(values) - set(query):
        return False
    for key, value in values.items():
        field = query[key]
        if (type(value) is not int or
            not field["constraints"]["minimum"] <= value <= field["constraints"]["maximum"]):
            return False
    return True
