"""G0 semantic resource/UI manifest generation and conservative compatibility."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from protocolia import ContractError, compile_contract, write_artifacts, preview_artifacts
from protocolia.http_projection import compile_java_http
from protocolia.resource_bundle import (
    BUNDLE_COMPILER, compare_resource_bundles, compile_resource_bundle,
    validate_resource_sidecar,
)

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "examples/stock-change/protocolia"
CONTRACT = json.loads((DIRECTORY / "contract.json").read_text())
RESOURCES = json.loads((DIRECTORY / "resources.json").read_text())
ERRORS = json.loads((DIRECTORY / "http-errors.json").read_text())


class ResourceBundleTest(unittest.TestCase):
    def test_compiles_deterministic_typed_resources_and_manifests(self):
        result = compile_resource_bundle(CONTRACT, RESOURCES, ERRORS)
        self.assertEqual(len(result), 9)
        self.assertEqual(result, compile_resource_bundle(CONTRACT, RESOURCES, ERRORS))
        enriched = json.loads(result["resource-ir.json"])
        ui = json.loads(result["ui-manifest.json"])
        caps = json.loads(result["capability-manifest.json"])
        generation = json.loads(result["generation-manifest.json"])
        self.assertEqual(enriched["version"], "0.1")
        self.assertEqual(enriched["contractVersion"], "0.2")
        self.assertEqual(enriched["operationBindings"]["adjustStock"],
                         {"resource": "books", "role": "action", "actionId": "restock"})
        self.assertEqual(ui["resources"]["books"]["identityField"], "isbn")
        self.assertEqual(ui["resources"]["books"]["views"]["create"]["schemaRef"],
                         "#/$defs/BookRequest")
        self.assertEqual(ui["resources"]["books"]["views"]["restock"]["fields"], ["quantity"])
        self.assertEqual(ui["resources"]["books"]["invalidates"]["adjustStock"], ["books"])
        self.assertEqual(caps["operations"]["adjustStock"]["capability"], "catalog.write")
        self.assertEqual(caps["operations"]["adjustStock"]["effects"], ["read", "write"])
        self.assertEqual(caps["operations"]["health"]["capability"], "public")
        self.assertEqual(generation["compiler"], BUNDLE_COMPILER)
        self.assertEqual(len(generation["contractSha256"]), 64)
        self.assertNotIn("generatedAt", generation)
        self.assertEqual(set(generation["artifacts"]), set(result)-{"generation-manifest.json","manifest.json"})
        self.assertEqual(set(json.loads(result["manifest.json"])["artifacts"]), set(result)-{"manifest.json"})

    def test_openapi_extensions_match_actual_operation_bindings(self):
        result = compile_resource_bundle(CONTRACT, RESOURCES, ERRORS)
        spec = json.loads(result["openapi.json"])
        adjustment = spec["paths"]["/api/books/{isbn}/stock"]["patch"]
        self.assertEqual(adjustment["operationId"], "adjustStock")
        self.assertEqual(adjustment["x-protocolia-resource"], "books")
        self.assertEqual(adjustment["x-protocolia-operation-role"], "action")
        self.assertEqual(adjustment["x-protocolia-action-id"], "restock")
        self.assertEqual(adjustment["tags"], ["books"])
        self.assertEqual(set(adjustment["responses"]), {"200", "400", "401", "403", "404", "409", "501"})
        self.assertEqual(adjustment["security"], [{"basicAuth": []}])
        self.assertNotIn("x-protocolia-resource", spec["paths"]["/health"]["get"])
        self.assertEqual(spec["paths"]["/health"]["get"]["security"], [])
        self.assertEqual(spec["paths"]["/api/books"]["post"]["responses"]["201"]["content"]["application/json"]["schema"],
                         {"$ref": "#/components/schemas/Book"})

    def test_historical_output_is_unchanged_and_separate(self):
        generic = compile_contract(CONTRACT)
        http = compile_java_http(CONTRACT, ERRORS)
        bundle = compile_resource_bundle(CONTRACT, RESOURCES, ERRORS)
        self.assertEqual(bundle["ir.json"], generic["ir.json"])
        self.assertEqual(bundle["payload.schema.json"], generic["payload.schema.json"])
        self.assertEqual(bundle["types.ts"], generic["types.ts"])
        self.assertEqual(json.loads(http["openapi.json"])["components"]["securitySchemes"],
                         json.loads(bundle["openapi.json"])["components"]["securitySchemes"])
        self.assertNotEqual(generic["openapi.json"], bundle["openapi.json"])
        self.assertNotEqual(http["manifest.json"], bundle["manifest.json"])

    def test_determinism_reordered_resource_view_and_operation_keys(self):
        reordered = copy.deepcopy(RESOURCES)
        reordered["resources"]["books"]["views"] = dict(reversed(list(reordered["resources"]["books"]["views"].items())))
        reordered["resources"]["books"]["operations"]["actions"] = dict(reversed(list(reordered["resources"]["books"]["operations"]["actions"].items())))
        reordered_contract = copy.deepcopy(CONTRACT)
        reordered_contract["operations"] = dict(reversed(list(reordered_contract["operations"].items())))
        self.assertEqual(compile_resource_bundle(CONTRACT, RESOURCES, ERRORS),
                         compile_resource_bundle(reordered_contract, reordered, ERRORS))

    def test_invalid_resources_fail_closed(self):
        cases = []
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["identityField"] = "stock"; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["operations"]["detail"] = "createBook"; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["operations"]["list"] = "getBook"; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["views"]["restock"]["fields"] = ["stock"]; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["views"]["detail"]["fields"] = ["secret"]; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["views"]["detail"]["fields"] = ["isbn", "isbn"]; cases.append(value)
        value = copy.deepcopy(RESOURCES); del value["resources"]["books"]["views"]["create"]; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["invalidates"] = {}; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["invalidates"]["adjustStock"] = ["missing"]; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["views"]["create"]["html"] = "<script>"; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["version"] = "0.2"; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["operations"]["actions"]["detail"] = "adjustStock"; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["operations"]["actions"]["restock"] = "health"; cases.append(value)
        value = copy.deepcopy(RESOURCES); value["resources"]["books"]["views"]["create"]["title"] = "x\nBad"; cases.append(value)
        for i, value in enumerate(cases):
            with self.subTest(index=i), self.assertRaises(ContractError):
                validate_resource_sidecar(CONTRACT, value)

    def test_diff_catches_capability_and_semantic_drift(self):
        same = compare_resource_bundles(CONTRACT, RESOURCES, CONTRACT, RESOURCES)
        self.assertTrue(same["compatible"])
        changed = copy.deepcopy(CONTRACT)
        changed["operations"]["adjustStock"]["capability"] = "catalog.other.write"
        report = compare_resource_bundles(CONTRACT, RESOURCES, changed, RESOURCES)
        self.assertFalse(report["compatible"])
        self.assertTrue(any(c["path"] == "operations.adjustStock.capability"
                            for c in report["wireContract"]["changes"]))
        sidecar = copy.deepcopy(RESOURCES)
        sidecar["resources"]["books"]["views"]["detail"]["fields"].remove("stock")
        report = compare_resource_bundles(CONTRACT, RESOURCES, CONTRACT, sidecar)
        self.assertFalse(report["compatible"])
        self.assertIn("resources.books.views", [c["path"] for c in report["semanticChanges"]])

    def test_safe_regeneration_keeps_generated_ownership_separate(self):
        bundle = compile_resource_bundle(CONTRACT, RESOURCES, ERRORS)
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            folder = base / "bundle"
            write_artifacts(bundle, folder)
            self.assertEqual(preview_artifacts(bundle, folder)["changed"], 0)
            write_artifacts(bundle, folder)
            handwritten = base / "HandwrittenService.java"
            handwritten.write_text("user-owned")
            self.assertEqual(handwritten.read_text(), "user-owned")
            with self.assertRaises(ContractError):
                write_artifacts(compile_contract(CONTRACT), folder)
            with self.assertRaises(ContractError):
                write_artifacts(compile_java_http(CONTRACT, ERRORS), folder)
            (folder / "ui-manifest.json").write_text("tampered")
            with self.assertRaises(ContractError):
                preview_artifacts(bundle, folder)
            with self.assertRaises(ContractError):
                write_artifacts(bundle, folder)
            self.assertEqual(handwritten.read_text(), "user-owned")

    def test_cli_compile_and_semantic_diff(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            out = base / "bundle"
            source = DIRECTORY / "contract.json"
            desc = DIRECTORY / "resources.json"
            env = dict(os.environ, PYTHONPATH=str(ROOT / "src"))
            cmd = [sys.executable, "-m", "protocolia", "compile-bundle", str(source),
                   "--profile", "java-spring-basic-demo", "--resources", str(desc),
                   "--domain-errors", str(DIRECTORY / "http-errors.json"), "--out", str(out)]
            for _ in range(2):
                done = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(done.returncode, 0, done.stderr)
            self.assertTrue((out / "generation-manifest.json").is_file())
            same = subprocess.run([sys.executable, "-m", "protocolia", "diff-bundle",
                                   str(source), str(source), "--resources", str(desc),
                                   "--candidate-resources", str(desc)],
                                  cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(same.returncode, 0, same.stderr)
            incompatible = copy.deepcopy(RESOURCES)
            incompatible["resources"]["books"]["views"]["detail"]["fields"].remove("stock")
            changed = base / "changed.json"
            changed.write_text(json.dumps(incompatible))
            diff = subprocess.run([sys.executable, "-m", "protocolia", "diff-bundle",
                                   str(source), str(source), "--resources", str(desc),
                                   "--candidate-resources", str(changed)],
                                  cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(diff.returncode, 2, diff.stdout + diff.stderr)
            self.assertFalse(json.loads(diff.stdout)["compatible"])

if __name__ == "__main__":
    unittest.main()
