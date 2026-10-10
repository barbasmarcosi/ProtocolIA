import copy
import json
import unittest
from pathlib import Path
from protocolia import ContractError
from protocolia.inventory_backend import generate_inventory
EXAMPLE=Path(__file__).resolve().parents[1]/"examples/inventory-v0.2.json"
class InventoryTemplateTest(unittest.TestCase):
    def setUp(self):self.c=json.loads(EXAMPLE.read_text())
    def test_emits_stable_transactional_sources(self):
        a=generate_inventory(self.c)
        self.assertEqual(a,generate_inventory(self.c))
        self.assertIn("stock>=?",a["src/main/java/dev/protocolia/generated/InventoryService.java"])
        self.assertIn("ON CONFLICT(idempotency_key)",a["src/main/java/dev/protocolia/generated/InventoryService.java"])
        self.assertIn("flyway.enabled",a["src/main/resources/application.properties"])
    def test_cannot_silently_weaken_stock_constraint(self):
        self.c["models"]["ProductCreate"]["quantity"]["constraints"]["minimum"]=-1
        with self.assertRaises(ContractError):generate_inventory(self.c)
    def test_cannot_silently_change_security(self):
        self.c["operations"]["registerSale"]["capability"]="sales.read"
        with self.assertRaises(ContractError):generate_inventory(self.c)
    def test_cannot_attach_unsupported_model(self):
        self.c["models"]["Price"]={"amount":{"type":"number","required":True}}
        with self.assertRaises(ContractError):generate_inventory(self.c)
