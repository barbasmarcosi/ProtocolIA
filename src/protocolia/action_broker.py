"""P3-B2.1: typed DAG -> one trusted-host approved read-only Docker action.

This deliberately DOES NOT modify the v0.4 SQLite transactional runner. External
effects cannot be bundled into a SQLite atomic transaction. Instead, a distinct
v0.5 DAG accepts one read-only sandbox operation and pure postconditions, and
reuses the P3-B1 durable, single-attempt approval/ledger boundary.

No arbitrary shell, scripts, process, filesystem writing, network or paid tools.
Host policy, approval key, image ID and resources remain outside the agent plan.
"""
from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any, Callable

from .action_runtime import (
    ExecutionDenied, _argument, _deny, _digest, _exact, _identifier,
    _json, _key,
)
from . import sandbox_adapter as docker

BROKER_VERSION = "protocolia/broker/0.5.0"
TOOL_TYPES = {
    "literal": ("compute.literal", [], {"value"}, "string"),
    "sha256": ("compute.sha256", [], {"value"}, "string"),
    "assert.eq": ("compute.assert", [], {"left", "right"}, "boolean"),
    "file.sha256": ("file.sha256", ["read"], {"resource"}, "string"),
}


def validate_broker_plan(plan: Any) -> dict:
    """Validate a separate typed DAG with exactly one external read action."""
    raw = _exact(plan, {"version", "plan_id", "actions"}, "broker plan")
    if raw["version"] != "0.5":
        _deny("unsupported broker plan version")
    _identifier(raw["plan_id"], "broker plan ID")
    actions = raw["actions"]
    if type(actions) is not list or not 1 <= len(actions) <= 32:
        _deny("broker actions must be 1..32")
    by_id = {}
    for action in actions:
        a = _exact(action, {"id", "tool", "args", "depends_on", "capability",
                            "effects", "timeout_ms", "output_type"}, "broker action")
        aid = _identifier(a["id"], "action ID")
        if aid in by_id:
            _deny("duplicate broker action ID")
        name = a["tool"]
        if type(name) is not str or name not in TOOL_TYPES:
            _deny("forbidden broker tool: only read-only or pure tools allowed")
        cap, effects, keys, result_type = TOOL_TYPES[name]
        if (a["capability"], a["effects"], a["output_type"]) != (
                cap, effects, result_type):
            _deny("forged broker capability, effects or output type")
        if type(a["timeout_ms"]) is not int or not 1 <= a["timeout_ms"] <= 15000:
            _deny("unbounded broker action timeout")
        _exact(a["args"], keys, aid + ".args")
        for k, v in a["args"].items():
            if k == "resource":
                _key(v)
            else:
                _argument(v, aid + "." + k)
        deps = a["depends_on"]
        if type(deps) is not list or any(type(v) is not str for v in deps):
            _deny("malformed action dependencies")
        if len(deps) != len(set(deps)):
            _deny("duplicate action dependencies")
        for dep in deps:
            _identifier(dep, "dependency")
            if dep == aid:
                _deny("self dependency")
        by_id[aid] = a
    if sum(a["tool"] == "file.sha256" for a in by_id.values()) != 1:
        _deny("exactly one bounded external read required")
    for a in by_id.values():
        for dep in a["depends_on"]:
            if dep not in by_id:
                _deny("unknown broker dependency")
        for arg in a["args"].values():
            if type(arg) is dict:
                source = arg["from"]
                if source not in a["depends_on"] or by_id[source]["output_type"] != "string":
                    _deny("unbound or wrong-typed broker reference")
    order = []
    pending = set(by_id)
    while pending:
        ready = sorted(k for k in pending if set(by_id[k]["depends_on"]).issubset(order))
        if not ready:
            _deny("cyclic broker actions")
        order.extend(ready)
        pending.difference_update(ready)
    normalized = {
        "version": "0.5", "plan_id": raw["plan_id"],
        "actions": [by_id[k] for k in order], "engine": BROKER_VERSION,
    }
    try:
        _json(normalized)
    except (TypeError, ValueError, RecursionError):
        _deny("unserializable broker plan")
    return normalized


def _host_policy(policy: Any) -> dict:
    p = _exact(policy, {"version", "grants", "max_actions",
                        "max_external_reads", "max_duration_ms"}, "host broker policy")
    if p["version"] != "0.5" or type(p["grants"]) is not dict:
        _deny("invalid host broker policy")
    if set(p["grants"]) - {v[0] for v in TOOL_TYPES.values()}:
        _deny("unsupported host broker capability")
    for capability, allowed in p["grants"].items():
        if type(allowed) is not list or any(type(x) is not str for x in allowed):
            _deny("malformed broker resource grant")
        if len(allowed) != len(set(allowed)):
            _deny("duplicate broker resource grant")
        for resource in allowed:
            if capability.startswith("compute."):
                if resource != "*":
                    _deny("pure compute grant must be '*'")
            else:
                _key(resource)
    for key, bound in (("max_actions", 32), ("max_external_reads", 1),
                       ("max_duration_ms", 60000)):
        if type(p[key]) is not int or not 0 <= p[key] <= bound:
            _deny("invalid host broker budget")
    return p


