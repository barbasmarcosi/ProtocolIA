"""Validated resource/UI projection for the Java demo HTTP profile.

A versioned *sidecar* intentionally avoids silently expanding strict v0.2
contract syntax. The source contract remains authoritative for types, effects,
capabilities and routes. This sidecar can ONLY bind existing operations; it
cannot invent executable actions, authorize users or generate persistence.
"""
from __future__ import annotations

import json
from typing import Any

from . import core
from .compatibility import compare_contracts
from .http_projection import PROFILE, compile_java_http
from .core import validate as validate_contract

BUNDLE_VERSION = "0.1"
BUNDLE_COMPILER = "protocolia/0.2/java-spring-basic-demo-resource-bundle/1"


def _fields(fields: Any, model: str, models: dict, where: str) -> list[str]:
    if not isinstance(fields, list) or not fields or len(fields) > 100:
        core._fail(f"{where}: nonempty field list (at most 100) required")
    core._strlist(fields, f"{where}.fields")
    if any(f not in models[model] for f in fields):
        core._fail(f"{where}: unknown {model} field")
    return list(fields)


def _validate_views(views: Any, bindings: dict, models: dict, where: str) -> dict:
    if not isinstance(views, dict) or set(views) != set(bindings):
        core._fail(f"{where}.views: one view required per declared role/action")
    result = {}
    for role in sorted(bindings):
        obj = views[role]
        core._keys(obj, {"fields"}, {"title"}, f"{where}.views.{role}")
        title = obj.get("title", role)
        if not isinstance(title, str) or not 1 <= len(title) <= 80 or any(ord(c) < 32 for c in title):
            core._fail(f"{where}.views.{role}.title: invalid label")
        model = bindings[role]["viewModel"]
        result[role] = {
            "operationId": bindings[role]["operationId"],
            "model": model,
            "schemaRef": "#/$defs/" + model,
            "fields": _fields(obj["fields"], model, models, f"{where}.views.{role}"),
            "title": title,
        }
    return result


