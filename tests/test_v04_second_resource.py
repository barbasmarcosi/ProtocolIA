"""Independent second-resource G5 generalization proof (no fake business logic)."""
import copy
import json
from pathlib import Path
import unittest
from protocolia import ContractError, compile_contract
from protocolia.java_spring import generate_java
from protocolia.resource_bundle import compile_resource_bundle,compare_resource_bundles

ROOT=Path(__file__).resolve().parents[1]
DIR=ROOT/"examples/g5-second-resource"
SOURCE=json.loads((DIR/"contract.json").read_text())
RESOURCES=json.loads((DIR/"resources.json").read_text())
ERRORS=json.loads((DIR/"http-errors.json").read_text())

class SecondResourceTest(unittest.TestCase):
    def test_widget_operation_client_surface_and_schema_are_canonical(self):
        output=compile_resource_bundle(SOURCE,RESOURCES,ERRORS)
        self.assertEqual(output,compile_resource_bundle(SOURCE,RESOURCES,ERRORS))
        api=json.loads(output["openapi.json"])
        self.assertEqual(api["paths"]["/api/widgets"]["post"]["operationId"],"createWidget")
        self.assertEqual(api["paths"]["/api/widgets"]["get"]["operationId"],"listWidgets")
        self.assertEqual(api["paths"]["/api/widgets/{sku}/units"]["patch"]["operationId"],"adjustUnits")
        self.assertEqual(json.loads(output["resource-ir.json"])["resources"]["widgets"]["identityField"],"sku")
        java=generate_java(SOURCE)
        self.assertIn("interface ContractHandlers",java["src/main/java/dev/protocolia/generated/ContractHandlers.java"])
        self.assertIn("WidgetPage listWidgets(",java["src/main/java/dev/protocolia/generated/ContractHandlers.java"])

    def test_optional_field_append_works_without_book_special_cases(self):
        next_contract=copy.deepcopy(SOURCE)
        next_views=copy.deepcopy(RESOURCES)
        for name in ("Widget","WidgetRequest"):
            next_contract["models"][name]["lastCheckedAt"]={
                "type":"datetime","required":False,"nullable":True}
        for name in ("detail","create","list"):
            next_views["resources"]["widgets"]["views"][name]["fields"].append("lastCheckedAt")
        semantic=compare_resource_bundles(SOURCE,RESOURCES,next_contract,next_views)
        self.assertTrue(semantic["compatible"],semantic)
        compiled=compile_resource_bundle(next_contract,next_views,ERRORS)
        api=json.loads(compiled["openapi.json"])
        self.assertEqual(api["components"]["schemas"]["Widget"]["properties"]["lastCheckedAt"]["type"],
                         ["string","null"])
        self.assertIn("lastCheckedAt?: string | null;",compiled["types.ts"])
        self.assertIn("lastCheckedAt",json.loads(compiled["ui-manifest.json"])["resources"]["widgets"]["views"]["create"]["fields"])

    def test_untrusted_resource_binding_fails_closed(self):
        candidate=copy.deepcopy(RESOURCES)
        candidate["resources"]["widgets"]["operations"]["actions"]["addUnits"]="createWidget"
        with self.assertRaises(ContractError):
            compile_resource_bundle(SOURCE,candidate,ERRORS)

if __name__=="__main__":
    unittest.main()
