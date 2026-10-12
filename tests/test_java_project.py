"""Developer-facing init-java workflow and honest scaffold behavior."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from protocolia import ContractError
from protocolia.java_project import CUSTOM_FILE, init_java

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "examples/catalog-vertical/contract.json").read_text())


class InitJavaWorkflowTest(unittest.TestCase):
    def test_first_init_generates_one_user_owned_implementer(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "catalog"
            created, count = init_java(CATALOG, out)
            self.assertTrue(created)
            self.assertEqual(count, 11)
            self.assertTrue((out / "pom.xml").is_file())
            starter = (out / CUSTOM_FILE).read_text()
            self.assertIn("@org.springframework.stereotype.Service", starter)
            self.assertIn("implements ContractHandlers", starter)
            self.assertIn("public Book createBook(BookRequest body)", starter)
            self.assertIn("public Book getBook(String isbn)", starter)
            self.assertIn("public Health health()", starter)
            self.assertEqual(starter.count("HttpStatus.NOT_IMPLEMENTED"), 3)
            self.assertNotIn("RestController", starter)
            self.assertNotIn(str(CUSTOM_FILE), json.loads(
                (out / "protocolia-java-manifest.json").read_text())["artifacts"])

    def test_rerunning_init_never_overwrites_edited_business_logic(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "app"
            init_java(CATALOG, out)
            dest = out / CUSTOM_FILE
            dest.write_text("MY OWN JAVA CODE")
            created, _ = init_java(CATALOG, out)
            self.assertFalse(created)
            self.assertEqual(dest.read_text(), "MY OWN JAVA CODE")
            self.assertTrue((out / "src/main/java/dev/protocolia/generated/ContractHandlers.java").is_file())

    def test_contract_change_keeps_custom_file_and_regenerates_interface(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "app"
            init_java(CATALOG, out)
            original = (out / CUSTOM_FILE).read_bytes()
            revised = copy.deepcopy(CATALOG)
            revised["operations"]["checkAnother"] = {
                "method": "GET", "path": "/another", "response": "Health",
                "capability": "public", "effects": ["read"],
                "depends_on": [], "params": {}
            }
            created, _ = init_java(revised, out)
            self.assertFalse(created)
            self.assertEqual(original, (out / CUSTOM_FILE).read_bytes())
            interface = (out / "src/main/java/dev/protocolia/generated/ContractHandlers.java").read_text()
            self.assertIn("Health checkAnother()", interface)

    def test_rejects_symlink_before_modifying_generated_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "app"
            init_java(CATALOG, out)
            manifest = out / "protocolia-java-manifest.json"
            original = manifest.read_bytes()
            custom = out / CUSTOM_FILE
            custom.unlink()
            custom.symlink_to(Path(directory) / "elsewhere")
            with self.assertRaises(ContractError):
                init_java(CATALOG, out)
            self.assertEqual(manifest.read_bytes(), original)

    def test_rejects_collision_when_custom_starter_is_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "app"
            starter = out / CUSTOM_FILE
            starter.mkdir(parents=True)
            with self.assertRaises(ContractError):
                init_java(CATALOG, out)
            self.assertFalse((out / "pom.xml").exists())

    def test_cli_generates_project_with_single_invocation(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "project"
            argv = [
                sys.executable, "-m", "protocolia", "init-java",
                str(ROOT / "examples/catalog-vertical/contract.json"),
                "--out", str(out),
            ]
            env = dict(os.environ)
            env["PYTHONPATH"] = str(ROOT / "src")
            result = subprocess.run(argv, cwd=ROOT, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("READY Java Spring project", result.stdout)
            self.assertTrue((out / CUSTOM_FILE).is_file())
            rereun = subprocess.run(argv, cwd=ROOT, env=env, text=True, capture_output=True)
            self.assertEqual(rereun.returncode, 0, rereun.stderr)
            self.assertIn("KEPT user-owned", rereun.stdout)

    def test_bad_contract_fails_before_scaffold(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "project"
            bad = copy.deepcopy(CATALOG)
            bad["models"]["Book"]["stock"]["required"] = False
            with self.assertRaises(ContractError):
                init_java(bad, out)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
