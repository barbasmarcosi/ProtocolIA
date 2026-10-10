"""P3-B3: narrowly scoped Unix-socket operator approval service, Linux only.

This is a local security boundary, NOT an HTTP service or deployed OIDC/SSO.
The executor and private signing-key file live under a privileged service UID;
the planning agent MUST use a distinct unprivileged OS UID. All four operations
use operator-signed intent verification; preview/prepare cannot issue grants.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import socket
import socketserver
import stat
import struct
import time
from typing import Any

from .action_runtime import ExecutionDenied, _deny, _identifier
from .action_broker import preview_plan
from .operator_auth import (
    _protected_bytes, _no_duplicates, create_intent,
    approve_signed, run_signed, revoke_signed,
)

MAX_REQUEST_BYTES = 65536
SERVICE_VERSION = "0.6"
SOCK_NAME = "protocolia-approval.sock"


def _object(value: Any, expected: set[str], name: str) -> dict:
    if type(value) is not dict or set(value) != expected:
        _deny(name + ": unknown or missing fields")
    return value


def _safe_json(raw: bytes) -> Any:
    if len(raw) > MAX_REQUEST_BYTES:
        _deny("request exceeds maximum size")
    def no_constants(value):
        _deny("non-finite JSON constants forbidden")
    try:
        return json.loads(raw, object_pairs_hook=_no_duplicates,
                          parse_constant=no_constants)
    except (ValueError, UnicodeDecodeError, RecursionError):
        _deny("malformed or duplicated JSON payload")


def _private_file_json(path: Path) -> Any:
    return _safe_json(_protected_bytes(path, max_bytes=MAX_REQUEST_BYTES))


def load_config(file: Path) -> dict:
    """Each request reloads host config to detect policy/key revocation."""
    config = _object(_private_file_json(file), {
        "version", "inputs", "workspace", "registry_file", "service_key_file",
        "host_policy_file", "docker_policy_file", "environment", "allowed_uids",
    }, "approval service config")
    if config["version"] != SERVICE_VERSION:
        _deny("unsupported service config version")
    from .sandbox_adapter import _trusted_dir
    for name in ("inputs", "workspace"):
        if type(config[name]) is not str:
            _deny("invalid trusted directory")
        _trusted_dir(Path(config[name]))
    for name in ("registry_file", "service_key_file", "host_policy_file",
                 "docker_policy_file"):
        if type(config[name]) is not str:
            _deny("invalid trusted host file")
        _protected_bytes(Path(config[name]))
    _identifier(config["environment"], "trusted host environment")
    allowed = config["allowed_uids"]
    if (type(allowed) is not list or not 1 <= len(allowed) <= 16
            or any(type(x) is not int or x < 0 for x in allowed)
            or len(allowed) != len(set(allowed))):
        _deny("invalid allowed peer UIDs")
    if not hasattr(socket, "SO_PEERCRED"):
        _deny("kernel SO_PEERCRED unavailable; no unverified identity fallback")
    return config


def _runtime(config: dict) -> tuple[dict, dict]:
    return (_private_file_json(Path(config["host_policy_file"])),
            _private_file_json(Path(config["docker_policy_file"])))


def dispatch(message: Any, config_file: Path, *, peer_uid: int,
             now=time.time, runner=None) -> dict:
    """Do not accept host policy, keys, input/workspace or Docker flags from RPC."""
    config = load_config(config_file)
    if peer_uid not in config["allowed_uids"]:
        _deny("untrusted peer OS UID")
    if type(message) is not dict or "op" not in message:
        _deny("invalid operator service operation")
    op = message["op"]
    plan = message.get("plan")
    if op == "preview":
        _object(message, {"op", "plan"}, "preview request")
        host, docker = _runtime(config)
        p = preview_plan(plan, host, docker, Path(config["inputs"]))
        return {"status": "preview-only", "plan": p}
    if op == "prepare":
        _object(message, {"op", "plan", "subject", "key_id"}, "prepare request")
        host, docker = _runtime(config)
        t = int(now())
        intent = create_intent(
            plan, host, docker, Path(config["inputs"]), Path(config["registry_file"]),
            subject=message["subject"], key_id=message["key_id"],
            environment=config["environment"], issued_at=t, expires_at=t + 180,
            nonce=secrets.token_hex(16))
        # Return the intent to the operator for OUT-OF-PROCESS signing, not a grant.
        return {"status": "signature-required", "intent": intent}
    if op not in ("approve", "execute", "revoke"):
        _deny("unknown or disallowed service operation")
    _object(message, {"op", "plan", "envelope"}, op + " request")
    host, docker = _runtime(config)
    kwargs = {
        "registry_file": Path(config["registry_file"]),
        "service_key_file": Path(config["service_key_file"]),
        "host_environment": config["environment"],
        "now": now,
    }
    args = (message["envelope"], plan, host, docker,
            Path(config["inputs"]), Path(config["workspace"]))
    if op == "approve":
        return approve_signed(*args, **kwargs)
    if op == "execute":
        if runner is not None:
            kwargs["runner"] = runner
        return run_signed(*args, **kwargs)
    revoke_signed(*args, **kwargs)
    return {"status": "revoked"}


class _Handler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        try:
            if not hasattr(socket, "SO_PEERCRED"):
                _deny("OS peer identity unavailable")
            raw = self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                          struct.calcsize("3i"))
            pid, uid, gid = struct.unpack("3i", raw)
            del pid, gid
            # No partial JSON streaming and no unbounded buffering.
            data = self.rfile.readline(MAX_REQUEST_BYTES + 2)
            if len(data) > MAX_REQUEST_BYTES or not data.endswith(b"\n"):
                _deny("missing newline or oversized RPC request")
            request = _safe_json(data)
            answer = dispatch(request, self.server.config_file, peer_uid=uid)
            response = {"ok": True, "result": answer}
        except (ExecutionDenied, OSError, ValueError, TypeError):
            # Never echo secrets, paths or untrusted data back to the caller.
            response = {"ok": False, "error": "DENIED"}
        try:
            self.wfile.write((json.dumps(response, sort_keys=True,
                                          separators=(",", ":")) + "\n").encode())
        except OSError:
            pass


class ApprovalServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    block_on_close = True
    request_queue_size = 8

    def __init__(self, config_file: Path):
        self.config_file = Path(config_file)
        config = load_config(self.config_file)
        sock = Path(config["workspace"]) / SOCK_NAME
        if sock.exists() or sock.is_symlink():
            _deny("socket already exists: refuse overwrite of any object")
        super().__init__(str(sock), _Handler)
        self.socket_path = sock
        os.chmod(sock, 0o600)

    def server_close(self):
        try:
            super().server_close()
        finally:
            if self.socket_path.is_socket():
                self.socket_path.unlink()


def serve(config_file: Path) -> None:
    with ApprovalServer(config_file) as server:
        server.serve_forever(poll_interval=0.1)


def client(socket_file: Path, payload: dict, *, timeout: float = 20.0) -> dict:
    """Untrusted client may REQUEST actions but cannot mint approval without signing."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(str(socket_file))
        message = json.dumps(payload, sort_keys=True, separators=(",", ":"),
                             allow_nan=False).encode()
        if len(message) > MAX_REQUEST_BYTES - 1:
            _deny("client request too large")
        sock.sendall(message + b"\n")
        chunks = bytearray()
        while len(chunks) < MAX_REQUEST_BYTES:
            ch = sock.recv(min(4096, MAX_REQUEST_BYTES - len(chunks)))
            if not ch:
                break
            chunks.extend(ch)
            if b"\n" in ch:
                break
        result = _safe_json(bytes(chunks).strip())
        _object(result, {"ok", "result"} if result.get("ok") is True
                else {"ok", "error"}, "RPC response")
        if result["ok"] is not True:
            _deny("host approval service denied request")
        return result["result"]
    finally:
        sock.close()
