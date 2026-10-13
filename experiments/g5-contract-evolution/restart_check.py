#!/usr/bin/env python3
"""Real G5 restart integration: separate JVMs, one same PostgreSQL store.

Runs only in an ephemeral Docker BUILD with an unexposed local PostgreSQL.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PORT = 10119
URL = f"http://127.0.0.1:{PORT}"
JAR = "/work/app/target/g5-pg-books-0.1.0.jar"
BASIC = base64.b64encode(
    (os.environ["PROTOCOLIA_USER"] + ":" + os.environ["PROTOCOLIA_PASSWORD"]).encode()
).decode()
HEADERS = {"Authorization": "Basic " + BASIC, "Content-Type": "application/json"}
TEST_ISBN = "g5-v04-restart-survivor"
WHEN = "2026-10-12T10:30:00Z"


def call(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    request = Request(
        URL + path,
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers=HEADERS,
    )
    try:
        with urlopen(request, timeout=10) as response:
            raw, status = response.read(), response.status
    except HTTPError as error:
        raw, status = error.read(), error.code
    result: object = json.loads(raw) if raw else {}
    return status, result


def start_java() -> subprocess.Popen:
    logs = open("/tmp/g5-restart-java.log", "ab", buffering=0)
    server = subprocess.Popen(
        ["java", f"-Dserver.port={PORT}", "-jar", JAR],
        stdout=logs, stderr=subprocess.STDOUT,
        env=os.environ.copy(), start_new_session=True,
    )
    logs.close()
    for attempt in range(90):
        if server.poll() is not None:
            raise RuntimeError("Java exited early; check /tmp/g5-restart-java.log")
        try:
            with urlopen(URL + "/health", timeout=2) as health:
                if health.status == 200:
                    return server
        except (URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(1)
    raise RuntimeError("Java failed to become healthy within 90s")


def stop_java(server: subprocess.Popen) -> None:
    server.terminate()
    try:
        server.wait(timeout=15)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(timeout=10)


def verify() -> None:
    a = start_java()
    try:
        status, created = call("POST", "/api/books", {
            "isbn": TEST_ISBN, "title": "Survives JVM restart", "stock": 2, "publishedAt": WHEN})
        assert status == 201 and created.get("publishedAt", "").startswith("2026-10-12"), (status, created)
        status, changed = call("PATCH", f"/api/books/{TEST_ISBN}/stock", {"quantity": 7})
        assert status == 200 and changed["stock"] == 9 and changed["publishedAt"].startswith("2026-10-12"), (status, changed)
        invalid_status, _ = call("PATCH", f"/api/books/{TEST_ISBN}/stock", {"quantity": 0})
        assert invalid_status == 400, ("invalid restock accepted", invalid_status)
        after_invalid, unchanged = call("GET", f"/api/books/{TEST_ISBN}")
        assert after_invalid == 200 and unchanged["stock"] == 9, (after_invalid, unchanged)
        print("G5_V04_PRE_RESTART_WITH_PUBLISHED_AT_PASS", flush=True)
    finally:
        stop_java(a)

    b = start_java()
    try:
        status, found = call("GET", f"/api/books/{TEST_ISBN}")
        assert status == 200 and found["title"] == "Survives JVM restart" and found["stock"] == 9 and found["publishedAt"].startswith("2026-10-12"), (status, found)
        status, conflict = call("POST", "/api/books", {
            "isbn": TEST_ISBN, "title": "Must not replace", "stock": 10})
        assert status == 409, (status, conflict)
        status, found = call("GET", f"/api/books/{TEST_ISBN}")
        assert status == 200 and found["stock"] == 9, (status, found)
        status, page = call("GET", "/api/books?limit=50&offset=0")
        assert status == 200 and page["total"] >= 1, (status, page)
        print("G5_V04_PUBLISHED_AT_SURVIVES_TWO_JVM_PROCESSES_PASS", flush=True)
    finally:
        stop_java(b)


if __name__ == "__main__":
    try:
        verify()
    except Exception as e:
        print("G5_RESTART_FAILURE", repr(e), file=sys.stderr)
        try:
            print(Path("/tmp/g5-restart-java.log").read_text()[-9000:], file=sys.stderr)
        except OSError:
            pass
        sys.exit(1)
