// S1a: fail-closed subject ownership for single-entity create/get/listPage.
// No arbitrary predicates, interpolation of credentials, bypass capabilities or joins.
const ident=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x);
const snake=x=>x.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
export function compileOwnerScopes(ir){
  const result=new Map(),entities=new Map(ir.entities.map(e=>[e.name,e]));
  for(const entity of ir.entities){
    const owners=entity.fields.filter(f=>f.ownerManaged);
    if(!owners.length)continue;
    const field=owners[0],operations=ir.operations.filter(o=>o.entity===entity.name);
    const counts=kind=>operations.filter(o=>o.behavior.kind===kind).length;
    const related=ir.entities.some(other=>other.fields.some(f=>
      f.reference?.target===entity.name||other.name===entity.name&&f.reference));
    if(owners.length!==1||!ident(entity.name)||!ident(entity.publicIdentity)||
      !ident(field.name)||!field.required||field.nullable||field.unique||
      field.type!=="string"||field.reference||field.choices||field.initial!==undefined||
      field.computedSum||field.computedProduct||field.computedRoundedProduct||
      field.computedDiscountedTotal||field.requiredWhen||field.forbidWhen||
      (field.minLength??0)>1||(field.maxLength??255)<128||
      operations.length!==3||["create","get","listPage"].some(k=>counts(k)!==1)||
      operations.some(o=>o.capability==="public"||!o.capability||
        o.behavior.reserve||o.behavior.release||o.behavior.debitExact||o.behavior.reverseExact||
        o.behavior.reconcileExact||o.behavior.relatedSum||o.behavior.audit)||
      related)
      throw Error("Invalid S1a owner scope "+entity.name);
    const create=operations.find(o=>o.behavior.kind==="create"),get=operations.find(o=>o.behavior.kind==="get");
    const listing=operations.find(o=>o.behavior.kind==="listPage");
    if(create.method!=="POST"||get.method!=="GET"||listing.method!=="GET"||
      create.capability===get.capability||get.capability!==listing.capability||
      ![201,400,401,403,409].every(s=>create.statuses.includes(s))||
      ![200,401,403,404].every(s=>get.statuses.includes(s))||
      ![200,400,401,403].every(s=>listing.statuses.includes(s)))
      throw Error("Invalid S1a owner capability/status "+entity.name);
    result.set(entity.name,{field:field.name,column:snake(field.name)});
  }
  return result;
}
