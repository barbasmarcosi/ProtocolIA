"""Offline Ed25519 operator signer. Run under operator's OS identity, NOT in agent.

Private keys are never printed, uploaded, embedded in plans, nor passed to the
host approval service. A human must verify both plan hash AND logical resource.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import stat
import sys

from .action_runtime import ExecutionDenied, _deny, _json
from .operator_auth import CONTEXT, _protected_bytes, _exact, _no_duplicates, NONCE


def generate_private_key(destination: Path) -> str:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PrivateFormat, PublicFormat, NoEncryption,
    )
    path = Path(destination)
    if not path.is_absolute() or path.is_symlink():
        _deny("private key destination must be an absolute non-symlink path")
    parent = path.parent
    if (not parent.is_dir() or parent.is_symlink()
            or parent.stat().st_uid != os.geteuid()
            or parent.stat().st_mode & 0o022):
        _deny("private key parent must be trusted and not group/world writable")
    key = Ed25519PrivateKey.generate()
    secret = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    fd = None
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                     | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "wb") as file:
            fd = None
            file.write(secret)
            file.flush()
            os.fsync(file.fileno())
    except FileExistsError:
        _deny("private key already exists; refusing overwrite")
    finally:
        if fd is not None: os.close(fd)
    public = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(public).decode()


def sign_for_operator(intent: dict, key_file: Path, *,
                      confirmed_plan: str, confirmed_resource: str) -> dict:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    fields = {"version","subject","key_id","environment","request_id",
              "request_hash","tool","resource","container_image",
              "plan_sha256","host_policy_sha256","docker_policy_sha256",
              "input_sha256","tool_fingerprint","registry_sha256",
              "issued_at","expires_at","nonce"}
    _exact(intent, fields, "offline intent")
    if (intent["version"]!="0.6" or intent["tool"]!="file.sha256"
            or type(confirmed_plan) is not str or type(confirmed_resource) is not str
            or intent["plan_sha256"]!=confirmed_plan
            or intent["resource"]!=confirmed_resource):
        _deny("operator must confirm exact plan SHA and logical resource before signing")
    if type(intent["nonce"]) is not str or not NONCE.fullmatch(intent["nonce"]):
        _deny("invalid operator challenge nonce")
    if type(intent["issued_at"]) is not int or type(intent["expires_at"]) is not int:
        _deny("approval clock fields must be integer")
    if not intent["issued_at"] < intent["expires_at"] <= intent["issued_at"]+300:
        _deny("operator intent lifetime invalid")
    key=Ed25519PrivateKey.from_private_bytes(_protected_bytes(key_file, max_bytes=32))
    signature=key.sign(CONTEXT+_json(intent).encode("utf-8"))
    return {"intent":intent,"signature_b64":base64.b64encode(signature).decode()}


def main()->int:
    parser=argparse.ArgumentParser(prog="protocolia-operator-sign")
    command=parser.add_subparsers(dest="command",required=True)
    create=command.add_parser("create-key")
    create.add_argument("--private-key",required=True,type=Path)
    sign=command.add_parser("sign")
    sign.add_argument("--private-key",required=True,type=Path)
    sign.add_argument("--intent",required=True,type=Path)
    sign.add_argument("--confirm-plan-sha256",required=True)
    sign.add_argument("--confirm-resource",required=True)
    args=parser.parse_args()
    try:
        if args.command=="create-key":
            result={"ed25519_public_b64":generate_private_key(args.private_key)}
        else:
            intent=json.loads(args.intent.read_text(encoding="utf-8"),
                              object_pairs_hook=_no_duplicates)
            result=sign_for_operator(intent,args.private_key,
                confirmed_plan=args.confirm_plan_sha256,
                confirmed_resource=args.confirm_resource)
        print(json.dumps(result,sort_keys=True,indent=2))
    except (ExecutionDenied,OSError,ValueError) as exc:
        print("operator-sign: "+str(exc),file=sys.stderr)
        return 1
    return 0

if __name__=="__main__":
    raise SystemExit(main())
