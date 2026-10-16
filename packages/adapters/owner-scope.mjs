// S1a: fail-closed subject ownership for single-entity create/get/listPage.
// No arbitrary predicates, interpolation of credentials, bypass capabilities or joins.
const ident=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x);
const snake=x=>x.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
export function compileOwnerScopes(ir){
  const result=new Map(),entities=new Map(ir.entities.map(e=>[e.name,e]));
  // Check all FK edges, including edges starting from unprotected entities.
  for(const entity of ir.entities){
    const refs=entity.fields.filter(f=>f.reference);
    for(const f of refs){
      const parent=entities.get(f.reference.target);
      const owner=entity.fields.find(x=>x.ownerManaged);
      const parentOwner=parent?.fields.find(x=>x.ownerManaged);
      if(!owner&&!parentOwner)continue;
      const read=ir.operations.find(o=>o.entity===parent?.name&&o.behavior.kind==="get");
      if(!owner||!parentOwner||refs.length!==1||!parent||parent===entity||
        parent.fields.some(x=>x.reference)||!ident(f.name)||f.type!=="string"||
        !f.required||f.nullable||f.unique||f.initial!==undefined||
        f.reference.onDelete!=="restrict"||f.name===entity.publicIdentity||
        !ident(parent.name)||!ident(parent.publicIdentity)||!ident(parentOwner.name)||
        !read||read.method!=="GET"||!read.capability||read.capability==="public")
        throw Error("Invalid S1d owner relation "+entity.name+"."+f.name);
    }
  }
  for(const entity of ir.entities){
    const owners=entity.fields.filter(f=>f.ownerManaged);
    if(!owners.length){
      if(entity.fields.some(f=>f.readCapability!==undefined))throw Error("Field read capability requires owner identity");
      continue;
    }
    const field=owners[0],operations=ir.operations.filter(o=>o.entity===entity.name&&o.behavior.kind!=="health");
    const guarded=entity.fields.filter(f=>f.readCapability!==undefined),caps=new Set(operations.map(o=>o.capability));
    if(guarded.length>2||new Set(guarded.map(f=>f.readCapability)).size!==guarded.length||
      guarded.some(f=>!ident(f.name)||f.name===entity.publicIdentity||f.ownerManaged||
        f.type!=="string"||f.required||f.nullable||f.unique||f.reference||f.choices||
        f.initial!==undefined||f.computedSum||f.computedProduct||f.computedRoundedProduct||
        f.computedDiscountedTotal||f.requiredWhen||f.forbidWhen||f.afterField||f.greaterThanField||
        typeof f.readCapability!=="string"||f.readCapability==="public"||
        !/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(f.readCapability)||
        caps.has(f.readCapability)||operations.some(o=>o.behavior.field===f.name)))
      throw Error("Invalid S1c field read scope "+entity.name);
    const counts=kind=>operations.filter(o=>o.behavior.kind===kind).length;
    const ownRefs=entity.fields.filter(f=>f.reference);
    const relation=ownRefs.length?(()=>{
      const f=ownRefs[0],parent=entities.get(f.reference.target);
      if(!parent)throw Error("Invalid S1d relation parent");
      const owner=parent.fields.find(x=>x.ownerManaged);
      const read=ir.operations.find(o=>o.entity===parent.name&&o.behavior.kind==="get");
      if(!owner||!read)throw Error("Invalid S1d relation owner/read");
      return {field:f.name,parentTable:snake(parent.name),parentKey:snake(parent.publicIdentity),
        parentOwnerColumn:snake(owner.name),parentReadCapability:read.capability};
    })():undefined;
    if(owners.length!==1||!ident(entity.name)||!ident(entity.publicIdentity)||
      !ident(field.name)||!field.required||field.nullable||field.unique||
      field.type!=="string"||field.reference||field.choices||field.initial!==undefined||
      field.computedSum||field.computedProduct||field.computedRoundedProduct||
      field.computedDiscountedTotal||field.requiredWhen||field.forbidWhen||
      (field.minLength??0)>1||(field.maxLength??255)<128||
      !([3,4].includes(operations.length))||["create","get","listPage"].some(k=>counts(k)!==1)||
      counts("patchFields")>1||
      operations.some(o=>!["create","get","listPage","patchFields"].includes(o.behavior.kind)||
        o.capability==="public"||!o.capability||
        o.behavior.reserve||o.behavior.release||o.behavior.debitExact||o.behavior.reverseExact||
        o.behavior.reconcileExact||o.behavior.relatedSum||o.behavior.audit)||
      ownRefs.length>1)
      throw Error("Invalid S1a owner scope "+entity.name);
    const create=operations.find(o=>o.behavior.kind==="create"),get=operations.find(o=>o.behavior.kind==="get");
    const listing=operations.find(o=>o.behavior.kind==="listPage");
    if(create.method!=="POST"||get.method!=="GET"||listing.method!=="GET"||
      create.capability===get.capability||get.capability!==listing.capability||
      ![201,400,401,403,409].every(s=>create.statuses.includes(s))||
      ![200,401,403,404].every(s=>get.statuses.includes(s))||
      ![200,400,401,403].every(s=>listing.statuses.includes(s)))
      throw Error("Invalid S1a owner capability/status "+entity.name);
    const patch=operations.find(o=>o.behavior.kind==="patchFields");
    if(patch){
      const target=entity.fields.find(f=>f.name===patch.behavior.field);
      if(patch.method!=="PATCH"||patch.capability==="public"||
        patch.capability===create.capability||patch.capability===get.capability||
        !target||target.name===field.name||target.name===entity.publicIdentity||
        target.type!=="string"||!target.required||target.nullable||target.reference||
        target.initial!==undefined||target.choices||target.pattern||
        target.computedSum||target.computedProduct||target.computedRoundedProduct||
        target.computedDiscountedTotal||target.requiredWhen||target.forbidWhen||
        patch.behavior.input!==target.name||patch.behavior.audit||
        ![200,400,401,403,404].every(code=>patch.statuses.includes(code)))
        throw Error("Invalid S1b owner field patch "+entity.name);
    }
    result.set(entity.name,{field:field.name,column:snake(field.name),...(relation?{relation}:{})});
  }
  return result;
}
