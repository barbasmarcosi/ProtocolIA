"""Conservative ProtocolIA wire-contract comparison (not runtime equivalence)."""
from __future__ import annotations
from typing import Any
from .core import _json, _sha, validate, ContractError

def compare_contracts(before:Any,after:Any)->dict[str,Any]:
    old,new=validate(before),validate(after)
    if old['version']!=new['version']:
        raise ContractError('cross-version diff requires explicit migration of both contracts to same version')
    changes=[]
    def record(kind:str,path:str,severity:str)->None:
        changes.append({'kind':kind,'path':path,'severity':severity})
    if old['namespace']!=new['namespace']:
        record('namespace_changed','namespace','breaking')
    for model in sorted(old['models'].keys()|new['models'].keys()):
        where=f'models.{model}'
        if model not in new['models']:
            record('model_removed',where,'breaking')
        elif model not in old['models']:
            record('model_added',where,'additive')
        else:
            a,b=old['models'][model],new['models'][model]
            for field in sorted(a.keys()|b.keys()):
                location=f'{where}.{field}'
                if field not in b:
                    record('field_removed',location,'breaking')
                elif field not in a:
                    kind='required_field_added' if b[field]['required'] else 'optional_field_added'
                    record(kind,location,'breaking' if b[field]['required'] else 'additive')
                elif a[field]!=b[field]:
                    record('field_type_or_required_changed',location,'breaking')
    for name in sorted(old['operations'].keys()|new['operations'].keys()):
        where=f'operations.{name}'
        if name not in new['operations']:
            record('operation_removed',where,'breaking')
        elif name not in old['operations']:
            record('operation_added',where,'additive')
        else:
            a,b=old['operations'][name],new['operations'][name]
            for key in sorted(a.keys()|b.keys()):
                x,y=a.get(key),b.get(key)
                if key in {'depends_on','effects'}:
                    x=sorted(x) if x is not None else x
                    y=sorted(y) if y is not None else y
                if x!=y:
                    record('operation_contract_changed',f'{where}.{key}','breaking')
    changes.sort(key=lambda x:(x['path'],x['kind'],x['severity']))
    breaking=sum(v['severity']=='breaking' for v in changes)
    return {'version':old['version'],'old_ir_sha256':_sha(_json(old)),'new_ir_sha256':_sha(_json(new)),
            'compatible':breaking==0,'breaking':breaking,'additive':len(changes)-breaking,'changes':changes,
            'scope':'conservative syntactic compatibility, not behavioral equivalence'}
