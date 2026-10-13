"""Versioned G5 nullable-field contract evolution regression suite."""
import copy
import json
import unittest
from pathlib import Path

from protocolia import ContractError, compile_contract, validate, compare_contracts, validate_payload
from protocolia.http_projection import compile_java_http
from protocolia.java_spring import generate_java
from protocolia.resource_bundle import compile_resource_bundle

ROOT = Path(__file__).resolve().parents[1]
OLD = json.loads((ROOT / "examples/books-paging-v03/contract.json").read_text())
BEFORE = copy.deepcopy(OLD)
BEFORE["version"] = "0.4"
AFTER = json.loads((ROOT / "examples/books-evolution-v04/contract.json").read_text())
RESOURCES = json.loads((ROOT / "examples/books-evolution-v04/resources.json").read_text())
ERRORS = json.loads((ROOT / "examples/books-paging-v03/http-errors.json").read_text())


class V04EvolutionTest(unittest.TestCase):
    def test_optional_nullable_wire_projections_are_deterministic(self):
        artifacts = compile_contract(AFTER)
        self.assertEqual(artifacts, compile_contract(AFTER))
        self.assertEqual(validate(AFTER)["version"], "0.4")
        api = json.loads(artifacts["openapi.json"])
        payload_schema = json.loads(artifacts["payload.schema.json"])
        for model in ("Book", "BookRequest"):
            wire = api["components"]["schemas"][model]
            self.assertNotIn("publishedAt", wire["required"])
            self.assertEqual(wire["properties"]["publishedAt"]["type"], ["string", "null"])
            self.assertEqual(wire["properties"]["publishedAt"]["format"], "date-time")
            self.assertEqual(payload_schema["$defs"][model]["properties"]["publishedAt"]["type"], ["string", "null"])
        self.assertEqual(artifacts["types.ts"].count("publishedAt?: string | null;"), 2)
        self.assertEqual(api["info"]["version"], "0.4")

    def test_reference_validation_distinguishes_missing_valid_null_and_invalid(self):
        book = {"isbn": "a", "title": "valid", "stock": 2}
        self.assertTrue(validate_payload(AFTER, "BookRequest", book))
        self.assertTrue(validate_payload(AFTER, "BookRequest", {**book, "publishedAt": None}))
        self.assertTrue(validate_payload(AFTER, "BookRequest", {**book, "publishedAt": "2026-10-12T12:00:00Z"}))
        self.assertFalse(validate_payload(AFTER, "BookRequest", {**book, "publishedAt": "invalid"}))
        self.assertFalse(validate_payload(AFTER, "BookRequest", {**book, "publishedAt": 5}))
        self.assertFalse(validate_payload(AFTER, "BookRequest", {**book, "unknown": "x"}))
        self.assertFalse(validate_payload(AFTER, "BookRequest", {**book, "stock": None}))
        self.assertFalse(validate_payload(AFTER, "BookRequest", {**book, "stock": True}))
        self.assertFalse(validate_payload(AFTER, "BookRequest", {"title": "valid", "stock": 1}))

    def test_unsupported_field_shapes_reject_not_silently_degrade(self):
        alternatives = (
            {"type": "datetime", "required": False},
            {"type": "datetime", "required": False, "nullable": False},
            {"type": "datetime", "required": True, "nullable": True},
            {"type": "Book[]", "required": False, "nullable": True},
            {"type": "datetime", "required": False, "nullable": "yes"},
            {"type": [], "required": False, "nullable": True},
        )
        for spec in alternatives:
            edited = copy.deepcopy(AFTER)
            edited["models"]["Book"]["publishedAt"] = spec
            with self.subTest(spec=spec), self.assertRaises(ContractError):
                validate(edited)
        old = copy.deepcopy(OLD)
        old["models"]["Book"]["publishedAt"] = AFTER["models"]["Book"]["publishedAt"]
        with self.assertRaises(ContractError):
            validate(old)

    def test_additive_compatibility_and_java_profile(self):
        result = compare_contracts(BEFORE, AFTER)
        self.assertTrue(result["compatible"])
        self.assertEqual(result["additive"], 2)
        self.assertEqual(result["breaking"], 0)
        generated = generate_java(AFTER)
        java = generated["src/main/java/dev/protocolia/generated/Book.java"]
        self.assertIn("java.time.OffsetDateTime publishedAt", java)
        self.assertNotIn("NotNull java.time.OffsetDateTime publishedAt", java)
        api = json.loads(compile_java_http(AFTER, ERRORS)["openapi.json"])
        self.assertEqual(api["paths"]["/api/books"]["post"]["security"], [{"basicAuth": []}])
        self.assertIn("201", api["paths"]["/api/books"]["post"]["responses"])
        bundle = compile_resource_bundle(AFTER, RESOURCES, ERRORS)
        self.assertIn("publishedAt", json.loads(bundle["ui-manifest.json"])["resources"]["books"]["views"]["create"]["fields"])
        self.assertEqual(json.loads(bundle["resource-ir.json"])["contractVersion"], "0.4")

    def test_prior_versions_are_not_rewritten(self):
        from protocolia.v03 import compile_contract as compile_v03
        self.assertEqual(compile_contract(OLD), compile_v03(OLD))


if __name__ == "__main__":
    unittest.main()
