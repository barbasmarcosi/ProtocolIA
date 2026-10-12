#!/usr/bin/env python3
"""G1 fail-closed deployment mapping for the Books *demo only*.

This independently checks that the HTTP security mapping maintained in
DemoSecurity reflects EVERY operation declared by ProtocolIA. It is not an
OIDC scope-to-capability mapper or substitute for HTTP authorization tests.
"""
import json
import sys
from pathlib import Path

expected = {
    "createBook": ("POST", "/api/books", "catalog.write"),
    "getBook": ("GET", "/api/books/{isbn}", "catalog.read"),
    "listBooks": ("GET", "/api/books", "catalog.read"),
    "adjustStock": ("PATCH", "/api/books/{isbn}/stock", "catalog.write"),
    "health": ("GET", "/health", "public"),
}
manifest = json.loads(Path(sys.argv[1]).read_text())
actual = {op: (x["method"], x["path"], x["capability"])
          for op, x in manifest["operations"].items()}
if actual != expected:
    print("G1_FAIL_CLOSED: manifest/HTTP demo authorization mismatch", actual, file=sys.stderr)
    raise SystemExit(2)
source = Path(sys.argv[2]).read_text()
for expected_snippet in [
    '.requestMatchers(HttpMethod.GET, "/health").permitAll()',
    '.requestMatchers(HttpMethod.GET, "/api/books", "/api/books/*").hasAuthority("catalog.read")',
    '.requestMatchers(HttpMethod.POST, "/api/books").hasAuthority("catalog.write")',
    '.requestMatchers(HttpMethod.PATCH, "/api/books/*/stock").hasAuthority("catalog.write")',
    '.anyRequest().denyAll()',
]:
    if expected_snippet not in source:
        print("G1_FAIL_CLOSED: missing reviewed server policy mapping: " + expected_snippet,
              file=sys.stderr)
        raise SystemExit(3)
print("G1_CAPABILITY_MAPPING_VERIFIED 5 operations, no undeclared capability")
