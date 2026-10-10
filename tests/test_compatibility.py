"""P1-B conservative API compatibility checks, no runtime behavior claims."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from protocolia import ContractError, compare_contracts

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "sales.json"


class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.before = json.loads(EXAMPLE.read_text(encoding="utf-8"))
        self.after = copy.deepcopy(self.before)

    def test_identical_and_reordered_contracts(self):
        self.assertEqual(compare_contracts(self.before, self.after)["changes"], [])
        self.after["operations"] = dict(reversed(list(self.after["operations"].items())))
        self.assertTrue(compare_contracts(self.before, self.after)["compatible"])
        self.assertEqual(compare_contracts(self.before, self.after)["changes"], [])

    def test_add_optional_field(self):
        self.after["models"]["SaleRequest"]["note"] = {"type": "string", "required": False}
        report = compare_contracts(self.before, self.after)
        self.assertTrue(report["compatible"])
        self.assertEqual(report["additive"], 1)
        self.assertEqual(report["changes"][0]["kind"], "optional_field_added")

    def test_add_required_field_is_breaking(self):
        self.after["models"]["SaleRequest"]["token"] = {"type": "string", "required": True}
        report = compare_contracts(self.before, self.after)
        self.assertFalse(report["compatible"])
        self.assertEqual(report["changes"][0]["kind"], "required_field_added")

    def test_remove_field_is_breaking(self):
        del self.after["models"]["SaleRequest"]["product_id"]
        self.assertEqual(compare_contracts(self.before, self.after)["breaking"], 1)

    def test_change_response_type_is_breaking(self):
        self.after["operations"]["registerSale"]["response"] = "Health"
        self.assertFalse(compare_contracts(self.before, self.after)["compatible"])

    def test_change_auth_is_breaking_even_if_more_permissive(self):
        self.after["operations"]["health"]["capability"] = "health.read"
        self.assertEqual(compare_contracts(self.before, self.after)["breaking"], 1)

    def test_effect_order_not_significant(self):
        self.after["operations"]["registerSale"]["effects"].reverse()
        self.assertTrue(compare_contracts(self.before, self.after)["compatible"])

    def test_new_operation_is_additive(self):
        self.after["operations"]["getHealth"] = {"method": "GET", "path": "/healthcheck", "response": "Health", "capability": "public", "effects": [], "depends_on": []}
        report = compare_contracts(self.before, self.after)
        self.assertTrue(report["compatible"])
        self.assertEqual(report["changes"][0]["kind"], "operation_added")

    def test_invalid_contract_rejected_prior_to_diff(self):
        self.after["operations"]["health"]["effects"] = ["write"]
        with self.assertRaises(ContractError):
            compare_contracts(self.before, self.after)

    def test_cli_status_codes_and_valid_json_output(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d) / "old.json"
            candidate = Path(d) / "new.json"
            source.write_text(json.dumps(self.before))
            candidate.write_text(json.dumps(self.after))
            cmd = [sys.executable, "-m", "protocolia", "diff", str(source), str(candidate)]
            proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(proc.stdout)["breaking"], 0)
            self.after["models"]["SaleRequest"]["quantity"]["required"] = False
            candidate.write_text(json.dumps(self.after))
            proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
            self.assertEqual(proc.returncode, 2, proc.stderr)
            self.assertGreater(json.loads(proc.stdout)["breaking"], 0)


if __name__ == "__main__":
    unittest.main()
