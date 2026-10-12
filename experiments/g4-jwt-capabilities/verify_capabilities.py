#!/usr/bin/env python3
"""Build-time fail-closed audit of G4 operation and role/capability ownership.

This guard is *not* a runtime identity provider or an OAuth claim validator.
It prevents silently changing a contract while leaving an unreviewed hand-
maintained HTTP policy or method-level authorization annotation behind.
"""
import json
import re
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
security = Path(sys.argv[2]).read_text()
delegate = Path(sys.argv[3]).read_text()
expected = {
    "health": ("GET", "/health", "public"),
    "listBooks": ("GET", "/api/books", "catalog.read"),
    "getBook": ("GET", "/api/books/{isbn}", "catalog.read"),
    "createBook": ("POST", "/api/books", "catalog.write"),
    "adjustStock": ("PATCH", "/api/books/{isbn}/stock", "catalog.write"),
}
actual = {n: (x["method"], x["path"], x["capability"])
          for n, x in manifest["operations"].items()}
if actual != expected:
    raise SystemExit("G4_FAIL_CLOSED: missing/unknown method, path or capability: " + str(actual))
security_checks = [
    '.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()',
    '.requestMatchers(HttpMethod.GET, "/health").permitAll()',
    '.requestMatchers(HttpMethod.GET, "/api/books", "/api/books/*").hasAuthority("catalog.read")',
    '.requestMatchers(HttpMethod.POST, "/api/books").hasAuthority("catalog.write")',
    '.requestMatchers(HttpMethod.PATCH, "/api/books/*/stock").hasAuthority("catalog.write")',
    '.anyRequest().denyAll()',
    '.httpBasic(basic -> basic.disable())',
    '.oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(converter)))',
]
for text in security_checks:
    if text not in security:
        raise SystemExit("G4_FAIL_CLOSED: HTTP boundary missing " + text)
for op, (_, _, cap) in expected.items():
    if cap == "public":
        continue
    pat = r'@PreAuthorize\("hasAuthority\(\x27' + re.escape(cap) + r'\x27\)"\)\s*public\s+\w+\s+' + op + r'\('
    if not re.search(pat, delegate):
        raise SystemExit("G4_FAIL_CLOSED: no method-level defense-in-depth for " + op)
if "catalog.read" in ("books:read", "books:write"):
    raise SystemExit("scope and capability must remain distinct")
print("G4_TRUSTED_OPERATION_SCOPE_AND_METHOD_POLICY_PASS", len(actual))
