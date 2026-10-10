"""P3 JSON Schema 2020-12 structural/semantic separation."""
import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator
from protocolia.action_runtime import ExecutionDenied, dry_run, validate_plan

ROOT=Path(__file__).resolve().parents[1]
P=json.loads((ROOT/"examples/action-plan-v0.4.json").read_text())
POL=json.loads((ROOT/"examples/action-policy-v0.4.json").read_text())
PS=json.loads((ROOT/"schemas/action-plan-v0.4.schema.json").read_text())
POL_S=json.loads((ROOT/"schemas/action-policy-v0.4.schema.json").read_text())

class ActionSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Draft202012Validator.check_schema(PS)
        Draft202012Validator.check_schema(POL_S)
        cls.schema=Draft202012Validator(PS)
        cls.policy_schema=Draft202012Validator(POL_S)
    def test_positive_example(self):
        self.assertTrue(self.schema.is_valid(P))
        self.assertTrue(self.policy_schema.is_valid(POL))
        self.assertEqual(len(validate_plan(P)["actions"]),4)
        self.assertEqual(dry_run(P,POL)["writes"],1)
    def test_bad_shapes_forbidden_consistently(self):
        variants=[]
        c=copy.deepcopy(P);c["actions"][0]["tool"]="shell";variants.append(c)
        c=copy.deepcopy(P);c["actions"][0]["output_type"]="boolean";variants.append(c)
        c=copy.deepcopy(P);c["actions"][1]["effects"]=[];variants.append(c)
        c=copy.deepcopy(P);c["actions"][1]["args"]["key"]="../escape";variants.append(c)
        c=copy.deepcopy(P);c["actions"][2]["timeout_ms"]=0;variants.append(c)
        c=copy.deepcopy(P);c["actions"][0]["args"]["value"]=5;variants.append(c)
        c=copy.deepcopy(P);c["actions"][2]["source"]="arbitrary-code";variants.append(c)
        for item in variants:
            with self.subTest(item=item):
                self.assertFalse(self.schema.is_valid(item))
                with self.assertRaises(ExecutionDenied):validate_plan(item)
    def test_dependency_cycle_is_semantic_not_schema_rule(self):
        c=copy.deepcopy(P)
        c["actions"][0]["depends_on"]=["verify"]
        self.assertTrue(self.schema.is_valid(c))
        with self.assertRaises(ExecutionDenied):validate_plan(c)
    def test_policy_is_a_structural_description_not_a_grant_from_plan(self):
        p=copy.deepcopy(POL);p["grants"]["kv.write"]=[]
        self.assertTrue(self.policy_schema.is_valid(p))
        with self.assertRaisesRegex(ExecutionDenied,"capability/resource denied"):dry_run(P,p)
