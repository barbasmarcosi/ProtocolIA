"""P3 provider-free, capability-gated action IR and durable local SQLite executor.

Not an arbitrary agent/tool runner: only literal, sha256, assert.eq and
SQLite key/value read/write exist. Caller supplies policy and a trusted
workspace. One transaction atomically commits effects, evidence and journal.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Callable

ENGINE_VERSION = "protocolia-action/0.4.0"
TOOLS = {
    "literal": ("compute.literal", (), ("value",), "string"),
    "sha256": ("compute.sha256", (), ("value",), "string"),
    "assert.eq": ("compute.assert", (), ("left", "right"), "boolean"),
    "kv.read": ("kv.read", ("read",), ("key",), "string"),
    "kv.put": ("kv.write", ("write",), ("key", "value"), "string"),
}
ID = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")
KEY = re.compile(r"^[a-z][a-z0-9_-]*(?:/[a-z][a-z0-9_-]*){0,7}$")


class ExecutionDenied(ValueError):
    """Invalid plan, denied authority, stale evidence or failed effect."""


def _deny(reason: str) -> None:
    raise ExecutionDenied(reason)


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def _digest(value: Any) -> str:
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _exact(value: Any, keys: set[str], where: str) -> dict:
    if type(value) is not dict or set(value) != keys:
        _deny(where + ": invalid object keys")
    return value


def _identifier(value: Any, where: str) -> str:
    if type(value) is not str or not ID.fullmatch(value):
        _deny(where + ": invalid identifier")
    return value


def _key(value: Any) -> str:
    if type(value) is not str or not KEY.fullmatch(value):
        _deny("invalid key/resource (no traversal, dots, escapes or absolute paths)")
    return value


def _argument(value: Any, where: str) -> None:
    if type(value) is str:
        if len(value) > 4096:
            _deny(where + ": argument too long")
    elif type(value) is dict and set(value) == {"from"}:
        _identifier(value["from"], where)
    else:
        _deny(where + ": only strings or typed {from: action} references allowed")


def validate_plan(raw: Any) -> dict:
    """Compile strict, versioned action IR into a stable, dependency-ordered DAG."""
    p = _exact(raw, {"version", "plan_id", "actions"}, "plan")
    if p["version"] != "0.4":
        _deny("unsupported action plan version")
    _identifier(p["plan_id"], "plan_id")
    if type(p["actions"]) is not list or not 1 <= len(p["actions"]) <= 64:
        _deny("action count must be 1..64")
    by_id: dict[str, dict] = {}
    for a in p["actions"]:
        _exact(a, {"id", "tool", "args", "depends_on", "capability", "effects", "timeout_ms", "output_type"}, "action")
        aid = _identifier(a["id"], "action id")
        if aid in by_id:
            _deny("duplicate action id: " + aid)
        tool = a["tool"]
        if type(tool) is not str or tool not in TOOLS:
            _deny("tool not allowlisted")
        cap, effects, args, output_type = TOOLS[tool]
        if a["capability"] != cap or a["effects"] != list(effects) or a["output_type"] != output_type:
            _deny("forged capability, effects or declared output type: " + aid)
        if type(a["timeout_ms"]) is not int or not 1 <= a["timeout_ms"] <= 10000:
            _deny("unbounded/invalid action timeout")
        _exact(a["args"], set(args), "args")
        for name in args:
            if name == "key":
                _key(a["args"][name])
            else:
                _argument(a["args"][name], aid + "." + name)
        deps = a["depends_on"]
        if type(deps) is not list or len(deps) != len(set(map(str, deps))):
            _deny("duplicate or invalid dependencies")
        for dep in deps:
            _identifier(dep, "dependency")
            if dep == aid:
                _deny("self dependency")
        by_id[aid] = a
    for aid, a in by_id.items():
        for dep in a["depends_on"]:
            if dep not in by_id:
                _deny("unknown dependency: " + dep)
        for arg in a["args"].values():
            if type(arg) is dict:
                source = arg["from"]
                if source not in a["depends_on"] or by_id[source]["output_type"] != "string":
                    _deny("unbound or wrong-typed dataflow edge: " + source)
    ordered: list[str] = []
    pending = set(by_id)
    while pending:
        available = sorted(aid for aid in pending if set(by_id[aid]["depends_on"]).issubset(ordered))
        if not available:
            _deny("cyclic action dependencies")
        ordered.extend(available)
        pending.difference_update(available)
    ancestors: dict[str, set[str]] = {}
    for aid in ordered:
        ancestors[aid] = set(by_id[aid]["depends_on"])
        for dep in by_id[aid]["depends_on"]:
            ancestors[aid].update(ancestors[dep])
    for i, aid in enumerate(ordered):
        a = by_id[aid]
        if a["tool"] not in {"kv.read", "kv.put"}:
            continue
        for later in ordered[i + 1:]:
            b = by_id[later]
            if b["tool"] in {"kv.read", "kv.put"} and b["args"]["key"] == a["args"]["key"]:
                if "kv.put" in (a["tool"], b["tool"]):
                    if aid not in ancestors[later] and later not in ancestors[aid]:
                        _deny("unordered conflicting effects on " + a["args"]["key"])
    normalized = {
        "version": "0.4", "plan_id": p["plan_id"],
        "actions": [by_id[aid] for aid in ordered],
        "engine": ENGINE_VERSION,
    }
    # Revalidate serializability and bounded nesting before hash/effects.
    try:
        _json(normalized)
    except (TypeError, ValueError, RecursionError) as exc:
        _deny("invalid canonical plan: " + type(exc).__name__)
    return normalized


def _policy(policy: Any) -> dict:
    p = _exact(policy, {"grants", "max_actions", "max_writes", "max_duration_ms"}, "policy")
    if type(p["grants"]) is not dict or set(p["grants"]) - {spec[0] for spec in TOOLS.values()}:
        _deny("unknown capability grant")
    for capability, resources in p["grants"].items():
        if type(resources) is not list or len(resources) != len(set(map(str, resources))):
            _deny("invalid grants")
        for resource in resources:
            if capability.startswith("compute."):
                if resource != "*":
                    _deny("compute grants require explicit '*'")
            else:
                _key(resource)
    for key, maximum in (("max_actions", 64), ("max_writes", 64), ("max_duration_ms", 60000)):
        value = p[key]
        if type(value) is not int or not 0 <= value <= maximum:
            _deny("invalid policy budget " + key)
    return p


def _preflight(ir: dict, policy: dict) -> dict:
    actions = ir["actions"]
    writes = sum(a["tool"] == "kv.put" for a in actions)
    if len(actions) > policy["max_actions"] or writes > policy["max_writes"]:
        _deny("action/write budget overflow")
    for action in actions:
        capability = action["capability"]
        resource = action["args"]["key"] if action["tool"] in {"kv.read", "kv.put"} else "*"
        if resource not in policy["grants"].get(capability, []):
            _deny("capability/resource denied for " + action["id"])
        if action["timeout_ms"] > policy["max_duration_ms"]:
            _deny("per-step timeout exceeds trusted budget")
    return {"plan_hash": _digest(ir), "policy_hash": _digest(policy),
            "order": [a["id"] for a in actions], "steps": len(actions), "writes": writes,
            "effects": [{"id": a["id"], "effect": a["effects"], "resource": a["args"].get("key")}
                        for a in actions if a["effects"]]}


def dry_run(plan: Any, policy: Any) -> dict:
    """Full validation and authorization WITHOUT opening a ledger or writing state."""
    return _preflight(validate_plan(plan), _policy(policy))


def _workspace(root: Path) -> Path:
    root = Path(root)
    if not root.is_dir():
        _deny("trusted state directory must already exist")
    for item in (root, *root.parents):
        if item.is_symlink():
            _deny("symlink workspace component denied")
    journal = root / "protocolia-action.sqlite3"
    if journal.is_symlink() or (journal.exists() and not journal.is_file()):
        _deny("unsafe action journal")
    return journal


def _resolve(arg: Any, outputs: dict) -> str:
    value = outputs[arg["from"]] if type(arg) is dict else arg
    if type(value) is not str:
        _deny("non-string dataflow value")
    return value


def execute(plan: Any, policy: Any, workspace: Path, *, environment: str,
            cancelled: Callable[[], bool] | None = None,
            clock: Callable[[], float] = time.monotonic) -> dict:
    """Execute all actions transactionally; replay exact matching evidence only.

    Trust boundary: workspace path, runtime policy, clock, cancellation and
    environment identity MUST be supplied by the host, not the model/plan.
    No arbitrary external tools, process execution or network access.
    """
    ir = validate_plan(plan)
    approved = _preflight(ir, _policy(policy))
    if type(environment) is not str or not 1 <= len(environment) <= 128:
        _deny("host environment fingerprint is required")
    env_hash = _digest(environment)
    journal = _workspace(workspace)
    start = clock()
    deadline = start + policy["max_duration_ms"] / 1000
    def gate(step_deadline: float) -> None:
        if cancelled is not None and cancelled():
            _deny("cancelled by trusted host")
        if clock() > min(step_deadline, deadline):
            _deny("execution deadline exceeded")
    gate(deadline)
    connection = sqlite3.connect(str(journal), timeout=1, isolation_level=None)
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute("""CREATE TABLE IF NOT EXISTS executions (
            plan_id TEXT PRIMARY KEY, plan_hash TEXT NOT NULL,
            policy_hash TEXT NOT NULL, env_hash TEXT NOT NULL,
            result_json TEXT NOT NULL, result_sha TEXT NOT NULL,
            state_json TEXT NOT NULL)""")
        connection.execute("""CREATE TABLE IF NOT EXISTS events (
            plan_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT NOT NULL,
            digest TEXT NOT NULL, PRIMARY KEY(plan_id,seq))""")
        prior = connection.execute(
            "SELECT plan_hash, policy_hash, env_hash, result_json, result_sha, state_json "
            "FROM executions WHERE plan_id=?", (ir["plan_id"],)).fetchone()
        if prior:
            p_hash, policy_hash, old_env, results_json, results_sha, state_json = prior
            if (p_hash, policy_hash, old_env) != (approved["plan_hash"], approved["policy_hash"], env_hash):
                _deny("stale plan/policy/environment evidence; refuse replay")
            if hashlib.sha256(results_json.encode()).hexdigest() != results_sha:
                _deny("forged result evidence")
            old_events = connection.execute("SELECT event_json,digest FROM events WHERE plan_id=? ORDER BY seq",
                                            (ir["plan_id"],)).fetchall()
            if len(old_events) != len(ir["actions"]) or any(
                    hashlib.sha256(body.encode()).hexdigest() != sig for body, sig in old_events):
                _deny("inconsistent action event evidence")
            for key, expected in json.loads(state_json).items():
                value = connection.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
                if value is None or _digest(value[0]) != expected:
                    _deny("stale external state; do not replay")
            gate(deadline)
            connection.execute("COMMIT")
            return {"status": "replayed", "plan_id": ir["plan_id"], "outputs": json.loads(results_json),
                    "evidence_sha256": results_sha, **approved}
        outputs: dict[str, str | bool] = {}
        touched: set[str] = set()
        for seq, action in enumerate(ir["actions"]):
            step_deadline = min(deadline, clock() + action["timeout_ms"] / 1000)
            gate(step_deadline)
            tool, args = action["tool"], action["args"]
            if tool == "literal":
                value = _resolve(args["value"], outputs)
            elif tool == "sha256":
                value = hashlib.sha256(_resolve(args["value"], outputs).encode()).hexdigest()
            elif tool == "assert.eq":
                value = _resolve(args["left"], outputs) == _resolve(args["right"], outputs)
                if not value:
                    _deny("postcondition failed: " + action["id"])
            elif tool == "kv.read":
                key = args["key"]
                row = connection.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
                if row is None:
                    _deny("missing authorized resource " + key)
                value = row[0]
                touched.add(key)
            elif tool == "kv.put":
                key, value = args["key"], _resolve(args["value"], outputs)
                connection.execute("INSERT INTO kv(key,value) VALUES (?,?) "
                                   "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key,value))
                touched.add(key)
            else:
                _deny("unimplemented tool")
            gate(step_deadline)
            outputs[action["id"]] = value
            event = _json({"id":action["id"], "tool":tool, "args_sha256":_digest(args),
                           "result_sha256":_digest(value), "version":ENGINE_VERSION})
            connection.execute("INSERT INTO events(plan_id,seq,event_json,digest) VALUES (?,?,?,?)",
                               (ir["plan_id"], seq, event, hashlib.sha256(event.encode()).hexdigest()))
        state = {}
        for key in sorted(touched):
            row = connection.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
            if row is None:
                _deny("inconsistent final resource snapshot")
            state[key] = _digest(row[0])
        results_json = _json(outputs)
        results_sha = hashlib.sha256(results_json.encode()).hexdigest()
        gate(deadline)
        connection.execute("INSERT INTO executions VALUES (?,?,?,?,?,?,?)",
                           (ir["plan_id"], approved["plan_hash"], approved["policy_hash"],
                            env_hash, results_json, results_sha, _json(state)))
        connection.execute("COMMIT")
        return {"status":"executed", "plan_id":ir["plan_id"], "outputs":outputs,
                "evidence_sha256":results_sha, **approved}
    except BaseException:
        if connection.in_transaction:
            connection.execute("ROLLBACK")
        raise
    finally:
        connection.close()