def validate_resource_sidecar(contract: Any, description: Any) -> dict:
    """Return canonical bounded Resource-Operation-View IR or reject ambiguity."""
    ir = validate_contract(contract)
    core._keys(description, {"version", "resources"}, set(), "resource sidecar")
    sidecar_version = description["version"]
    if sidecar_version == BUNDLE_VERSION:
        if ir["version"] != "0.2":
            core._fail("resource sidecar 0.1 requires contract 0.2")
    elif sidecar_version in {"0.2", "0.3"}:
        if ir["version"] != "0.3":
            core._fail("resource sidecar 0.2 requires query-aware contract 0.3")
    elif sidecar_version == "0.3":
        if ir["version"] != "0.4":
            core._fail("resource sidecar 0.3 requires contract 0.4")
    else:
        core._fail("unsupported resource sidecar version")
    resources = description["resources"]
    if not isinstance(resources, dict) or not 1 <= len(resources) <= 50:
        core._fail("resources: expected 1..50 resource definitions")

    all_op_roles = {}
    normalized = {}
    for resource_id in sorted(resources):
        core._name(resource_id, "resource id")
        obj = resources[resource_id]
        where = f"resources.{resource_id}"
        core._keys(obj, {"model", "identityField", "operations", "views", "invalidates"},
                   set(), where)
        model, key = obj["model"], obj["identityField"]
        if not isinstance(model, str) or model not in ir["models"]:
            core._fail(f"{where}.model: unknown model")
        if not isinstance(key, str) or key not in ir["models"][model]:
            core._fail(f"{where}.identityField: unknown identity field")
        ident = ir["models"][model][key]
        if (not ident["required"] or ident["type"] not in {"string", "integer", "uuid"}):
            core._fail(f"{where}.identityField: must be a required scalar identity")
        ops = obj["operations"]
        required_roles = {"detail", "create", "actions"}
        if sidecar_version in {"0.2", "0.3"}:
            required_roles.add("list")
        core._keys(ops, required_roles, set(), f"{where}.operations")
        actions = ops["actions"]
        if not isinstance(actions, dict) or len(actions) > 25:
            core._fail(f"{where}.operations.actions: expected bounded action map")
        roles = {"detail": ops["detail"], "create": ops["create"]}
        if sidecar_version in {"0.2", "0.3"}:
            roles["list"] = ops["list"]
        for action_id, op_name in actions.items():
            core._name(action_id, f"{where}.actions")
            if action_id in roles:
                core._fail(f"{where}: action name collides with role")
            roles[action_id] = op_name

        bindings = {}
        for role in sorted(roles):
            name = roles[role]
            if not isinstance(name, str) or name not in ir["operations"]:
                core._fail(f"{where}.{role}: unknown operationId")
            if name in all_op_roles:
                core._fail(f"{where}.{role}: operation already bound to resource/role")
            op = ir["operations"][name]
            if role == "list":
                page_model = op["response"]
                page = ir["models"].get(page_model)
                good = (op["method"] == "GET" and not op["params"] and
                        "request" not in op and "read" in op["effects"] and
                        "write" not in op["effects"] and op["capability"] != "public" and
                        isinstance(page, dict) and "items" in page and
                        page["items"]["type"] == model + "[]" and
                        page["items"]["required"] and
                        set(op.get("query", {})) == {"limit", "offset"} and
                        op["query"]["limit"]["constraints"]["minimum"] >= 1 and
                        op["query"]["offset"]["constraints"]["minimum"] == 0)
            elif role == "detail":
                good = (op["method"] == "GET" and op["response"] == model and
                        key in op["params"] and len(op["params"]) == 1 and
                        op["params"][key] == ident["type"] and
                        "{" + key + "}" in op["path"] and "request" not in op)
            elif role == "create":
                good = (op["method"] == "POST" and op["response"] == model and
                        "request" in op and not op["params"] and
                        "write" in op["effects"] and op["capability"] != "public")
            else:
                good = (op["method"] in {"POST", "PUT", "PATCH"} and
                        op["response"] == model and "request" in op and
                        op["params"] == {key: ident["type"]} and
                        "{" + key + "}" in op["path"] and
                        "write" in op["effects"] and op["capability"] != "public")
            if not good:
                core._fail(f"{where}.{role}: operation does not satisfy resource role")
            if role == "detail" and "write" in op["effects"]:
                core._fail(f"{where}.{role}: read operation cannot write")
            view_model = (model if role in {"detail", "list"} else
                          op.get("request", op["response"]))
            bindings[role] = {"operationId": name, "role": ("action" if role not in {"create","detail","list"} else role),
                              "viewModel": view_model}
            all_op_roles[name] = {"resource": resource_id,
                                  "role": bindings[role]["role"],
                                  **({"actionId": role} if role not in {"create", "detail", "list"} else {})}
        views = _validate_views(obj["views"], bindings, ir["models"], where)

        invalidation = obj["invalidates"]
        if not isinstance(invalidation, dict):
            core._fail(f"{where}.invalidates: expected mapping")
        expected_writes = {v["operationId"] for k, v in bindings.items() if k not in {"detail", "list"}}
        if set(invalidation) != expected_writes:
            core._fail(f"{where}.invalidates: explicitly list every write operation")
        invalidate = {}
        for name in sorted(invalidation):
            targets = invalidation[name]
            if not isinstance(targets, list) or not targets:
                core._fail(f"{where}.invalidates.{name}: empty targets")
            core._strlist(targets, f"{where}.invalidates.{name}")
            invalidate[name] = sorted(targets)
        normalized_ops = {
            "detail": ops["detail"], "create": ops["create"],
            "actions": {a: actions[a] for a in sorted(actions)},
        }
        if sidecar_version in {"0.2", "0.3"}:
            normalized_ops["list"] = ops["list"]
        normalized[resource_id] = {
            "model": model, "identityField": key,
            "operations": normalized_ops,
            "views": views,
            "invalidates": invalidate,
        }
    for resource_id, obj in normalized.items():
        for targets in obj["invalidates"].values():
            if any(t not in normalized for t in targets) or resource_id not in targets:
                core._fail(f"resources.{resource_id}: invalidation must include own known resource")
    return {"version": sidecar_version, "contractVersion": ir["version"],
            "namespace": ir["namespace"], "resources": normalized,
            "operationBindings": {key: all_op_roles[key] for key in sorted(all_op_roles)}}


