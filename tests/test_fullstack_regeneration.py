"""G5 ownership, same-version evolution and fail-closed promotion tests."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from protocolia import ContractError
from protocolia.fullstack_regeneration import regenerate_fullstack
from protocolia.resource_bundle import compare_resource_bundles

ROOT=Path(__file__).resolve().parents[1]
AFTER=json.loads((ROOT/"examples/books-evolution-v04/contract.json").read_text())
RESOURCES=json.loads((ROOT/"examples/books-evolution-v04/resources.json").read_text())
ERRORS=json.loads((ROOT/"examples/books-paging-v03/http-errors.json").read_text())


def old_contract():
    old=copy.deepcopy(AFTER)
    for model in ("Book","BookRequest"):
        del old["models"][model]["publishedAt"]
    resources=copy.deepcopy(RESOURCES)
    for view in ("create","detail","list"):
        resources["resources"]["books"]["views"][view]["fields"].remove("publishedAt")
    return old,resources


def generate(contract,resources,out,jar,template):
    with patch("protocolia.fullstack_regeneration._java",return_value={
        "dev/protocolia/upstream/api/BooksApiDelegate.java":b"java-owned"}),patch(
        "protocolia.fullstack_regeneration._orval",return_value={
        "books.ts":b"ts-owned"}):
        return regenerate_fullstack(contract,resources,ERRORS,
            out=out,java_generator_jar=jar,web_template=template)


class FullstackRegenerationTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)
        self.jar=self.base/"generator.jar";self.jar.write_bytes(b"fake-test-only")
        self.template=self.base/"web";self.template.mkdir()
        self.output=self.base/"managed"
        self.handwritten=self.base/"domain.java"
        self.handwritten.write_bytes(b"DO NOT TOUCH")
        self.old,self.old_resources=old_contract()

    def test_optional_view_append_and_compatible_model_evolution(self):
        result=compare_resource_bundles(self.old,self.old_resources,AFTER,RESOURCES)
        self.assertTrue(result["compatible"],result)
        self.assertTrue(any(x["kind"]=="optional_view_fields_appended"
                            for x in result["semanticChanges"]))
        first=generate(self.old,self.old_resources,self.output,self.jar,self.template)
        self.assertEqual(first["state"],"GENERATED")
        result=generate(AFTER,RESOURCES,self.output,self.jar,self.template)
        self.assertEqual(result["state"],"GENERATED")
        baseline={p.relative_to(self.output).as_posix():p.read_bytes()
                  for p in self.output.rglob("*") if p.is_file()}
        generate(AFTER,RESOURCES,self.output,self.jar,self.template)
        current={p.relative_to(self.output).as_posix():p.read_bytes()
                 for p in self.output.rglob("*") if p.is_file()}
        self.assertEqual(baseline,current)
        self.assertEqual(self.handwritten.read_bytes(),b"DO NOT TOUCH")

    def test_added_operation_and_action_view_regenerates_compatibly(self):
        # Start with same v0.4 Books model but without renameBook. The new
        # PATCH operation and its RJSF view/invalidation are additive only
        # if all existing bindings remain byte-for-byte semantically stable.
        before=copy.deepcopy(AFTER)
        older_views=copy.deepcopy(RESOURCES)
        del before["operations"]["renameBook"]
        del before["models"]["TitleChange"]
        del older_views["resources"]["books"]["operations"]["actions"]["rename"]
        del older_views["resources"]["books"]["views"]["rename"]
        del older_views["resources"]["books"]["invalidates"]["renameBook"]
        report=compare_resource_bundles(before,older_views,AFTER,RESOURCES)
        self.assertTrue(report["compatible"],report)
        self.assertIn("resource_action_added",[x["kind"] for x in report["semanticChanges"]])
        generate(before,older_views,self.output,self.jar,self.template)
        generated=generate(AFTER,RESOURCES,self.output,self.jar,self.template)
        self.assertEqual(generated["state"],"GENERATED")
        self.assertEqual(self.handwritten.read_bytes(),b"DO NOT TOUCH")

    def test_breaking_contract_declined_without_any_file_mutation(self):
        generate(AFTER,RESOURCES,self.output,self.jar,self.template)
        manifest=(self.output/"fullstack-manifest.json").read_bytes()
        bad=copy.deepcopy(AFTER)
        bad["operations"]["createBook"]["capability"]="catalog.another.write"
        with self.assertRaises(ContractError):
            generate(bad,RESOURCES,self.output,self.jar,self.template)
        self.assertEqual((self.output/"fullstack-manifest.json").read_bytes(),manifest)
        self.assertEqual(self.handwritten.read_bytes(),b"DO NOT TOUCH")

    def test_modified_generated_or_unmanaged_file_refuses_ownership(self):
        generate(AFTER,RESOURCES,self.output,self.jar,self.template)
        source=self.output/"java/src/main/java/dev/protocolia/upstream/api/BooksApiDelegate.java"
        source.write_bytes(b"USER MODIFIED")
        with self.assertRaises(ContractError):
            generate(AFTER,RESOURCES,self.output,self.jar,self.template)
        self.assertEqual(source.read_bytes(),b"USER MODIFIED")
        source.write_bytes(b"java-owned")
        unmanaged=self.output/"custom-user-owned.txt"
        unmanaged.write_text("not generated")
        with self.assertRaises(ContractError):
            generate(AFTER,RESOURCES,self.output,self.jar,self.template)
        self.assertEqual(unmanaged.read_text(),"not generated")

    def test_generator_failure_retains_everything(self):
        generate(AFTER,RESOURCES,self.output,self.jar,self.template)
        old_manifest=(self.output/"fullstack-manifest.json").read_bytes()
        with patch("protocolia.fullstack_regeneration._java",
                   side_effect=ContractError("code generator failed")):
            with self.assertRaises(ContractError):
                regenerate_fullstack(AFTER,RESOURCES,ERRORS,out=self.output,
                    java_generator_jar=self.jar,web_template=self.template)
        self.assertEqual((self.output/"fullstack-manifest.json").read_bytes(),old_manifest)

    def test_output_symlink_rejected_without_following(self):
        target=self.base/"manual-dir";target.mkdir()
        (target/"manual.txt").write_text("keep")
        out=self.base/"alias";out.symlink_to(target,target_is_directory=True)
        with self.assertRaises(ContractError):
            generate(AFTER,RESOURCES,out,self.jar,self.template)
        self.assertEqual((target/"manual.txt").read_text(),"keep")

    def test_required_view_field_append_remains_breaking(self):
        next_resource=copy.deepcopy(self.old_resources)
        next_resource["resources"]["books"]["views"]["detail"]["fields"].append("total")
        # Metadata validation must fail: total not a Book field.
        with self.assertRaises(ContractError):
            compare_resource_bundles(self.old,self.old_resources,self.old,next_resource)


if __name__=="__main__":
    unittest.main()
