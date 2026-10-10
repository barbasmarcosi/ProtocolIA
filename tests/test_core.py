import copy
import json
import tempfile
import unittest
from pathlib import Path

from protocolia import ContractError, compile_contract, validate, write_artifacts

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "sales.json"


class CompilerTest(unittest.TestCase):
    def setUp(self):
        self.c = json.loads(EXAMPLE.read_text(encoding="utf-8"))

    def test_compiles_reproducibly(self):
        a = compile_contract(self.c)
        self.assertEqual(a, compile_contract(self.c))
        self.assertEqual(json.loads(a["ir.json"])["execution_order"], ["health", "registerSale"])
        api = json.loads(a["openapi.json"])
        self.assertEqual(api["paths"]["/sales"]["post"]["security"], [{"bearerAuth": []}])
        self.assertIn("export interface SaleRequest", a["types.ts"])
        self.assertIn("contract_sha256", a["manifest.json"])

    def test_order_agnostic_model_map(self):
        c = copy.deepcopy(self.c)
        c["models"] = dict(reversed(list(c["models"].items())))
        self.assertEqual(compile_contract(c), compile_contract(self.c))

    def test_rejects_malformed_operation_values(self):
        for key, value in [("method", []), ("response", []), ("method", None)]:
            with self.subTest(key=key, value=value):
                c = copy.deepcopy(self.c)
                c["operations"]["health"][key] = value
                with self.assertRaises(ContractError):
                    validate(c)

    def test_rejects_reserved_model_identifier(self):
        self.c["models"]["interface"] = {"x": {"type": "string", "required": True}}
        with self.assertRaises(ContractError):
            validate(self.c)

    def test_rejects_unknown_model(self):
        self.c["operations"]["health"]["response"] = "NotReal"
        with self.assertRaises(ContractError):
            validate(self.c)

    def test_rejects_unknown_keys(self):
        self.c["surprise"] = "ignore safeguards"
        with self.assertRaises(ContractError):
            validate(self.c)

    def test_rejects_dependency_cycle(self):
        self.c["operations"]["health"]["depends_on"] = ["registerSale"]
        with self.assertRaises(ContractError):
            validate(self.c)

    def test_rejects_public_write(self):
        self.c["operations"]["registerSale"]["capability"] = "public"
        with self.assertRaises(ContractError):
            validate(self.c)

    def test_rejects_route_parameters_until_supported(self):
        self.c["operations"]["health"]["path"] = "/health/{id}"
        with self.assertRaises(ContractError):
            validate(self.c)

    def test_rejects_duplicate_endpoints(self):
        self.c["operations"]["registerSale"]["method"] = "GET"
        self.c["operations"]["registerSale"]["path"] = "/health"
        with self.assertRaises(ContractError):
            validate(self.c)

    def test_safe_regeneration_and_protect_manual_edits(self):
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d)
            outputs = compile_contract(self.c)
            write_artifacts(outputs, directory)
            write_artifacts(outputs, directory)
            (directory / "types.ts").write_text("manually edited")
            with self.assertRaises(ContractError):
                write_artifacts(outputs, directory)

    def test_unmanaged_files_are_protected(self):
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d)
            (directory / "types.ts").write_text("my code")
            with self.assertRaises(ContractError):
                write_artifacts(compile_contract(self.c), directory)

    def test_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as d:
            directory = Path(d)
            (directory / "out").symlink_to(directory, target_is_directory=True)
            with self.assertRaises(ContractError):
                write_artifacts(compile_contract(self.c), directory / "out")

    def test_no_executable_code_in_schema(self):
        self.c["models"]["SaleRequest"]["quantity"]["type"] = "os.system('rm -rf /')"
        with self.assertRaises(ContractError):
            validate(self.c)


if __name__ == "__main__":
    unittest.main()
