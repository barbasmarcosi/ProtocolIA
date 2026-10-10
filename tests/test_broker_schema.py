"""P3-B2.1 JSON Schema 2020-12: structural and semantic checks remain distinct."""
import copy
import json
import unittest
from pathlib import Path
from jsonschema import Draft202012Validator
from protocolia.action_broker import validate_broker_plan, preview_plan, ExecutionDenied

ROOT=Path(__file__).resolve().parents[1]
PLAN=json.loads((ROOT/"examples/broker-plan-v0.5.json").read_text())
POLICY=json.loads((ROOT/"examples/broker-host-policy-v0.5.json").read_text())
SCH=json.loads((ROOT/"schemas/broker-plan-v0.5.schema.json").read_text())
HOST=json.loads((ROOT/"schemas/broker-host-policy-v0.5.schema.json").read_text())

class BrokerSchemas(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Draft202012Validator.check_schema(SCH)
        Draft202012Validator.check_schema(HOST)
        cls.plan=Draft202012Validator(SCH)
        cls.host=Draft202012Validator(HOST)
    def test_consumer_positive_and_normalized_validation(self):
        self.assertTrue(self.plan.is_valid(PLAN))
        self.assertTrue(self.host.is_valid(POLICY))
        self.assertEqual(len(validate_broker_plan(PLAN)["actions"]),3)
    def test_structural_rejections_match_parser(self):
        cases=[]
        c=copy.deepcopy(PLAN);c["actions"][0]["tool"]="shell.exec";cases.append(c)
        c=copy.deepcopy(PLAN);c["actions"][0]["effects"]=["write"];cases.append(c)
        c=copy.deepcopy(PLAN);c["actions"][0]["args"]["resource"]="../outside";cases.append(c)
        c=copy.deepcopy(PLAN);c["actions"][0]["args"]["input"]="/etc/passwd";cases.append(c)
        c=copy.deepcopy(PLAN);c["actions"][0]["capability"]="compute.literal";cases.append(c)
        c=copy.deepcopy(PLAN);c["actions"][1]["output_type"]="boolean";cases.append(c)
        c=copy.deepcopy(PLAN);c["actions"][1]["timeout_ms"]=0;cases.append(c)
        c=copy.deepcopy(PLAN);c["actions"][1]["args"]["value"]=False;cases.append(c)
        for c in cases:
            with self.subTest(c=c):
                self.assertFalse(self.plan.is_valid(c))
                with self.assertRaises(ExecutionDenied):validate_broker_plan(c)
    def test_semantic_policy_or_dependency_differences_stay_out_of_schema(self):
        c=copy.deepcopy(PLAN)
        c["actions"][0]["depends_on"]=["verify"]
        self.assertTrue(self.plan.is_valid(c))
        with self.assertRaises(ExecutionDenied):validate_broker_plan(c)
        p=copy.deepcopy(POLICY)
        p["grants"]["file.sha256"]=[]
        self.assertTrue(self.host.is_valid(p))
    def test_invalid_host_policy_is_structurally_denied(self):
        invalid=[]
        c=copy.deepcopy(POLICY);c["grants"]["file.sha256"]=["*"];invalid.append(c)
        c=copy.deepcopy(POLICY);c["max_external_reads"]=2;invalid.append(c)
        c=copy.deepcopy(POLICY);c["grants"]["file.write"]=["*"];invalid.append(c)
        for c in invalid:
            self.assertFalse(self.host.is_valid(c))
