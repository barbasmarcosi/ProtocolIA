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
        for fields in self.c["models"].values():
            for spec in fields.values(): spec["required"]=True
    def test_generates_deterministic_java(self):
        a=generate_java(self.c)
        self.assertEqual(a,generate_java(self.c))
        self.assertIn("@jakarta.validation.constraints.DecimalMin",next(v for k,v in a.items() if k.endswith("SaleRequest.java")))
        self.assertIn("business handler missing",next(v for k,v in a.items() if k.endswith("ContractController.java")))
    def test_controller_delegates_to_a_typed_business_port(self):
        a = generate_java(self.c)
        port = a["src/main/java/dev/protocolia/generated/ContractHandlers.java"]
        controller = a["src/main/java/dev/protocolia/generated/ContractController.java"]
        self.assertIn("public interface ContractHandlers", port)
        self.assertIn("ObjectProvider<ContractHandlers>", controller)
        self.assertIn("return handler.registerSale(", controller)
        self.assertIn("handler == null", controller)
        self.assertIn("HttpStatus.CREATED", controller)

    def test_regeneration_preserves_custom_handlers(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            files = generate_java(self.c)
            write_java(files, out)
            custom = out / "src/main/java/dev/protocolia/generated/custom/CustomHandlers.java"
            custom.parent.mkdir(parents=True)
            custom.write_text("manual business logic")
            write_java(files, out)
            self.assertEqual(custom.read_text(), "manual business logic")

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

    def test_optional_field_requires_proven_null_absence_semantics(self):
        self.c["models"]["SaleRequest"]["sku"]["required"]=False
        with self.assertRaises(ContractError): generate_java(self.c)
