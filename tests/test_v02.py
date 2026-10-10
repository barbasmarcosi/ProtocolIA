"""P1 end-to-end grammar/runtime and migration tests, provider-free."""
from __future__ import annotations
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from protocolia import ContractError, validate, compile_contract, compare_contracts, write_artifacts, validate_payload, validate_path_params, migrate_contract

ROOT=Path(__file__).resolve().parents[1]
SAMPLE=json.loads((ROOT/'examples/sales-v0.2.json').read_text())
OLD=json.loads((ROOT/'examples/sales.json').read_text())
VALID_UUID='550e8400-e29b-41d4-a716-446655440000'

class V02Tests(unittest.TestCase):
    def setUp(self):
        self.c=copy.deepcopy(SAMPLE)
        self.value={'product_id':VALID_UUID,'quantity':1,'sku':'SKU_20'}

    def test_v01_golden_untouched(self):
        fixtures=ROOT/'tests/fixtures/v0.1-sales-hashes.json'
        if fixtures.exists():
            hashes=json.loads(fixtures.read_text())
            artifacts=compile_contract(OLD)
            self.assertEqual(hashes,{k:hashlib.sha256(v.encode()).hexdigest() for k,v in artifacts.items()})

    def test_compiles_schema_artifacts_with_openapi_path_binding(self):
        artifacts=compile_contract(self.c)
        ir=json.loads(artifacts['ir.json'])
        self.assertEqual(ir['version'],'0.2')
        api=json.loads(artifacts['openapi.json'])
        params=api['paths']['/sales/{sale_id}']['get']['parameters']
        self.assertEqual(params[0],{'name':'sale_id','in':'path','required':True,'schema':{'type':'string','format':'uuid'}})
        self.assertEqual(api['components']['schemas']['SaleRequest']['properties']['quantity']['minimum'],1)
        compiled_schema=json.loads(artifacts['payload.schema.json'])
        Draft202012Validator.check_schema(compiled_schema)
        Draft202012Validator.check_schema(json.loads((ROOT/'schemas/contract-v0.2.schema.json').read_text()))
        self.assertNotIn('#/components/schemas/', artifacts['payload.schema.json'])
        self.assertIn('"compiler": "protocolia/0.2"',artifacts['manifest.json'])
        self.assertTrue(validate_payload(self.c,'SaleRequest',self.value))
        self.assertTrue(Draft202012Validator(compiled_schema['$defs']['SaleRequest'],resolver=None).is_valid(self.value))

    def test_byte_determinism_with_reordered_source(self):
        c=copy.deepcopy(self.c)
        c['operations']=dict(reversed(list(c['operations'].items())))
        c['models']=dict(reversed(list(c['models'].items())))
        self.assertEqual(compile_contract(self.c),compile_contract(c))

    def test_minimum_maximum_and_string_restrictions(self):
        for quantity in (0,1001,True,1.5,'1',None):
            with self.subTest(quantity=quantity):
                c=dict(self.value,quantity=quantity)
                self.assertFalse(validate_payload(self.c,'SaleRequest',c))
        for sku in ('', 'space invalid', 'X'*41, None):
            with self.subTest(sku=sku):
                self.assertFalse(validate_payload(self.c,'SaleRequest',dict(self.value,sku=sku)))
        self.assertTrue(validate_payload(self.c,'SaleRequest',dict(self.value,quantity=1000)))

    def test_enum_null_and_unknown_properties(self):
        for state,expected in [('pending',True),('completed',True),('invalid',False),(None,False),(1,False)]:
            self.assertEqual(validate_payload(self.c,'SaleRequest',dict(self.value,sale_state=state)),expected)
        self.assertFalse(validate_payload(self.c,'SaleRequest',dict(self.value,secret='test')))
        self.assertFalse(validate_payload(self.c,'SaleRequest',{'quantity':1}))

    def test_path_params_exact_bindings(self):
        self.assertTrue(validate_path_params(self.c,'readSale',{'sale_id':VALID_UUID}))
        for bad in ({'id':VALID_UUID},{'sale_id':1},{'sale_id':'not-uuid'},{}):
            self.assertFalse(validate_path_params(self.c,'readSale',bad))
        for invalid in ['/sales/{bad}', '/sales/{sale_id}/{sale_id}','/sales/{sale_id}/extra/{missing}']:
            x=copy.deepcopy(self.c);x['operations']['readSale']['path']=invalid
            with self.subTest(path=invalid),self.assertRaises(ContractError):validate(x)

    def test_overlapping_routes_rejected(self):
        self.c['operations']['other']={'method':'GET','path':'/sales/specific','params':{},'response':'SaleResponse','capability':'sales.read','effects':['read'],'depends_on':[]}
        with self.assertRaises(ContractError):validate(self.c)

    def test_rejects_unknown_constraints_and_invalid_combinations(self):
        candidates=[{'nonsense':42},{'minimum':True},{'minimum':5,'maximum':2},{'enum':[1,True]}, {'enum':[1,1]}, {'pattern':'(a+)+$'}, {'minLength':-1}]
        for limits in candidates:
            with self.subTest(limits=limits):
                x=copy.deepcopy(self.c)
                x['models']['SaleRequest']['quantity']['constraints']=limits
                with self.assertRaises(ContractError):validate(x)
        x=copy.deepcopy(self.c);x['models']['SaleRequest']['sku']['constraints']={'pattern':'^(a+)+$'}
        with self.assertRaises(ContractError):validate(x)
        x=copy.deepcopy(self.c);x['models']['SaleRequest']['sku']['constraints']={'enum':['valid',False]}
        with self.assertRaises(ContractError):validate(x)

    def test_rejects_invalid_null_or_duplicate_pseudotypes(self):
        x=copy.deepcopy(self.c);x['models']['SaleRequest']['quantity']['type']=123
        with self.assertRaises(ContractError):validate(x)
        x=copy.deepcopy(self.c);x['operations']['readSale']['params']={'sale_id':'boolean'}
        with self.assertRaises(ContractError):validate(x)

    def test_runtime_parity_external_json_schema(self):
        a=compile_contract(self.c)
        schema=json.loads(a['payload.schema.json'])
        validator=Draft202012Validator(schema['$defs']['SaleRequest'],format_checker=FormatChecker())
        for input_ in [self.value,dict(self.value,quantity=0),dict(self.value,quantity=1001),dict(self.value,sku='!!!'),dict(self.value,sale_state='wrong'),dict(self.value,quantity=True),dict(self.value,quantity=1.25),dict(self.value,quantity=None)]:
            self.assertEqual(validate_payload(self.c,'SaleRequest',input_),validator.is_valid(input_),input_)

    def test_migrate_is_explicit_lossless_and_new_manifest_is_isolated(self):
        migrated=migrate_contract(OLD)
        self.assertEqual(migrated['version'],'0.2')
        self.assertEqual(migrated['models'],OLD['models'])
        self.assertTrue(all(op['params']=={} for op in migrated['operations'].values()))
        self.assertEqual(validate(migrated)['execution_order'],validate(OLD)['execution_order'])
        with self.assertRaises(ContractError):compare_contracts(OLD,migrated)
        with self.assertRaises(ContractError):migrate_contract(migrated)
        with tempfile.TemporaryDirectory() as d:
            write_artifacts(compile_contract(OLD),Path(d))
            with self.assertRaises(ContractError):write_artifacts(compile_contract(migrated),Path(d))
            # Manually choose an isolated output directory for new spec.
            write_artifacts(compile_contract(migrated),Path(d)/'v02')
            write_artifacts(compile_contract(migrated),Path(d)/'v02')

    def test_v02_diff_breaking_and_additive(self):
        c=copy.deepcopy(self.c)
        c['models']['SaleRequest']['note']={'type':'string','required':False}
        self.assertTrue(compare_contracts(self.c,c)['compatible'])
        c=copy.deepcopy(self.c);c['models']['SaleRequest']['quantity']['constraints']['minimum']=2
        self.assertFalse(compare_contracts(self.c,c)['compatible'])
        c=copy.deepcopy(self.c);c['operations']['readSale']['params']['sale_id']='string'
        self.assertFalse(compare_contracts(self.c,c)['compatible'])

    def test_preview_is_pure_and_guards_modified_artifacts(self):
        from protocolia import preview_artifacts
        artifacts=compile_contract(self.c)
        with tempfile.TemporaryDirectory() as d:
            dest=Path(d)/'generated'
            p=preview_artifacts(artifacts,dest)
            self.assertEqual(p['changed'],5)
            self.assertFalse(dest.exists())
            write_artifacts(artifacts,dest)
            self.assertEqual(preview_artifacts(artifacts,dest)['changed'],0)
            altered=copy.deepcopy(self.c)
            altered['models']['SaleRequest']['quantity']['constraints']['maximum']=2000
            self.assertGreater(preview_artifacts(compile_contract(altered),dest)['changed'],0)
            (dest/'types.ts').write_text('tampered')
            with self.assertRaises(ContractError):preview_artifacts(artifacts,dest)
            with self.assertRaises(ContractError):write_artifacts(artifacts,dest)

    def test_nested_arrays_with_bounded_strings_match_generated_json_schema(self):
        c=copy.deepcopy(self.c)
        c['models']['Basket']={'names':{'type':'string[]','required':True},'sale':{'type':'SaleRequest','required':True}}
        art=compile_contract(c)
        full=json.loads(art['payload.schema.json'])
        full['$ref']='#/$defs/Basket'
        validator=Draft202012Validator(full,format_checker=FormatChecker())
        for item in ({'names':['ok'],'sale':self.value},
                     {'names':['a'*4100],'sale':self.value},
                     {'names':[4],'sale':self.value},
                     {'names':[],'sale':self.value}):
            self.assertEqual(validate_payload(c,'Basket',item),validator.is_valid(item))

    def test_cli_migration_outputs_structured_contract_without_writing(self):
        with tempfile.TemporaryDirectory() as d:
            src=Path(d)/'old.json';src.write_text(json.dumps(OLD))
            cli=subprocess.run([sys.executable,'-m','protocolia','migrate',str(src)],capture_output=True,text=True,check=False)
            self.assertEqual(cli.returncode,0,cli.stderr)
            self.assertEqual(json.loads(cli.stdout)['version'],'0.2')

if __name__=='__main__':unittest.main()
