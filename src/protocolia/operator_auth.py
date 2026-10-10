"""P3-B2.2: Ed25519-authenticated host approval gateway for one read-only Docker action.

Trust boundaries:
- The operator *private signing key* never enters this module.
- The host supplies protected, absolute registry and HMAC-service-key files.
- An unsigned/declarative subject is NEVER sufficient for gateway approval.
- The caller/model cannot change the trusted registry, local host policy or key path.
- This is a library authentication boundary, not a deployed OIDC/human-login service.
No paid, network, shell or writable external tools are enabled.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
from typing import Any, Callable

from .action_runtime import ExecutionDenied, _deny, _digest, _identifier, _json
from .action_broker import approve_plan, preview_plan, run_plan
from .sandbox_adapter import revoke

VERSION = "0.6"
CONTEXT = b"protocolia-operator-readonly-approval/v0.6\x00"
NONCE = re.compile(r"^[a-f0-9]{32,64}$")
MAX_ENVELOPE_AGE = 300
B64 = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


def _exact(data: Any, names: set[str], label: str) -> dict:
    if type(data) is not dict or set(data) != names:
        _deny(label + ": unexpected or missing fields")
    return data


def _binary(value: str, length: int, label: str) -> bytes:
    if type(value) is not str or not B64.fullmatch(value) or len(value) > 256:
        _deny("invalid " + label + " encoding")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, base64.binascii.Error):
        _deny("invalid " + label + " base64")
    if len(decoded) != length or base64.b64encode(decoded).decode() != value:
        _deny("noncanonical or wrong-length " + label)
    return decoded


def _protected_bytes(file: Path, *, max_bytes: int = 65536) -> bytes:
    """Enforce host-owned, non-link, private regular file; no key/env in model args."""
    path = Path(file)
    if not path.is_absolute():
        _deny("trusted credential/config file must use absolute path")
    if any(part.is_symlink() for part in (path, *path.parents)):
        _deny("symlinked trusted credential path")
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                     | getattr(os, "O_CLOEXEC", 0))
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or (info.st_mode & 0o077) != 0 or info.st_nlink != 1
                or not 0 < info.st_size <= max_bytes):
            _deny("credential/config must be private, owned, bounded and regular")
        data = bytearray()
        while len(data) <= max_bytes:
            chunk = os.read(fd, min(16384, max_bytes + 1 - len(data)))
            if not chunk: break
            data.extend(chunk)
        if not 0 < len(data) <= max_bytes:
            _deny("unbounded or empty host credential/config")
        return bytes(data)
    except OSError as exc:
        _deny("host credential unavailable: " + type(exc).__name__)
    finally:
        if fd is not None: os.close(fd)


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict:
    data = {}
    for key, value in pairs:
        if key in data:
            _deny("duplicate host registry key")
        data[key] = value
    return data


def _operator_registry(filename: Path) -> dict:
    try:
        registry = json.loads(_protected_bytes(filename), object_pairs_hook=_no_duplicates)
    except (UnicodeDecodeError, ValueError, RecursionError):
        _deny("malformed trusted operator registry")
    _exact(registry, {"version", "operators"}, "registry")
    if registry["version"] != VERSION or type(registry["operators"]) is not dict:
        _deny("unsupported or malformed operator registry")
    seen = set()
    if len(registry["operators"]) > 100:
        _deny("too many operators")
    for subject, entry in registry["operators"].items():
        _identifier(subject, "operator")
        _exact(entry, {"enabled", "resources", "keys"}, "operator entry")
        if type(entry["enabled"]) is not bool:
            _deny("operator enabled must be boolean")
        resources = entry["resources"]
        if type(resources) is not list or len(resources) > 64 or any(type(x) is not str for x in resources):
            _deny("invalid operator resource grants")
        if len(resources) != len(set(resources)):
            _deny("duplicate operator resource grant")
        from .action_runtime import _key
        for resource in resources: _key(resource)
        keys = entry["keys"]
        if type(keys) is not dict or not 1 <= len(keys) <= 8:
            _deny("invalid operator public keys")
        for kid, record in keys.items():
            _identifier(kid, "public key ID")
            _exact(record, {"ed25519_public_b64", "revoked"}, "registered key")
            if type(record["revoked"]) is not bool:
                _deny("key revocation flag must be boolean")
            pub = _binary(record["ed25519_public_b64"], 32, "Ed25519 key")
            if pub in seen:
                _deny("ambiguous public key reused in registry")
            seen.add(pub)
    return registry


def _service_key(filename: Path) -> bytes:
    key = _protected_bytes(filename, max_bytes=512)
    if len(key) != 32:
        _deny("host HMAC key must be exactly 32 binary bytes")
    return key


def _identity(registry: dict, subject: str, key_id: str, resource: str) -> bytes:
    _identifier(subject, "signed subject")
    _identifier(key_id, "signed key ID")
    entry = registry["operators"].get(subject)
    if type(entry) is not dict or not entry["enabled"]:
        _deny("unknown or disabled operator")
    record = entry["keys"].get(key_id)
    if type(record) is not dict or record["revoked"]:
        _deny("unknown or revoked operator public key")
    if resource not in entry["resources"]:
        _deny("operator is not authorized for this resource")
    return _binary(record["ed25519_public_b64"], 32, "operator Ed25519 key")


def create_intent(plan: Any, host_policy: Any, docker_policy: Any,
                  inputs: Path, registry_file: Path, *,
                  subject: str, key_id: str, environment: str,
                  issued_at: int, expires_at: int, nonce: str) -> dict:
    """Create a canonical operation-specific statement for OFFLINE operator signing."""
    if type(issued_at) is not int or type(expires_at) is not int:
        _deny("approval timestamps must be integer epoch seconds")
    if not issued_at < expires_at <= issued_at + MAX_ENVELOPE_AGE:
        _deny("approval lifetime exceeds 5-minute limit")
    if type(nonce) is not str or not NONCE.fullmatch(nonce):
        _deny("invalid fresh approval nonce")
    _identifier(environment, "host environment")
    preview = preview_plan(plan, host_policy, docker_policy, inputs)
    resource = preview["external_request"]["resource"]
    registry = _operator_registry(registry_file)
    _identity(registry, subject, key_id, resource)
    snapshot = preview["external_snapshot"]
    return {
        "version": VERSION, "subject": subject, "key_id": key_id,
        "environment": environment,
        "request_id": preview["external_request"]["request_id"],
        "request_hash": snapshot["request_hash"],
        "plan_sha256": preview["plan_sha256"],
        "host_policy_sha256": preview["host_policy_sha256"],
        "docker_policy_sha256": snapshot["policy_hash"],
        "input_sha256": snapshot["input_sha256"],
        "tool_fingerprint": snapshot["tool_fingerprint"],
        "registry_sha256": _digest(registry),
        "issued_at": issued_at, "expires_at": expires_at, "nonce": nonce,
    }


def _verified_signed_intent(envelope: Any, plan: Any, host_policy: Any,
                            docker_policy: Any, inputs: Path,
                            registry_file: Path, now: int) -> tuple[dict, dict]:
    _exact(envelope, {"intent", "signature_b64"}, "operator-signed envelope")
    intent = envelope["intent"]
    if type(intent) is not dict or set(intent) != {
        "version", "subject", "key_id", "environment", "request_id",
        "request_hash", "plan_sha256", "host_policy_sha256", "docker_policy_sha256",
        "input_sha256", "tool_fingerprint", "registry_sha256", "issued_at",
        "expires_at", "nonce"
    }:
        _deny("invalid operator intent fields")
    if type(now) is not int or not intent["issued_at"] <= now <= intent["expires_at"]:
        _deny("operator signature not yet valid or expired")
    exact = create_intent(
        plan, host_policy, docker_policy, inputs, registry_file,
        subject=intent["subject"], key_id=intent["key_id"],
        environment=intent["environment"], issued_at=intent["issued_at"],
        expires_at=intent["expires_at"], nonce=intent["nonce"])
    if exact != intent:
        _deny("operator signature bound to stale policy/input/plan/key registry")
    registry = _operator_registry(registry_file)
    resource = preview_plan(plan, host_policy, docker_policy, inputs)["external_request"]["resource"]
    pub = _identity(registry, intent["subject"], intent["key_id"], resource)
    signature = _binary(envelope["signature_b64"], 64, "operator signature")
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        _deny("operator-auth extra not installed: cryptography required")
    try:
        Ed25519PublicKey.from_public_bytes(pub).verify(signature,
            CONTEXT + _json(intent).encode("utf-8"))
    except (InvalidSignature, ValueError):
        _deny("invalid Ed25519 operator signature")
    return intent, exact


def _approval_receipt(workspace: Path, intent: dict, envelope: dict, *,
                      create: bool) -> None:
    """Reserve a signed nonce durably before permission issuance; reuse is denied."""
    from .sandbox_adapter import _ledger
    path = _ledger(workspace, required=not create)
    with sqlite3.connect(path, timeout=5) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS operator_receipts (
            request_id TEXT PRIMARY KEY, subject TEXT NOT NULL, key_id TEXT NOT NULL,
            nonce TEXT NOT NULL, intent_sha TEXT NOT NULL, signature_sha TEXT NOT NULL,
            UNIQUE(subject,key_id,nonce))""")
        intent_sha = _digest(intent)
        sig_sha = hashlib.sha256(envelope["signature_b64"].encode()).hexdigest()
        if create:
            try:
                db.execute("INSERT INTO operator_receipts VALUES (?,?,?,?,?,?)",
                           (intent["request_id"], intent["subject"], intent["key_id"],
                            intent["nonce"], intent_sha, sig_sha))
            except sqlite3.IntegrityError:
                _deny("operator approval nonce or request already consumed")
        else:
            row = db.execute("SELECT subject,key_id,nonce,intent_sha,signature_sha "
                             "FROM operator_receipts WHERE request_id=?",
                             (intent["request_id"],)).fetchone()
            if row != (intent["subject"], intent["key_id"], intent["nonce"],
                       intent_sha, sig_sha):
                _deny("missing or stale signed-operator receipt")