def compile_resource_bundle(contract: Any, resources: Any, domain_errors: Any = None) -> dict[str, str]:
    """Emit deterministic HTTP, validated semantic IR and three derived manifests."""
    resource_ir = validate_resource_sidecar(contract, resources)
    ir = validate_contract(contract)
    artifacts = compile_java_http(contract, domain_errors)
    api = json.loads(artifacts["openapi.json"])
    for name, binding in resource_ir["operationBindings"].items():
        op = ir["operations"][name]
        endpoint = api["paths"][op["path"]][op["method"].lower()]
        endpoint["x-protocolia-resource"] = binding["resource"]
        endpoint["x-protocolia-operation-role"] = binding["role"]
        if "actionId" in binding:
            endpoint["x-protocolia-action-id"] = binding["actionId"]
        endpoint["tags"] = [binding["resource"]]
    # Stable relative base URL is truthful for this root-mounted Java demo.
    # Define resource tags at document level, so OpenAPI lint is warning-free.
    api["servers"] = [{"url": "/"}]
    api["tags"] = [{"name": name} for name in sorted(resource_ir["resources"])]
    artifacts["openapi.json"] = core._json(api)
    ui = {"version": resource_ir["version"], "resources": resource_ir["resources"]}
    capability = {"version": resource_ir["version"], "operations": {}}
    for name, op in ir["operations"].items():
        capability["operations"][name] = {
            "capability": op["capability"], "effects": sorted(op["effects"]),
            "method": op["method"], "path": op["path"],
            **resource_ir["operationBindings"].get(name, {}),
        }
    artifacts["resource-ir.json"] = core._json(resource_ir)
    artifacts["ui-manifest.json"] = core._json(ui)
    artifacts["capability-manifest.json"] = core._json(capability)
    artifact_digests = {name: core._sha(content) for name, content in sorted(artifacts.items())
                        if name != "manifest.json"}
    compiler = (BUNDLE_COMPILER if resource_ir["version"] == BUNDLE_VERSION
                else "protocolia/0.3/java-spring-basic-demo-resource-bundle/2"
                if resource_ir["version"] == "0.2"
                else "protocolia/0.4/java-spring-basic-demo-resource-bundle/3")
    artifacts["generation-manifest.json"] = core._json({
        "compiler": compiler, "profile": PROFILE,
        "contractSha256": core._sha(artifacts["ir.json"]),
        "resourceSha256": core._sha(artifacts["resource-ir.json"]),
        "httpProfileSha256": core._sha(artifacts["openapi.json"]),
        "artifacts": artifact_digests,
    })
    artifacts["manifest.json"] = core._json({
        "compiler": compiler, "contract_sha256": core._sha(artifacts["ir.json"]),
        "artifacts": {name: core._sha(body) for name, body in sorted(artifacts.items())
                      if name != "manifest.json"},
    })
    return dict(sorted(artifacts.items()))


def compare_resource_bundles(before_contract: Any, before_resources: Any,
                             after_contract: Any, after_resources: Any) -> dict:
    """Conservative source semantic diff; supplements, never replaces oasdiff."""
    before = validate_resource_sidecar(before_contract, before_resources)
    after = validate_resource_sidecar(after_contract, after_resources)
    contract = compare_contracts(before_contract, after_contract)
    changes = []
    b, a = before["resources"], after["resources"]
    for resource in sorted(b.keys() | a.keys()):
        path = f"resources.{resource}"
        if resource not in a:
            changes.append({"path": path, "severity": "breaking", "kind": "resource_removed"})
        elif resource not in b:
            changes.append({"path": path, "severity": "additive", "kind": "resource_added"})
        else:
            for field in ("model", "identityField", "operations", "views", "invalidates"):
                if b[resource][field] != a[resource][field]:
                    changes.append({"path": f"{path}.{field}", "severity": "breaking",
                                    "kind": "semantic_binding_changed"})
    breaking = contract["breaking"] + sum(c["severity"] == "breaking" for c in changes)
    return {"compatible": breaking == 0, "breaking": breaking,
            "wireContract": contract, "semanticChanges": changes,
            "scope": "conservative operation/capability/resource/view comparison, not behavioral equivalence"}
