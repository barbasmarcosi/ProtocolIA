"""P0: conformance boundary, golden reproducibility and adversarial behavior."""
import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from protocolia import ContractError, compile_contract, validate, write_artifacts

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "sales.json"
GOLDEN = ROOT / "tests" / "fixtures" / "v0.1-sales-hashes.json"


class P0VerificationTest(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(EXAMPLE.read_text(encoding="utf-8"))

    def test_frozen_output_hashes(self):
        expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
        actual = {name: hashlib.sha256(content.encode("utf-8")).hexdigest()
                  for name, content in sorted(compile_contract(self.contract).items())}
        self.assertEqual(actual, expected, "changed output requires an explicit fixture review")

    def test_reordered_objects_produce_identical_outputs(self):
        c = copy.deepcopy(self.contract)
        c["operations"] = dict(reversed(list(c["operations"].items())))
        for name in c["models"]:
            c["models"][name] = dict(reversed(list(c["models"][name].items())))
        self.assertEqual(compile_contract(c), compile_contract(self.contract))

    def test_manifest_hashes_are_bound_to_generated_outputs(self):
        compiled = compile_contract(self.contract)
        manifest = json.loads(compiled["manifest.json"])
        self.assertEqual(set(manifest["artifacts"]), set(compiled) - {"manifest.json"})
        for name, expected in manifest["artifacts"].items():
            self.assertEqual(hashlib.sha256(compiled[name].encode()).hexdigest(), expected)

    def test_untrusted_manifest_cannot_introduce_new_paths(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            outside = Path(d) / "other.txt"
            outside.write_text("unchanged")
            write_artifacts(compile_contract(self.contract), out)
            manifest = json.loads((out / "manifest.json").read_text())
            manifest["artifacts"]["../other.txt"] = "malicious"
            (out / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaises(ContractError):
                write_artifacts(compile_contract(self.contract), out)
            self.assertEqual(outside.read_text(), "unchanged")

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unsupported")
    def test_symlinked_artifact_is_rejected_on_regeneration(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            write_artifacts(compile_contract(self.contract), out)
            p = out / "types.ts"
            p.unlink()
            p.symlink_to(EXAMPLE)
            with self.assertRaises(ContractError):
                write_artifacts(compile_contract(self.contract), out)
            self.assertEqual(json.loads(EXAMPLE.read_text()), self.contract)

    def test_invalid_contract_leaves_output_untouched(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            baseline = compile_contract(self.contract)
            write_artifacts(baseline, out)
            self.contract["operations"]["registerSale"]["capability"] = "public"
            with self.assertRaises(ContractError):
                write_artifacts(compile_contract(self.contract), out)
            self.assertEqual({p.name: p.read_text() for p in out.iterdir()}, baseline)

    def test_duplicate_json_member_is_rejected_by_cli(self):
        with tempfile.TemporaryDirectory() as d:
            malformed = Path(d) / "duplicate.json"
            malformed.write_text('{"version":"0.1","version":"0.2"}', encoding="utf-8")
            proc = subprocess.run([sys.executable, "-m", "protocolia", "validate", str(malformed)],
                                  capture_output=True, text=True, check=False)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("duplicate JSON member", proc.stderr)

    def test_no_import_side_effects_provider_free(self):
        code = "import protocolia; assert callable(protocolia.compile_contract)"
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
