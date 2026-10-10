import copy
import json
import tempfile
import unittest
from pathlib import Path
from protocolia import ContractError
from protocolia.java_spring import generate_java,write_java

EXAMPLE=Path(__file__).resolve().parents[1]/"examples/sales-v0.2.json"

class JavaTargetTest(unittest.TestCase):
    def setUp(self):
        self.c=json.loads(EXAMPLE.read_text())
        del self.c["models"]["SaleRequest"]["sale_state"]["constraints"]
    def test_generates_deterministic_java(self):
        a=generate_java(self.c)
        self.assertEqual(a,generate_java(self.c))
        self.assertIn("@jakarta.validation.constraints.DecimalMin",next(v for k,v in a.items() if k.endswith("SaleRequest.java")))
        self.assertIn("business handler missing",next(v for k,v in a.items() if k.endswith("ContractController.java")))
    def test_unsupported_enum_is_rejected(self):
        self.c["models"]["SaleRequest"]["sale_state"]["constraints"]={"enum":["pending","completed"]}
        with self.assertRaises(ContractError): generate_java(self.c)
    def test_v01_contract_is_rejected(self):
        self.c["version"]="0.1"
        with self.assertRaises(ContractError): generate_java(self.c)
    def test_regeneration_rejects_manually_modified_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=generate_java(self.c)
            write_java(out,Path(tmp));write_java(out,Path(tmp))
            (Path(tmp)/"pom.xml").write_text("custom")
            with self.assertRaises(ContractError): write_java(out,Path(tmp))
