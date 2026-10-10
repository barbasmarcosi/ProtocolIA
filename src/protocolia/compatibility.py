"""Conservative syntactic compatibility diff for ProtocolIA v0.1 contracts.

This checks supported wire/API contract shapes, NOT behavioral equivalence,
authorization at runtime, database evolution, security or domain invariants.
"""
from __future__ import annotations

from typing import Any

from .core import _json, _sha, validate


def compare_contracts(before: Any, after: Any) -> dict[str, Any]:
    """Return reproducible, conservative compatibility diagnostics.

    Differences in existing operation metadata are treated as breaking even
    when a particular use case might tolerate them. New OPTIONAL fields and
    new models/operations are additive. Introducing required fields is breaking.
    """
    old, new = validate(before), validate(after)
    changes: list[dict[str, str]] = []

    def record(kind: str, path: str, severity: str) -> None:
        changes.append({"kind": kind, "path": path, "severity": severity})

    if old["namespace"] != new["namespace"]:
        record("namespace_changed", "namespace", "breaking")
    old_models, new_models = old["models"], new["models"]
    for model in sorted(old_models.keys() | new_models.keys()):
        location = f"models.{model}"
        if model not in new_models:
            record("model_removed", location, "breaking")
        elif model not in old_models:
            record("model_added", location, "additive")
        else:
            old_fields, new_fields = old_models[model], new_models[model]
            for field in sorted(old_fields.keys() | new_fields.keys()):
                field_location = f"{location}.{field}"
                if field not in new_fields:
                    record("field_removed", field_location, "breaking")
                elif field not in old_fields:
                    record("required_field_added" if new_fields[field]["required"] else "optional_field_added", field_location,
                           "breaking" if new_fields[field]["required"] else "additive")
                elif old_fields[field] != new_fields[field]:
                    record("field_type_or_required_changed", field_location, "breaking")
    old_ops, new_ops = old["operations"], new["operations"]
    for name in sorted(old_ops.keys() | new_ops.keys()):
        location = f"operations.{name}"
        if name not in new_ops:
            record("operation_removed", location, "breaking")
        elif name not in old_ops:
            record("operation_added", location, "additive")
        else:
            keys = old_ops[name].keys() | new_ops[name].keys()
            for key in sorted(keys):
                a, b = old_ops[name].get(key), new_ops[name].get(key)
                if key in {"effects", "depends_on"}:
                    a = sorted(a) if a is not None else a
                    b = sorted(b) if b is not None else b
                if a != b:
                    record("operation_contract_changed", f"{location}.{key}", "breaking")
    changes.sort(key=lambda entry: (entry["path"], entry["kind"], entry["severity"]))
    breaking = sum(entry["severity"] == "breaking" for entry in changes)
    additive = len(changes) - breaking
    return {
        "version": "0.1", "old_ir_sha256": _sha(_json(old)), "new_ir_sha256": _sha(_json(new)),
        "compatible": breaking == 0, "breaking": breaking, "additive": additive, "changes": changes,
        "scope": "conservative syntactic v0.1 API compatibility; not behavioral equivalence",
    }
