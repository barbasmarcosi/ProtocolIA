"""ProtocolIA v0.2: bounded declarative data constraints and safe path bindings.

No arbitrary predicate evaluation, SQL, regex engines on untrusted patterns, or
runtime authorization is performed. v0.1 stays byte-for-byte compatible.
"""
from __future__ import annotations

import copy
from datetime import datetime
import json
import math
import re
from typing import Any
from uuid import UUID

UUID_CANON = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
RFC3339_DATE_TIME = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$')

from . import core

# Entirely bounded pattern language: anchored ASCII character classes with '+' or
# bounded repetition. No alternation, lookarounds, groups or nested quantifiers.
SAFE_PATTERN = re.compile(r'^\^\[[A-Za-z0-9_\\\-]{1,48}\](?:\+|\{[0-9]{1,3}(?:,[0-9]{1,3})?\})\$$')
PARAM = re.compile(r'\{([A-Za-z][A-Za-z0-9_]*)\}')
CONSTRAINTS = {'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'enum'}


def _check_type(value: Any, primitive: str) -> bool:
    if primitive == 'string':
        return type(value) is str
    if primitive == 'integer':
        return type(value) is int
    if primitive == 'number':
        return type(value) is int or (type(value) is float and math.isfinite(value))
    if primitive == 'boolean':
        return type(value) is bool
    if primitive in {'uuid', 'datetime'}:
        if type(value) is not str:
            return False
        try:
            if primitive == 'uuid':
                if not UUID_CANON.fullmatch(value):
                    return False
                UUID(value)
            else:
                if not RFC3339_DATE_TIME.fullmatch(value):
                    return False
                datetime.fromisoformat(value.replace('Z', '+00:00'))
            return True
        except (ValueError, OverflowError):
            return False
    return False


def _check_constraints(spec: dict[str, Any], where: str) -> None:
    if 'constraints' not in spec:
        return
    limits = spec['constraints']
    if not isinstance(limits, dict) or not limits or set(limits) - CONSTRAINTS:
        core._fail(f'{where}: unknown or empty constraints')
    if not isinstance(spec['type'], str):
        core._fail(f'{where}: invalid type')
    base, array = spec['type'].removesuffix('[]'), spec['type'].endswith('[]')
    if array or base not in core.PRIMITIVES:
        core._fail(f'{where}: constraints require scalar primitive field')
    for key, value in limits.items():
        if key in {'minimum', 'maximum'}:
            if base not in {'integer', 'number'} or not _check_type(value, base):
                core._fail(f'{where}.{key}: invalid numeric bound')
        elif key in {'minLength', 'maxLength'}:
            if base != 'string' or type(value) is not int or value < 0 or value > 4096:
                core._fail(f'{where}.{key}: string length must be 0..4096')
        elif key == 'pattern':
            if base != 'string' or not isinstance(value, str) or len(value) > 120 or not SAFE_PATTERN.fullmatch(value):
                core._fail(f'{where}.pattern: unsupported regex, only bounded safe ASCII class syntax')
            try:
                compiled = re.compile(value)
            except re.error:
                core._fail(f'{where}.pattern: malformed pattern')
            # '+' is bounded at validation by a global 4096 character cap.
            if value.endswith('}'):
                numbers = [int(x) for x in value.rsplit('{', 1)[1][:-2].split(',')]
                if any(n > 4096 for n in numbers) or len(numbers) == 2 and numbers[0] > numbers[1]:
                    core._fail(f'{where}.pattern: invalid repetition bounds')
        elif key == 'enum':
            if not isinstance(value, list) or not value or len(value) > 128 or any(not _check_type(v, base) for v in value):
                core._fail(f'{where}.enum: nonempty <=128 scalar items required')
            if any(type(a) in (int, float) and type(b) in (int, float) and a == b or
                   type(a) is type(b) and a == b
                   for i,a in enumerate(value) for b in value[:i]):
                core._fail(f'{where}.enum: duplicate values')
    if 'minimum' in limits and 'maximum' in limits and limits['minimum'] > limits['maximum']:
        core._fail(f'{where}: minimum exceeds maximum')
    if 'minLength' in limits and 'maxLength' in limits and limits['minLength'] > limits['maxLength']:
        core._fail(f'{where}: minLength exceeds maxLength')
    if 'enum' in limits:
        for value in limits['enum']:
            if not _value_matches(value, base, limits):
                core._fail(f'{where}: enum value violates bounds or pattern')


def _value_matches(value: Any, base: str, limits: dict[str, Any]) -> bool:
    if not _check_type(value, base):
        return False
    if base == 'string':
        if len(value) > 4096:
            return False
        if 'minLength' in limits and len(value) < limits['minLength']:
            return False
        if 'maxLength' in limits and len(value) > limits['maxLength']:
            return False
        if 'pattern' in limits and re.fullmatch(limits['pattern'], value, flags=re.ASCII) is None:
            return False
    if 'minimum' in limits and value < limits['minimum']:
        return False
    if 'maximum' in limits and value > limits['maximum']:
        return False
    if 'enum' in limits and not any((type(value) is type(v) and value == v) or
        (type(value) in (int, float) and type(v) in (int, float) and value == v) for v in limits['enum']):
        return False
    return True


def _conflicts(a: str, b: str) -> bool:
    aa, bb = a.split('/')[1:], b.split('/')[1:]
    return len(aa) == len(bb) and all(x == y or x.startswith('{') or y.startswith('{') for x, y in zip(aa, bb))


def validate(contract: Any) -> dict[str, Any]:
    core._keys(contract, {'version', 'namespace', 'models', 'operations'}, set(), 'contract')
    if contract['version'] != '0.2':
        core._fail('only v0.2 accepted by v0.2 validator')
    models, ops = contract['models'], contract['operations']
    if not isinstance(models, dict) or not isinstance(ops, dict):
        core._fail('models and operations must be objects')
    projected = {'version': '0.1', 'namespace': contract['namespace'], 'models': {}, 'operations': {}}
    for model, fields in models.items():
        if not isinstance(fields, dict):
            core._fail(f'{model}: expected fields object')
        projected['models'][model] = {}
        for field, spec in fields.items():
            core._keys(spec, {'type', 'required'}, {'constraints'}, f'{model}.{field}')
            _check_constraints(spec, f'{model}.{field}')
            projected['models'][model][field] = {'type': spec['type'], 'required': spec['required']}
    route_pairs: list[tuple[str, str]] = []
    for name, op in ops.items():
        core._keys(op, {'method', 'path', 'response', 'capability', 'effects', 'depends_on', 'params'}, {'request'}, name)
        if not isinstance(op['path'], str) or not core.ROUTE.fullmatch(op['path']):
            core._fail(f'{name}.path: malformed route')
        tokens = PARAM.findall(op['path'])
        params = op['params']
        if not isinstance(params, dict) or len(tokens) != len(set(tokens)) or set(tokens) != set(params):
            core._fail(f'{name}: path placeholders must match unique params exactly')
        for key, kind in params.items():
            core._name(key, f'{name}.params')
            if type(kind) is not str or kind not in {'string', 'integer', 'uuid'}:
                core._fail(f'{name}.{key}: unsupported path parameter type')
        for method, path in route_pairs:
            if method == op['method'] and _conflicts(path, op['path']):
                core._fail(f'{name}: overlapping method/path templates')
        route_pairs.append((op['method'], op['path']))
        safe = dict(op)
        safe.pop('params')
        safe['path'] = PARAM.sub(lambda m: 'param_' + m.group(1), op['path'])
        projected['operations'][name] = safe
    validated = core.validate(projected)
    validated['version'] = '0.2'
    validated['models'] = {m: {f: dict(models[m][f]) for f in sorted(models[m])} for m in sorted(models)}
    validated['operations'] = {n: {k: ops[n][k] for k in sorted(ops[n])} for n in sorted(ops)}
    return validated


def _wire_schema(type_name: str, models: dict[str, Any], constraints: dict[str, Any] | None = None, ref_prefix: str = '#/components/schemas/') -> dict[str, Any]:
    base, array = core._parse_type(type_name, models, 'type')
    primitive = ({'type':'string','format': 'uuid'} if base == 'uuid' else
                 {'type':'string','format':'date-time'} if base == 'datetime' else
                 {'type':base})
    result = {'$ref': ref_prefix + base} if base in models else primitive
    # Bounded string policy: emitted schema and executable validator agree.
    if base == 'string':
        result['maxLength'] = 4096
    if array:
        result = {'type': 'array', 'items': result}
    if constraints:
        result = {**result, **constraints}
        if 'pattern' in constraints:
            # ECMA/Python '$' may match before a final newline; force true EOF.
            result['pattern'] = constraints['pattern'] + r'(?![\s\S])'
    return result


def compile_contract(contract: Any) -> dict[str, str]:
    ir = validate(contract)
    projected = {'version': '0.1', 'namespace': ir['namespace'], 'models': {}, 'operations': {}}
    for m, fields in ir['models'].items():
        projected['models'][m] = {f: {'type': spec['type'], 'required': spec['required']} for f,spec in fields.items()}
    for n,op in ir['operations'].items():
        clean = {k:v for k,v in op.items() if k!='params'}
        clean['path'] = PARAM.sub(lambda match:'param_'+match.group(1), op['path'])
        projected['operations'][n]=clean
    inherited = core.compile_contract(projected)
    api = json.loads(inherited['openapi.json'])
    schemas = api['components']['schemas']
    for m,fields in ir['models'].items():
        for f,spec in fields.items():
            schemas[m]['properties'][f] = _wire_schema(spec['type'], ir['models'], spec.get('constraints'))
    for n,op in ir['operations'].items():
        fake = projected['operations'][n]['path']
        endpoint = api['paths'][fake].pop(op['method'].lower())
        if not api['paths'][fake]:
            del api['paths'][fake]
        if op['params']:
            endpoint['parameters'] = [{'name': k,'in':'path','required':True,
                                       'schema':_wire_schema(t, ir['models'])}
                                      for k,t in sorted(op['params'].items())]
        api['paths'].setdefault(op['path'],{})[op['method'].lower()]=endpoint
    api['paths'] = {k:api['paths'][k] for k in sorted(api['paths'])}
    api['info']['version']='0.2'
    json_models = copy.deepcopy(schemas)
    def alter_refs(s:Any)->None:
        if isinstance(s,dict):
            if '$ref' in s and s['$ref'].startswith('#/components/schemas/'):
                s['$ref']=s['$ref'].replace('#/components/schemas/','#/$defs/',1)
            for value in s.values():alter_refs(value)
        elif isinstance(s,list):
            for value in s:alter_refs(value)
    alter_refs(json_models)
    payload_schema={'$schema':'https://json-schema.org/draft/2020-12/schema', '$defs': json_models}
    ts = inherited['types.ts'].replace('v0.1', 'v0.2')
    artifacts={'ir.json':core._json(ir),'openapi.json':core._json(api),
               'types.ts':ts,'payload.schema.json':core._json(payload_schema)}
    artifacts['manifest.json']=core._json({'compiler':'protocolia/0.2','contract_sha256':core._sha(artifacts['ir.json']),
        'artifacts':{k:core._sha(v) for k,v in sorted(artifacts.items())}})
    return artifacts


def _value_validate(value: Any, type_name: str, models: dict[str, Any], limits: dict[str,Any], depth:int) -> bool:
    if depth > 24:
        return False
    base,array=core._parse_type(type_name,models,'payload type')
    if array:
        return isinstance(value,list) and len(value)<=10000 and all(
            _value_validate(v,base,models,{},depth+1) for v in value)
    if base in models:
        return _model_validate(value,base,models,depth+1)
    return _value_matches(value,base,limits)


def _model_validate(value:Any,model:str,models:dict[str,Any],depth:int)->bool:
    if depth>24 or not isinstance(value,dict):
        return False
    fields=models[model]
    if set(value)-set(fields) or any(spec['required'] and f not in value for f,spec in fields.items()):
        return False
    return all(_value_validate(value[f], fields[f]['type'],models,fields[f].get('constraints',{}),depth+1)
               for f in value)


def validate_payload(contract:Any, model:str, payload:Any)->bool:
    """Executable strict reference validator for supported v0.2 wire model payloads."""
    ir=validate(contract)
    if model not in ir['models']:
        core._fail(f'unknown model {model}')
    return _model_validate(payload,model,ir['models'],0)


def validate_path_params(contract:Any, operation:str, values:Any)->bool:
    ir=validate(contract)
    if operation not in ir['operations']:
        core._fail(f'unknown operation {operation}')
    defs=ir['operations'][operation]['params']
    return isinstance(values,dict) and set(values)==set(defs) and all(_check_type(values[k],v) and (not isinstance(values[k],str) or len(values[k])<=4096) for k,v in defs.items())


def migrate_contract(contract:Any)->dict[str,Any]:
    """Explicit, lossless v0.1->v0.2 grammar conversion. Never applies DB changes."""
    if not isinstance(contract,dict) or contract.get('version')!='0.1':
        core._fail('migration requires an explicit v0.1 input')
    core.validate(contract)
    result=copy.deepcopy(contract)
    result['version']='0.2'
    for op in result['operations'].values():
        op['params']={}
    validate(result)
    return result
