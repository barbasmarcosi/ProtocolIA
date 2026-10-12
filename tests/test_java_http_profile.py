"""Executable product regression for target-specific HTTP/OpenAPI parity.

No paid models, network or Java compiler are required for these Python tests.
The real Java HTTP status checks run independently in the existing Maven tests.
"""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from protocolia import ContractError, compile_contract, write_artifacts
from protocolia.http_projection import COMPILER, PROFILE, compile_java_http
from protocolia.java_spring import generate_java

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "examples/stock-change/protocolia/contract.json").read_text())
DOMAIN = json.loads((ROOT / "examples/stock-change/protocolia/http-errors.json").read_text())


class JavaHttpProfileTest(unittest.TestCase):
    def test_basic_security_exact_operations_and_success_status(self):
        a = compile_java_http(CATALOG, DOMAIN)
        api = json.loads(a["openapi.json"])
        self.assertEqual(api["x-protocolia-target-profile"], PROFILE)
        self.assertEqual(api["components"]["securitySchemes"], {
            "basicAuth": {"type": "http", "scheme": "basic"}
        })
        cases = [
            ("post", "/api/books", "createBook", "201", {"400", "401", "403", "409", "501"}),
            ("get", "/api/books/{isbn}", "getBook", "200", {"400", "401", "403", "404", "501"}),
            ("patch", "/api/books/{isbn}/stock", "adjustStock", "200",
             {"400", "401", "403", "404", "409", "501"}),
            ("get", "/health", "health", "200", {"501"}),
        ]
        for method, path, operation, success, errors in cases:
            with self.subTest(operation=operation):
                e = api["paths"][path][method]
                self.assertEqual(e["operationId"], operation)
                self.assertEqual(set(e["responses"]), {success} | errors)
                self.assertEqual(e["security"], [] if operation == "health" else [{"basicAuth": []}])
                self.assertEqual(e["x-protocolia-capability"], CATALOG["operations"][operation]["capability"])
                self.assertEqual(e["x-protocolia-effects"], CATALOG["operations"][operation]["effects"])
                for status in errors:
                    self.assertNotIn("content", e["responses"][status])

    def test_legacy_generic_compiler_unchanged_and_profiles_isolated(self):
        vanilla = compile_contract(CATALOG)
        profiled = compile_java_http(CATALOG, DOMAIN)
        generic = json.loads(vanilla["openapi.json"])
        self.assertIn("bearerAuth", generic["components"]["securitySchemes"])
        self.assertEqual(set(generic["paths"]["/api/books"]["post"]["responses"]), {"200"})
        self.assertNotEqual(vanilla["openapi.json"], profiled["openapi.json"])
        self.assertEqual(vanilla["ir.json"], profiled["ir.json"])
        self.assertEqual(vanilla["payload.schema.json"], profiled["payload.schema.json"])
        self.assertEqual(json.loads(profiled["manifest.json"])["compiler"], COMPILER)
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            write_artifacts(profiled, out / "profile")
            write_artifacts(profiled, out / "profile")
            with self.assertRaises(ContractError):
                write_artifacts(vanilla, out / "profile")
            write_artifacts(vanilla, out / "generic")

    def test_security_and_post_convention_match_real_java_generator(self):
        java = generate_java(CATALOG)
        profile = json.loads(compile_java_http(CATALOG, DOMAIN)["openapi.json"])
        sec = java["src/main/java/dev/protocolia/generated/SecurityConfig.java"]
        mvc = java["src/main/java/dev/protocolia/generated/ContractController.java"]
        self.assertIn("http.httpBasic(", sec)
        self.assertNotIn("oauth2ResourceServer", sec)
        self.assertIn("HttpStatus.CREATED", mvc)
        self.assertIn("HttpStatus.NOT_IMPLEMENTED", mvc)
        self.assertEqual(profile["paths"]["/api/books"]["post"]["responses"]["201"],
                         {"description": "Successful response", "content": {
                             "application/json": {"schema": {"$ref": "#/components/schemas/Book"}}}})
        self.assertEqual(profile["paths"]["/health"]["get"]["security"], [])

    def test_deterministic_independent_of_source_order(self):
        reversed_source = copy.deepcopy(CATALOG)
        reversed_source["models"] = dict(reversed(list(reversed_source["models"].items())))
        reversed_source["operations"] = dict(reversed(list(reversed_source["operations"].items())))
        self.assertEqual(compile_java_http(CATALOG, DOMAIN), compile_java_http(reversed_source, DOMAIN))

    def test_explicit_domain_error_validation_fails_closed(self):
        bad = [
            {"unknownOperation": [404]}, {"createBook": [201]}, {"getBook": [401]},
            {"adjustStock": ["409"]}, {"adjustStock": [True]}, {"getBook": [404, 404]},
            {"getBook": {"404": True}}, ["404"], 5,
        ]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ContractError):
                compile_java_http(CATALOG, value)

    def test_rejects_java_unsupported_contract_before_writes(self):
        c = copy.deepcopy(CATALOG)
        c["models"]["Book"]["title"]["required"] = False
        with self.assertRaises(ContractError):
            compile_java_http(c)
        c = copy.deepcopy(CATALOG)
        c["models"]["Book"]["title"]["constraints"]["enum"] = ["OnlyOne"]
        with self.assertRaises(ContractError):
            compile_java_http(c)

    def test_cli_compiles_and_regenerates_idempotently(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "java-http"
            args = [sys.executable, "-m", "protocolia", "compile-http",
                    str(ROOT / "examples/stock-change/protocolia/contract.json"),
                    "--profile", "java-spring-basic-demo", "--domain-errors",
                    str(ROOT / "examples/stock-change/protocolia/http-errors.json"),
                    "--out", str(out)]
            env = dict(os.environ, PYTHONPATH=str(ROOT / "src"))
            for _ in range(2):
                result = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Java Basic demo HTTP profile", result.stdout)
            self.assertEqual(json.loads((out / "openapi.json").read_text())["x-protocolia-target-profile"], PROFILE)
            # Do not allow target flags to leak into historical output commands.
            invalid = subprocess.run([sys.executable, "-m", "protocolia", "compile",
                                      str(ROOT / "examples/stock-change/protocolia/contract.json"),
                                      "--profile", "java-spring-basic-demo"],
                                     cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(invalid.returncode, 0)

if __name__ == "__main__":
    unittest.main()
