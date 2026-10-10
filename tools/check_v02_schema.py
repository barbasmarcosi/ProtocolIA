"""Independent v0.2 grammar and generated payload schema conformance smoke.

This is an external validator with *test-only* jsonschema, not a compiler dependency.
"""
import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from protocolia import ContractError, validate, compile_contract, validate_payload
ROOT=Path(__file__).resolve().parents[1]
contract=json.loads((ROOT/'examples/sales-v0.2.json').read_text())
shape=json.loads((ROOT/'schemas/contract-v0.2.schema.json').read_text())
Draft202012Validator.check_schema(shape)
validator=Draft202012Validator(shape)
assert validator.is_valid(contract)
assert validate(contract)['version']=='0.2'
valid_payload={'product_id':'550e8400-e29b-41d4-a716-446655440000','quantity':5,'sku':'ITEM-1'}
artifacts=compile_contract(contract)
payload_schema=json.loads(artifacts['payload.schema.json'])
Draft202012Validator.check_schema(payload_schema)
payload_schema['$ref']='#/$defs/SaleRequest'
payload_validator=Draft202012Validator(payload_schema,format_checker=FormatChecker())
for q in [valid_payload,dict(valid_payload,quantity=0),dict(valid_payload,quantity=1001),dict(valid_payload,sku='x y'),dict(valid_payload,sale_state='bad'),dict(valid_payload,quantity=True),dict(valid_payload,quantity=None)]:
    assert payload_validator.is_valid(q)==validate_payload(contract,'SaleRequest',q),q
invalid=copy.deepcopy(contract);invalid['version']='0.3';assert not validator.is_valid(invalid)
invalid=copy.deepcopy(contract);invalid['operations']['readSale']['params']={};assert validator.is_valid(invalid)
try:validate(invalid)
except ContractError:pass
else:raise AssertionError('missing route binding accepted')
invalid=copy.deepcopy(contract);invalid['models']['SaleRequest']['quantity']['constraints']={'minimum':True}
assert not validator.is_valid(invalid)
print('V0.2 SCHEMA + RUNTIME CONFORMANCE: PASS (7 payloads and negative shape/semantic cases)')
