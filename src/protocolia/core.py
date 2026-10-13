"""ProtocolIA v0: strict, deterministic, provider-free contract compiler.

Contracts specify structure, not arbitrary executable business logic.  In particular,
this compiler makes no claim to enforce runtime business invariants.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

IDENT = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
ROUTE = re.compile(r"^/(?:[A-Za-z0-9_-]+|\{[A-Za-z][A-Za-z0-9_]*\})(?:/(?:[A-Za-z0-9_-]+|\{[A-Za-z][A-Za-z0-9_]*\}))*$")
PRIMITIVES = {"string", "integer", "number", "boolean", "uuid", "datetime"}
METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
TS_RESERVED = {"any", "as", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "get", "if", "implements", "import", "in", "instanceof", "interface", "let", "module", "new", "null", "of", "package", "private", "protected", "public", "readonly", "return", "set", "static", "super", "switch", "this", "throw", "true", "try", "type", "typeof", "var", "void", "while", "with", "yield"}
EFFECTS = {"read", "write"}


class ContractError(ValueError):
    """Invalid contract or unsafe/ambiguous output."""


def _fail(message: str) -> None:
    raise ContractError(message)


def _keys(obj: Any, required: set[str], optional: set[str], where: str) -> None:
    if not isinstance(obj, dict):
        _fail(f"{where}: expected object")
    missing = required - obj.keys()
    unknown = obj.keys() - required - optional
    if missing or unknown:
        _fail(f"{where}: missing {sorted(missing)}; unknown {sorted(unknown)}")


def _name(value: Any, where: str) -> None:
    if not isinstance(value, str) or not IDENT.fullmatch(value):
        _fail(f"{where}: invalid identifier")


def _strlist(value: Any, where: str) -> None:
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value) or len(value) != len(set(value)):
        _fail(f"{where}: expected unique string array")


def _parse_type(value: Any, models: dict[str, Any], where: str) -> tuple[str, bool]:
    if not isinstance(value, str) or not value or value.count("[]") > 1:
        _fail(f"{where}: invalid type")
    array = value.endswith("[]")
    base = value[:-2] if array else value
    if base not in PRIMITIVES and base not in models:
        _fail(f"{where}: unknown type {base!r}")
    return base, array


def validate(contract: Any) -> dict[str, Any]:
    """Validate and normalize without executing user-supplied instructions."""
    if isinstance(contract, dict) and contract.get("version") == "0.4":
        from .v04 import validate as validate_v04
        return validate_v04(contract)
    if isinstance(contract, dict) and contract.get("version") == "0.3":
        from .v03 import validate as validate_v03
        return validate_v03(contract)
    if isinstance(contract, dict) and contract.get("version") == "0.2":
        from .v02 import validate as validate_v02
        return validate_v02(contract)
    _keys(contract, {"version", "namespace", "models", "operations"}, set(), "contract")
    if contract["version"] != "0.1":
        _fail("contract.version: only '0.1' is supported")
    _name(contract["namespace"], "namespace")
    models, ops = contract["models"], contract["operations"]
    if not isinstance(models, dict) or not isinstance(ops, dict):
        _fail("models and operations must be objects")
    if not models or not ops:
        _fail("at least one model and operation are required")
    if len(models) > 200 or len(ops) > 200:
        _fail("contract exceeds 200 models or operations")
    for model, fields in models.items():
        _name(model, "model")
        if model in PRIMITIVES or model in TS_RESERVED:
            _fail(f"model {model}: reserved name")
        if not isinstance(fields, dict) or not fields:
            _fail(f"model {model}: expected nonempty field map")
        for field, spec in fields.items():
            _name(field, f"model {model} field")
            _keys(spec, {"type", "required"}, set(), f"{model}.{field}")
            _parse_type(spec["type"], models, f"{model}.{field}")
            if type(spec["required"]) is not bool:
                _fail(f"{model}.{field}.required: expected boolean")
    seen_routes: set[tuple[str, str]] = set()
    for name, op in ops.items():
        _name(name, "operation")
        _keys(op, {"method", "path", "response", "capability", "effects", "depends_on"}, {"request"}, name)
        if not isinstance(op["method"], str) or op["method"] not in METHODS:
            _fail(f"{name}.method: unsupported method")
        if not isinstance(op["path"], str) or not ROUTE.fullmatch(op["path"]):
            _fail(f"{name}.path: unsupported route syntax")
        if "{" in op["path"]:
            _fail(f"{name}.path: path parameters are not supported in v0.1")
        route = (op["method"], op["path"])
        if route in seen_routes:
            _fail(f"{name}: duplicate method/path")
        seen_routes.add(route)
        if not isinstance(op["response"], str) or op["response"] not in models or ("request" in op and (not isinstance(op["request"], str) or op["request"] not in models)):
            _fail(f"{name}: unknown request/response model")
        if not isinstance(op["capability"], str) or not (op["capability"] == "public" or re.fullmatch(r"[a-z][a-z0-9_.-]{0,79}", op["capability"])):
            _fail(f"{name}.capability: invalid value")
        _strlist(op["effects"], f"{name}.effects")
        _strlist(op["depends_on"], f"{name}.depends_on")
        if not set(op["effects"]).issubset(EFFECTS):
            _fail(f"{name}: unknown effects")
        if "write" in op["effects"] and (op["method"] == "GET" or op["capability"] == "public"):
            _fail(f"{name}: writes require non-GET and non-public capability")
        if op["method"] in {"POST", "PUT", "PATCH"} and "request" not in op:
            _fail(f"{name}: request model required")
        if name in op["depends_on"] or any(dep not in ops for dep in op["depends_on"]):
            _fail(f"{name}: invalid dependency")
    # Canonical DAG order, lexicographically stable for independent operations.
    remaining = {key: set(val["depends_on"]) for key, val in ops.items()}
    emitted: list[str] = []
    while remaining:
        ready = sorted(key for key, deps in remaining.items() if not deps)
        if not ready:
            _fail("operations: cyclic dependencies")
        for key in ready:
            emitted.append(key)
            del remaining[key]
        for deps in remaining.values():
            deps.difference_update(ready)
    # Materialize normalized form with independent ordering of all maps.
    return {
        "version": "0.1", "namespace": contract["namespace"],
        "models": {model: {field: dict(fields[field]) for field in sorted(fields)} for model, fields in sorted(models.items())},
        "operations": {name: {key: op[key] for key in sorted(op)} for name, op in sorted(ops.items())},
        "execution_order": emitted,
    }


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _schema(type_name: str, models: dict[str, Any]) -> dict[str, Any]:
    base, array = _parse_type(type_name, models, "type")
    schema: dict[str, Any] = (
        {"$ref": "#/components/schemas/" + base} if base in models else
        {"type": {"uuid": "string", "datetime": "string"}.get(base, base)}
    )
    if base in {"uuid", "datetime"}:
        schema["format"] = {"uuid": "uuid", "datetime": "date-time"}[base]
    return {"type": "array", "items": schema} if array else schema


def compile_contract(contract: Any) -> dict[str, str]:
    """Compile a v0.1 contract into reproducible, non-executable artifacts."""
    if isinstance(contract, dict) and contract.get("version") == "0.4":
        from .v04 import compile_contract as compile_v04
        return compile_v04(contract)
    if isinstance(contract, dict) and contract.get("version") == "0.3":
        from .v03 import compile_contract as compile_v03
        return compile_v03(contract)
    if isinstance(contract, dict) and contract.get("version") == "0.2":
        from .v02 import compile_contract as compile_v02
        return compile_v02(contract)
    ir = validate(contract)
    models = ir["models"]
    schemas: dict[str, Any] = {}
    for model, fields in models.items():
        schemas[model] = {
            "type": "object", "additionalProperties": False,
            "properties": {name: _schema(field["type"], models) for name, field in fields.items()},
            "required": [name for name, field in fields.items() if field["required"]],
        }
    paths: dict[str, Any] = {}
    for name, op in ir["operations"].items():
        response = {"$ref": f"#/components/schemas/{op['response']}"}
        endpoint: dict[str, Any] = {
            "operationId": name, "responses": {"200": {"description": "Successful response", "content": {"application/json": {"schema": response}}}},
            "x-protocolia-effects": op["effects"], "x-protocolia-dependencies": op["depends_on"],
            "x-protocolia-capability": op["capability"],
        }
        if "request" in op:
            endpoint["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"$ref": f"#/components/schemas/{op['request']}"}}}}
        endpoint["security"] = [] if op["capability"] == "public" else [{"bearerAuth": []}]
        paths.setdefault(op["path"], {})[op["method"].lower()] = endpoint
    api = {
        "openapi": "3.1.0", "info": {"title": ir["namespace"], "version": ir["version"]},
        "paths": {k: paths[k] for k in sorted(paths)},
        "components": {"schemas": schemas, "securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}}},
    }
    type_map = {"string": "string", "uuid": "string", "datetime": "string", "integer": "number", "number": "number", "boolean": "boolean"}
    lines = ["// Generated by ProtocolIA v0.1. DO NOT EDIT.", "// Types describe wire data; they do not implement runtime checks.", ""]
    for model, fields in models.items():
        lines.append(f"export interface {model} {{")
        for field, spec in fields.items():
            base, arr = _parse_type(spec["type"], models, "type")
            mapped = type_map.get(base, base)
            lines.append(f"  {field}{'' if spec['required'] else '?'}: {mapped}{'[]' if arr else ''};")
        lines.extend(["}", ""])
    artifacts = {
        "ir.json": _json(ir), "openapi.json": _json(api), "types.ts": "\n".join(lines),
    }
    artifacts["manifest.json"] = _json({
        "compiler": "protocolia/0.1", "contract_sha256": _sha(_json(ir)),
        "artifacts": {name: _sha(content) for name, content in sorted(artifacts.items())},
    })
    return artifacts


def write_artifacts(artifacts: dict[str, str], output: Path) -> None:
    """Safely replace only pristine ProtocolIA-owned outputs; reject symlinks."""
    output = Path(output)
    for path in (output, *output.parents):
        if path.is_symlink():
            _fail(f"symlink output directory prohibited: {path}")
    output.mkdir(parents=True, exist_ok=True)
    expected = set(artifacts)
    manifest_path = output / "manifest.json"
    if manifest_path.is_symlink():
        _fail("symlink manifest prohibited")
    if manifest_path.exists():
        try:
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
            known = previous["artifacts"]
            if previous["compiler"] != json.loads(artifacts["manifest.json"])["compiler"] or set(known) != expected - {"manifest.json"}:
                _fail("existing manifest is incompatible")
        except (OSError, ValueError, KeyError, TypeError):
            _fail("invalid existing manifest")
        for name, digest in known.items():
            path = output / name
            if path.is_symlink() or not path.is_file() or _sha(path.read_text(encoding="utf-8")) != digest:
                _fail(f"generated artifact modified or missing: {name}")
    elif any((output / name).exists() or (output / name).is_symlink() for name in expected):
        _fail("unmanaged files already exist; refusing overwrite")
    for name in expected:
        if name not in {"ir.json", "openapi.json", "types.ts", "manifest.json", "payload.schema.json", "resource-ir.json", "ui-manifest.json", "capability-manifest.json", "generation-manifest.json"}:
            _fail("unsupported artifact name")
    # Stage every file before replacing; staged names live within the output folder.
    staged: list[tuple[Path, Path]] = []
    try:
        for name, content in sorted(artifacts.items(), key=lambda pair: pair[0] == "manifest.json"):
            fd, temporary = tempfile.mkstemp(prefix=".protocolia-", dir=output)
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                stream.write(content)
            staged.append((Path(temporary), output / name))
        for temporary, destination in staged:
            os.replace(temporary, destination)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)


def preview_artifacts(artifacts: dict[str, str], output: Path) -> dict[str, object]:
    """Pure, conservative regeneration preview. No directory creation or writes.

    A preview is advisory, not a TOCTOU-safe commitment: write_artifacts must
    validate ownership again before replacing anything.
    """
    output = Path(output)
    expected = set(artifacts)
    if not expected.issubset({"ir.json", "openapi.json", "types.ts", "manifest.json", "payload.schema.json", "resource-ir.json", "ui-manifest.json", "capability-manifest.json", "generation-manifest.json"}) or "manifest.json" not in expected:
        _fail("unsupported artifact set")
    for path in (output, *output.parents):
        if path.is_symlink():
            _fail("symlink output directory prohibited")
    manifest = output / "manifest.json"
    if manifest.is_symlink():
        _fail("symlink manifest prohibited")
    if manifest.exists():
        try:
            previous = json.loads(manifest.read_text(encoding="utf-8"))
            old = previous["artifacts"]
            if previous["compiler"] != json.loads(artifacts["manifest.json"])["compiler"] or set(old) != expected - {"manifest.json"}:
                _fail("incompatible manifest version or artifact ownership")
            for name, digest in old.items():
                path = output / name
                if path.is_symlink() or not path.is_file() or _sha(path.read_text(encoding="utf-8")) != digest:
                    _fail(f"generated artifact modified or missing: {name}")
        except (OSError, ValueError, KeyError, TypeError):
            _fail("invalid existing manifest")
    elif any((output / name).exists() or (output / name).is_symlink() for name in expected):
        _fail("unmanaged files already exist")
    statuses = {name: ("create" if not manifest.exists() else ("unchanged" if
                _sha((output / name).read_text(encoding="utf-8")) == _sha(content) else "update"))
                for name, content in sorted(artifacts.items())}
    return {"changed": sum(x != "unchanged" for x in statuses.values()), "files": statuses, "writes_performed": 0}
