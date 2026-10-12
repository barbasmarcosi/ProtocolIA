"""ProtocolIA v0.3 opt-in bounded query and paginated Books regressions."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from protocolia import ContractError, compile_contract, validate, write_artifacts
from protocolia.compatibility import compare_contracts
from protocolia.http_projection import compile_java_http
from protocolia.java_spring import generate_java
from protocolia.resource_bundle import compile_resource_bundle, compare_resource_bundles
from protocolia.v02 import compile_contract as compile_v02
from protocolia.v03 import validate as validate_v03

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "examples/books-paging-v03"
SOURCE = json.loads((DIR / "contract.json").read_text())
RESOURCES = json.loads((DIR / "resources.json").read_text())
ERRORS = json.loads((DIR / "http-errors.json").read_text())
OLD = json.loads((ROOT / "examples/stock-change/protocolia/contract.json").read_text())


class QueryPaginationV03Test(unittest.TestCase):
    def test_query_source_normalizes_deterministically(self):
        ir = validate(SOURCE)
        self.assertEqual(ir["version"], "0.3")
        self.assertEqual(set(ir["operations"]["listBooks"]["query"]), {"limit", "offset"})
        self.assertEqual(ir["operations"]["listBooks"]["query"]["limit"]["default"], 25)
        copy_source = copy.deepcopy(SOURCE)
        copy_source["operations"] = dict(reversed(list(copy_source["operations"].items())))
        copy_source["operations"]["listBooks"]["query"] = dict(
            reversed(list(copy_source["operations"]["listBooks"]["query"].items())))
        self.assertEqual(compile_contract(SOURCE), compile_contract(copy_source))
        self.assertEqual(compile_resource_bundle(SOURCE, RESOURCES, ERRORS),
                         compile_resource_bundle(copy_source, RESOURCES, ERRORS))

    def test_openapi_query_and_page_schema_match(self):
        artifacts = compile_resource_bundle(SOURCE, RESOURCES, ERRORS)
        api = json.loads(artifacts["openapi.json"])
        self.assertEqual(api["info"]["version"], "0.3")
        self.assertEqual(api["components"]["securitySchemes"],
                         {"basicAuth": {"type": "http", "scheme": "basic"}})
        endpoint = api["paths"]["/api/books"]["get"]
        self.assertEqual(endpoint["operationId"], "listBooks")
        self.assertEqual(endpoint["security"], [{"basicAuth": []}])
        self.assertEqual(endpoint["x-protocolia-operation-role"], "list")
        self.assertEqual(endpoint["responses"]["200"]["content"]["application/json"]["schema"],
                         {"$ref": "#/components/schemas/BookPage"})
        self.assertEqual(set(endpoint["responses"]), {"200", "400", "401", "403", "501"})
        fields = {p["name"]: p for p in endpoint["parameters"]}
        self.assertEqual(set(fields), {"limit", "offset"})
        self.assertEqual(fields["limit"], {
            "in": "query", "name": "limit", "required": False,
            "schema": {"type": "integer", "minimum": 1, "maximum": 50, "default": 25}})
        self.assertEqual(fields["offset"]["schema"],
                         {"type": "integer", "minimum": 0, "maximum": 1000000, "default": 0})
        page = api["components"]["schemas"]["BookPage"]
        self.assertEqual(page["properties"]["items"],
                         {"type": "array", "items": {"$ref": "#/components/schemas/Book"}})
        self.assertIn("items", page["required"])
        ui = json.loads(artifacts["ui-manifest.json"])
        self.assertEqual(ui["version"], "0.2")
        self.assertEqual(ui["resources"]["books"]["operations"]["list"], "listBooks")
        self.assertEqual(ui["resources"]["books"]["views"]["list"]["model"], "Book")
        self.assertEqual(ui["resources"]["books"]["views"]["list"]["fields"], ["isbn","title","stock"])
        self.assertEqual(json.loads(artifacts["generation-manifest.json"])["compiler"],
                         "protocolia/0.3/java-spring-basic-demo-resource-bundle/2")

    def test_java_target_binds_query_and_handler_port(self):
        java = generate_java(SOURCE)
        controller = java["src/main/java/dev/protocolia/generated/ContractController.java"]
        port = java["src/main/java/dev/protocolia/generated/ContractHandlers.java"]
        self.assertNotIn("@org.springframework.validation.annotation.Validated", controller)
        self.assertIn("invalid query parameter", controller)
        self.assertIn('RequestParam(name="limit",required=false,defaultValue="25")', controller)
        self.assertIn('RequestParam(name="offset",required=false,defaultValue="0")', controller)
        self.assertIn("@jakarta.validation.constraints.Min(1)", controller)
        self.assertIn("@jakarta.validation.constraints.Max(50)", controller)
        self.assertIn("BookPage listBooks(Integer limit, Integer offset)", port)
        self.assertIn("return handler.listBooks(limit, offset)", controller)
        self.assertIn('hasAuthority(\'catalog.read\')', controller)
        self.assertIn("record BookPage(", java["src/main/java/dev/protocolia/generated/BookPage.java"])

    def test_incorrect_query_bounds_or_modes_fail_closed(self):
        cases = []
        for value in [0, 51, "25", None, True]:
            c = copy.deepcopy(SOURCE)
            c["operations"]["listBooks"]["query"]["limit"]["default"] = value
            cases.append(c)
        c = copy.deepcopy(SOURCE)
        c["operations"]["listBooks"]["query"]["offset"]["constraints"]["maximum"] = 1000001
        cases.append(c)
        c = copy.deepcopy(SOURCE)
        c["operations"]["listBooks"]["query"]["limit"]["type"] = "string"
        cases.append(c)
        c = copy.deepcopy(SOURCE)
        c["operations"]["listBooks"]["query"]["limit"]["constraints"]["maximum"] = 0
        cases.append(c)
        c = copy.deepcopy(SOURCE)
        c["operations"]["createBook"]["query"] = copy.deepcopy(c["operations"]["listBooks"]["query"])
        cases.append(c)
        c = copy.deepcopy(SOURCE)
        c["operations"]["listBooks"]["query"]["newParam"] = {"type": "integer", "required": True,
            "default": 1, "constraints": {"minimum": 0, "maximum": 2}}
        cases.append(c)
        c = copy.deepcopy(SOURCE)
        c["operations"]["listBooks"]["query"]["offset"]["constraints"]["minimum"] = -1
        cases.append(c)
        c = copy.deepcopy(SOURCE)
        c["operations"]["listBooks"]["query"]["limit"]["unexpected"] = 1
        cases.append(c)
        c = copy.deepcopy(SOURCE)
        c["operations"]["listBooks"]["query"]["offset"] = {}
        cases.append(c)
        for i, c in enumerate(cases):
            with self.subTest(case=i), self.assertRaises(ContractError):
                validate_v03(c)
        # Historical syntax must not silently start accepting v0.3 query keys.
        previous = copy.deepcopy(OLD)
        previous["operations"]["getBook"]["query"] = SOURCE["operations"]["listBooks"]["query"]
        with self.assertRaises(ContractError):
            validate(previous)

    def test_invalid_list_resource_binding_fails_closed(self):
        for kind in ("missing", "wrongResponse", "wrongRole", "wrongView"):
            c, r = copy.deepcopy(SOURCE), copy.deepcopy(RESOURCES)
            if kind == "missing":
                del r["resources"]["books"]["operations"]["list"]
            elif kind == "wrongResponse":
                c["operations"]["listBooks"]["response"] = "Book"
            elif kind == "wrongRole":
                r["resources"]["books"]["operations"]["list"] = "adjustStock"
            else:
                r["resources"]["books"]["views"]["list"]["fields"] = ["total"]
            with self.subTest(kind=kind), self.assertRaises(ContractError):
                compile_resource_bundle(c, r, ERRORS)

    def test_semantic_diff_catches_query_default_change(self):
        copy_source = copy.deepcopy(SOURCE)
        copy_source["operations"]["listBooks"]["query"]["limit"]["default"] = 12
        report = compare_contracts(SOURCE, copy_source)
        self.assertFalse(report["compatible"])
        self.assertIn("operations.listBooks.query", [x["path"] for x in report["changes"]])
        bundle = compare_resource_bundles(SOURCE, RESOURCES, copy_source, RESOURCES)
        self.assertFalse(bundle["compatible"])

    def test_v02_artifacts_still_identical(self):
        self.assertEqual(compile_contract(OLD), compile_v02(OLD))
        old_java = generate_java(OLD)
        self.assertNotIn("@org.springframework.validation.annotation.Validated",
                         old_java["src/main/java/dev/protocolia/generated/ContractController.java"])
        self.assertIn("http.httpBasic", old_java["src/main/java/dev/protocolia/generated/SecurityConfig.java"])

    def test_cli_compile_profile_bundle_and_reject_collisions(self):
        with tempfile.TemporaryDirectory() as d:
            env = dict(os.environ, PYTHONPATH=str(ROOT / "src"))
            path = str(DIR / "contract.json")
            out = Path(d) / "bundle"
            cmd = [sys.executable, "-m", "protocolia", "compile-bundle", path,
                   "--profile", "java-spring-basic-demo",
                   "--resources", str(DIR / "resources.json"),
                   "--domain-errors", str(DIR / "http-errors.json"),
                   "--out", str(out)]
            for _ in range(2):
                p = subprocess.run(cmd, cwd=ROOT, env=env, text=True, capture_output=True)
                self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(json.loads((out / "ir.json").read_text())["version"], "0.3")
            self.assertTrue((out / "ui-manifest.json").exists())
            # Controlled generated-output ownership rejects handwritten overwrite.
            (out / "ui-manifest.json").write_text("user-edited")
            p = subprocess.run(cmd, cwd=ROOT, env=env, text=True, capture_output=True)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn("generated artifact modified", p.stderr)


if __name__ == "__main__":
    unittest.main()