def approve_signed(envelope: dict, plan: Any, host_policy: Any,
                   docker_policy: Any, inputs: Path, workspace: Path, *,
                   registry_file: Path, service_key_file: Path,
                   host_environment: str, now: Callable[[], float] = time.time) -> dict:
    """Trusted host-only action. Authenticates Ed25519 possession before issuing HMAC."""
    moment = int(now())
    intent, _ = _verified_signed_intent(
        envelope, plan, host_policy, docker_policy, inputs, registry_file, moment)
    if intent["environment"] != host_environment:
        _deny("signed operator host-environment mismatch")
    key = _service_key(service_key_file)
    _approval_receipt(workspace, intent, envelope, create=True)
    ttl = intent["expires_at"] - moment
    # Host issues a distinct HMAC grant bounded by the signed approval lifetime.
    # Nonce remains spent if Docker approval creation fails (fail closed).
    result = approve_plan(plan, host_policy, docker_policy, inputs, workspace,
                          subject=intent["subject"], environment=host_environment,
                          secret=key, ttl=max(1, ttl), now=lambda: now())
    return {"status": "approved-operator", "subject": intent["subject"],
            "key_id": intent["key_id"], "intent_sha256": _digest(intent),
            "grant": result}


def run_signed(envelope: dict, plan: Any, host_policy: Any,
               docker_policy: Any, inputs: Path, workspace: Path, *,
               registry_file: Path, service_key_file: Path,
               host_environment: str, now: Callable[[], float] = time.time,
               runner=None, cancelled=None) -> dict:
    """Check operator key/registry on EVERY invocation, including on exact replay."""
    moment = int(now())
    intent, _ = _verified_signed_intent(
        envelope, plan, host_policy, docker_policy, inputs, registry_file, moment)
    if intent["environment"] != host_environment:
        _deny("signed operator host-environment mismatch")
    _approval_receipt(workspace, intent, envelope, create=False)
    key = _service_key(service_key_file)
    options = {"subject": intent["subject"], "environment": host_environment,
               "secret": key, "now": now, "cancelled": cancelled}
    if runner is not None: options["runner"] = runner
    result = run_plan(plan, host_policy, docker_policy, inputs, workspace, **options)
    # Revocation or key rotation during the container run denies acceptance;
    # it cannot undo an already performed read-only action.
    _verified_signed_intent(envelope, plan, host_policy, docker_policy,
                            inputs, registry_file, int(now()))
    return {"operator": intent["subject"], "operator_key_id": intent["key_id"],
            "operator_approval_sha256": _digest(intent), **result}


def revoke_signed(envelope: dict, plan: Any, host_policy: Any,
                  docker_policy: Any, inputs: Path, workspace: Path, *,
                  registry_file: Path, service_key_file: Path,
                  host_environment: str,
                  now: Callable[[], float] = time.time) -> None:
    """Signed operator revoke of their approved request (host-side only)."""
    intent, _ = _verified_signed_intent(
        envelope, plan, host_policy, docker_policy, inputs, registry_file, int(now()))
    if intent["environment"] != host_environment:
        _deny("operator environment mismatch")
    _approval_receipt(workspace, intent, envelope, create=False)
    revoke(intent["request_id"], workspace, secret=_service_key(service_key_file))
