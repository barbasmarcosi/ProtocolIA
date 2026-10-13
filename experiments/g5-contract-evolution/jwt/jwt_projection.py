#!/usr/bin/env python3
"""Strict, provenance-preserving JWT *HTTP profile* of ProtocolIA's G0 output.

The original G0/G1 Basic OpenAPI and its ownership manifest remain unchanged.
This is a fully explicit adapter bound to the G4 server's trusted Bearer
security configuration, not an assertion that Basic and Bearer are equivalent.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys


def fail(msg: str) -> None:
    raise SystemExit("G4_HTTP_PROFILE_INVALID: " + msg)


def encode(obj: object) -> str:
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def project(src: Path, capability_manifest: Path, dst: Path) -> None:
    base = json.loads(src.read_text())
    manifest = json.loads(capability_manifest.read_text())
    projection = deepcopy(base)
    schemes = projection["components"]["securitySchemes"]
    if schemes != {"basicAuth": {"type": "http", "scheme": "basic"}}:
        fail("unexpected original HTTP Basic security scheme")
    if set(manifest["operations"]) != {
        "health", "listBooks", "getBook", "createBook", "adjustStock", "renameBook"
    }:
        fail("missing/unknown capability operations")
    mapped = set()
    for path, methods in projection["paths"].items():
        for method, op in methods.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            operation_id = op.get("operationId")
            declared = manifest["operations"].get(operation_id)
            if declared is None:
                fail("unexpected HTTP operation " + str(operation_id))
            if declared["method"].lower() != method or declared["path"] != path:
                fail("path/method mismatch " + str(operation_id))
            if operation_id == "health":
                if declared["capability"] != "public" or op.get("security") != []:
                    fail("health cannot gain privileged capabilities")
                op["security"] = []
            else:
                if declared["capability"] not in {"catalog.read", "catalog.write"}:
                    fail("unsupported protected capability")
                if op.get("security") != [{"basicAuth": []}]:
                    fail("protected endpoint lacks truthful original HTTP Basic semantics")
                op["security"] = [{"bearerAuth": []}]
            mapped.add(operation_id)
    if mapped != set(manifest["operations"]):
        fail("unmapped operations")
    projection["components"]["securitySchemes"] = {
        "bearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
    }
    projection["x-protocolia-auth-profile"] = "g4-jwt-resource-server-rs256"
    dst.write_text(encode(projection))
    provenance = {
        "adapter": "protocolia/g4-jwt-auth-profile/1",
        "canonicalBasicOpenapiSha256": hashlib.sha256(src.read_bytes()).hexdigest(),
        "derivedJwtOpenapiSha256": hashlib.sha256(dst.read_bytes()).hexdigest(),
        "capabilityManifestSha256": hashlib.sha256(capability_manifest.read_bytes()).hexdigest(),
        "authProfile": "jwt-rs256-bearer",
        "operationCount": len(mapped),
    }
    dst.with_suffix(".provenance.json").write_text(encode(provenance))
    print("G4_TRUTHFUL_JWT_OPENAPI_PROFILE_PASS", len(mapped))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        fail("usage jwt_projection.py original.json capability-manifest.json output.json")
    project(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
