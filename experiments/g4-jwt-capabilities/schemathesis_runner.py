#!/usr/bin/env python3
"""Bounded Schemathesis 4.30.1 run against real G4 JWT Spring localhost.

Ephemeral RSA/JWKS and access tokens are created in memory, never committed.
No public server receives write/fuzz traffic. The OpenAPI spec is compiled from
the same v0.3 contract as the tested Java application.
"""
from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from urllib.request import urlopen

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

ISSUER = "https://issuer.g4.protocolia.invalid"
AUDIENCE = "protocolia-books"
SERVER_PORT = 10111


def encoded_integer(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8 or 1, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def main(schema_path: Path, java_jar: Path) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = private_key.public_key().public_numbers()
    jwks = json.dumps({"keys": [{
        "kty": "RSA", "kid": "g4-python-ephemeral",
        "use": "sig", "alg": "RS256",
        "n": encoded_integer(public.n),
        "e": encoded_integer(public.e),
    }]}).encode()

    class JwksHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/jwks":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(jwks)))
            self.end_headers()
            self.wfile.write(jwks)

        def log_message(self, *args):
            pass

    jwks_server = ThreadingHTTPServer(("127.0.0.1", 0), JwksHandler)
    listener = threading.Thread(target=jwks_server.serve_forever, daemon=True)
    listener.start()

    now = datetime.now(timezone.utc)
    access_token = jwt.encode({
        "iss": ISSUER, "aud": AUDIENCE, "sub": "schemathesis-test-client",
        "iat": now - timedelta(seconds=5),
        "nbf": now - timedelta(seconds=5),
        "exp": now + timedelta(minutes=6),
        "scope": "books:read",
    }, private_key, algorithm="RS256", headers={"kid": "g4-python-ephemeral"})

    env = dict(os.environ, **{
        "G4_ISSUER": ISSUER,
        "G4_AUDIENCE": AUDIENCE,
        "G4_JWKS_URI": f"http://127.0.0.1:{jwks_server.server_address[1]}/jwks",
        "G4_READ_SCOPE": "books:read",
        "G4_WRITE_SCOPE": "books:write",
        "G4_TEST_ONLY_ALLOW_LOOPBACK_HTTP": "true",
    })

    server = subprocess.Popen(
        ["java", f"-Dserver.port={SERVER_PORT}", "-jar", str(java_jar)],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.monotonic() + 100
        while time.monotonic() < deadline:
            if server.poll() is not None:
                raise RuntimeError("JWT Spring backend exited before readiness")
            try:
                with urlopen(f"http://127.0.0.1:{SERVER_PORT}/health", timeout=1) as reply:
                    if reply.status == 200:
                        break
            except Exception:
                time.sleep(1)
        else:
            raise RuntimeError("JWT Spring backend did not become ready within 100 s")

        command = [
            "schemathesis", "run", str(schema_path),
            f"--url=http://127.0.0.1:{SERVER_PORT}",
            "--include-method=GET",
            "--mode=all",
            "--max-examples=8",
            "--workers=1",
            "--phases=fuzzing",
            "--generation-deterministic",
            "--max-time=60",
            "--checks=not_a_server_error,status_code_conformance",
            "--header", "Authorization: Bearer " + access_token,
        ]
        print("G4_SCHEMATHESIS_REAL_JWT_GET_BEGIN", flush=True)
        run = subprocess.run(command, text=True, capture_output=True, timeout=120)
        print(run.stdout[-25000:], flush=True)
        if run.returncode != 0:
            print(run.stderr[-12000:], file=sys.stderr)
            raise RuntimeError(f"Schemathesis exit {run.returncode}")
        # A successful zero-operation run is not valid test coverage.
        if "0 generated" in run.stdout or "Empty test suite" in run.stdout:
            raise RuntimeError("Schemathesis generated zero cases")
        Path("/tmp/g4-schemathesis-passed.txt").write_text(
            "G4_SCHEMATHESIS_4_30_1_REAL_JWT_GET_PASS\n")
        print("G4_SCHEMATHESIS_4_30_1_REAL_JWT_GET_PASS", flush=True)
    finally:
        server.terminate()
        try:
            server.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.communicate()
        jwks_server.shutdown()
        jwks_server.server_close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: schemathesis_runner.py <openapi> <jar>")
    main(Path(sys.argv[1]), Path(sys.argv[2]))