def _preflight(plan: Any, host_policy: Any, docker_policy: Any,
               inputs: Path) -> tuple[dict, dict, dict, dict, dict]:
    ir = validate_broker_plan(plan)
    host = _host_policy(host_policy)
    if len(ir["actions"]) > host["max_actions"] or host["max_external_reads"] != 1:
        _deny("broker action/read budget exceeded")
    if sum(a["timeout_ms"] for a in ir["actions"]) > host["max_duration_ms"]:
        _deny("broker total timeout reservation exceeded")
    external = None
    for action in ir["actions"]:
        capability = action["capability"]
        resource = action["args"]["resource"] if action["tool"] == "file.sha256" else "*"
        if resource not in host["grants"].get(capability, []):
            _deny("host broker capability/resource denied: " + action["id"])
        if action["tool"] == "file.sha256":
            external = action
    assert external is not None  # Guaranteed by validate_broker_plan.
    # Immutable request identifier is bound to the ENTIRE normalized plan and
    # host broker policy, not a model-selectable standalone Docker request ID.
    request_id = "b" + hashlib.sha256(_json({
        "plan_sha": _digest(ir), "host_sha": _digest(host),
        "external_id": external["id"],
    }).encode("utf-8")).hexdigest()[:40]
    request = {"version": "0.5", "request_id": request_id,
               "tool": "file.sha256", "resource": external["args"]["resource"]}
    if type(docker_policy) is not dict:
        _deny("invalid host Docker policy")
    # A host-owned policy copy bounds Docker timeout to the plan's declaration.
    bounded = dict(docker_policy)
    if type(bounded.get("timeout_ms")) is not int:
        _deny("invalid Docker time budget")
    bounded["timeout_ms"] = min(bounded["timeout_ms"], external["timeout_ms"])
    fingerprint = docker.preview(request, bounded, inputs)
    return ir, host, request, bounded, fingerprint


def preview_plan(plan: Any, host_policy: Any, docker_policy: Any,
                 inputs: Path) -> dict:
    """Pure planning: reads a bounded input snapshot, but opens no ledger."""
    ir, host, request, bounded, fingerprint = _preflight(
        plan, host_policy, docker_policy, inputs)
    return {"plan_sha256": _digest(ir), "host_policy_sha256": _digest(host),
            "order": [a["id"] for a in ir["actions"]],
            "external_request": request,
            "external_snapshot": fingerprint,
            "external_timeout_ms": bounded["timeout_ms"],
            "max_external_reads": 1, "estimated_cost_usd": 0}


def approve_plan(plan: Any, host_policy: Any, docker_policy: Any,
                 inputs: Path, workspace: Path, *, subject: str,
                 environment: str, secret: bytes, ttl: int = 300,
                 now: Callable[[], float] = time.time) -> dict:
    """Trusted, authenticated host boundary ONLY, never a model-facing tool."""
    ir, host, request, bounded, fingerprint = _preflight(
        plan, host_policy, docker_policy, inputs)
    result = docker.approve(request, bounded, inputs, workspace,
                            subject=subject, environment=environment,
                            secret=secret, ttl=ttl, now=now)
    return {"plan_sha256": _digest(ir), "host_policy_sha256": _digest(host),
            "external_request_id": request["request_id"],
            "external_input_sha256": fingerprint["input_sha256"],
            **result}


def _value(argument: Any, outputs: dict) -> str:
    value = outputs[argument["from"]] if type(argument) is dict else argument
    if type(value) is not str:
        _deny("unexpected non-string broker dataflow")
    return value


def run_plan(plan: Any, host_policy: Any, docker_policy: Any,
             inputs: Path, workspace: Path, *, subject: str,
             environment: str, secret: bytes, cancelled=None,
             now: Callable[[], float] = time.time,
             clock: Callable[[], float] = time.monotonic,
             runner=None) -> dict:
    """Serial DAG; one idempotent read-only external effect, no local writes.

    The adapter holds the durable approval and single-attempt journal.
    This is NOT an atomic transaction spanning Docker and SQLite.
    """
    ir, host, request, bounded, fingerprint = _preflight(
        plan, host_policy, docker_policy, inputs)
    started = clock()
    deadline = started + host["max_duration_ms"] / 1000

    def guard():
        if cancelled is not None and cancelled():
            _deny("host cancelled broker plan")
        if clock() > deadline:
            _deny("broker deadline expired")

    outputs = {}
    external_evidence = None
    for action in ir["actions"]:
        guard()
        action_started = clock()
        tool, args = action["tool"], action["args"]
        if tool == "literal":
            value = _value(args["value"], outputs)
        elif tool == "sha256":
            value = hashlib.sha256(_value(args["value"], outputs).encode()).hexdigest()
        elif tool == "assert.eq":
            value = _value(args["left"], outputs) == _value(args["right"], outputs)
            if not value:
                _deny("broker assertion failed: " + action["id"])
        elif tool == "file.sha256":
            options = {"subject": subject, "environment": environment,
                       "secret": secret, "now": now, "cancelled": cancelled}
            if runner is not None:
                options["runner"] = runner
            result = docker.run(request, bounded, inputs, workspace, **options)
            value = result["result"]["sha256"]
            external_evidence = {
                "status": result["status"],
                "request_id": request["request_id"],
                "input_sha256": result["input_sha256"],
                "tool_fingerprint": result["tool_fingerprint"],
                "evidence_sha256": _digest(result["result"]),
            }
        else:
            _deny("broker tool not implemented")
        outputs[action["id"]] = value
        guard()
        if (clock() - action_started) * 1000 > action["timeout_ms"]:
            _deny("broker per-action deadline expired")
    return {"status": external_evidence["status"],
            "plan_sha256": _digest(ir), "host_policy_sha256": _digest(host),
            "outputs": outputs, "external_evidence": external_evidence,
            "estimated_cost_usd": 0}
