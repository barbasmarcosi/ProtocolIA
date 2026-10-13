"""Truthful OpenAPI projection for the *existing* Java Basic-auth demo target.

This is a versioned *target* projection, not a rewrite of the historical v0.1
and v0.2 OpenAPI artifacts. Domain error statuses are explicitly supplied by
the implementer; ProtocolIA does not guess business failures from HTTP paths.
"""
from __future__ import annotations

import json
from typing import Any

from .core import ContractError, _fail, _json, _sha, compile_contract
from .java_spring import generate_java
from .core import validate

PROFILE = "java-spring-basic-demo"
COMPILER = "protocolia/0.2/java-spring-basic-demo-http/1"
DOMAIN_STATUSES = {400, 404, 409}


def _checked_domain_errors(errors: Any, operations: dict[str, Any]) -> dict[str, list[int]]:
    if errors is None:
        return {}
    if not isinstance(errors, dict):
        _fail("domain errors must be a mapping of operationId to status-code arrays")
    result: dict[str, list[int]] = {}
    for operation_id, statuses in errors.items():
        if operation_id not in operations:
            _fail("unknown domain-error operationId: " + str(operation_id))
        if (not isinstance(statuses, list) or
                any(type(code) is not int or code not in DOMAIN_STATUSES for code in statuses) or
                len(set(statuses)) != len(statuses)):
            _fail("invalid domain-error codes for " + operation_id +
                  " (supported: 400, 404, 409; unique integer array)")
        result[operation_id] = sorted(statuses)
    return result


def compile_java_http(contract: Any, domain_errors: Any = None) -> dict[str, str]:
    """Compile a target-specific spec matching the generated Java HTTP adapter.

    Existing versioned generic compile_contract output remains unchanged.
    A validated optional domain-status map documents only implementer-owned
    failures, and never invents response bodies that the Java app has not proved.
    """
    ir = validate(contract)
    if ir["version"] not in {"0.2", "0.3", "0.4"}:
        _fail("Java demo HTTP profile requires v0.2/v0.3/v0.4")
    # Fail closed on Java-specific unsupported field/constraint semantics.
    generate_java(contract)
    declared = _checked_domain_errors(domain_errors, ir["operations"])
    artifacts = compile_contract(contract)
    api = json.loads(artifacts["openapi.json"])
    api["x-protocolia-target-profile"] = PROFILE
    api["components"]["securitySchemes"] = {
        "basicAuth": {"type": "http", "scheme": "basic"}
    }
    for operation_id, op in ir["operations"].items():
        endpoint = api["paths"][op["path"]][op["method"].lower()]
        if endpoint["operationId"] != operation_id:
            raise ContractError("inconsistent OpenAPI operationId")
        success = "201" if op["method"] == "POST" else "200"
        responses = endpoint["responses"]
        original = responses.pop("200")
        responses[success] = original
        # These statuses are *possible*, not guaranteed for every request.
        # No mediaType/schema is advertised for default Spring/Security errors
        # until its serialization has been verified independently.
        if op.get("request") is not None or op["params"] or op.get("query"):
            responses["400"] = {"description": "Invalid request or path argument"}
        if op["capability"] == "public":
            endpoint["security"] = []
        else:
            endpoint["security"] = [{"basicAuth": []}]
            responses["401"] = {"description": "Authentication required"}
            responses["403"] = {"description": "Required capability denied"}
        # The generated controller explicitly returns 501 when the domain
        # service bean is absent. A declared operation is not implemented logic.
        responses["501"] = {"description": "Business handler not implemented"}
        for code in declared.get(operation_id, []):
            responses[str(code)] = {"description": "Implementation-declared domain error"}
        endpoint["responses"] = dict(sorted(responses.items(), key=lambda p: int(p[0])))
    artifacts["openapi.json"] = _json(api)
    artifacts["manifest.json"] = _json({
        "compiler": (COMPILER if ir["version"] == "0.2" else
                     f"protocolia/{ir['version']}/java-spring-basic-demo-http/1"),
        "contract_sha256": _sha(artifacts["ir.json"]),
        "artifacts": {k: _sha(v) for k, v in sorted(artifacts.items()) if k != "manifest.json"},
    })
    return dict(sorted(artifacts.items()))
