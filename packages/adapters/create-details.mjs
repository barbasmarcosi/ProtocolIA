/**
 * B12 bounded contract-derived parent + typed child collection.
 * Reject anything that might bypass a parent authorization boundary, mutate generated
 * child fields or create an unbounded batch.
 */
export function assertCreateDetails(ir,parent,op){
  const meta=op?.behavior?.createDetails;
  const child=ir.entities.find(e=>e.name===meta?.childEntity);
  const relation=child?.fields.find(f=>f.name===meta?.parentField);
  const childCreate=ir.operations.filter(x=>x.entity===child?.name&&x.behavior.kind==="create");
  const parentCreate=ir.operations.filter(x=>x.entity===parent?.name&&x.behavior.kind==="create");
  const bounded=Number.isInteger(meta?.maxRows)&&meta.maxRows===20;
  const rows=meta?.rowsField;
  const allowed=child?.fields.filter(f=>f.name!==meta?.parentField)??[];
  const invalidPatch=ir.operations.some(x=>{
    if(x.entity!==child?.name||x.behavior.kind!=="patchFields")return false;
    const field=child.fields.find(f=>f.name===x.behavior.field);
    return !field||field.name===child.publicIdentity||field.name===meta.parentField||
      !["string","int32"].includes(field.type)||
      (field.type==="int32"&&((field.min??0)<1||(field.max??2147483647)>1000000000))||
      !field.required||field.nullable||field.reference||
      field.initial!==undefined||field.ownerManaged||field.computedSum||
      field.computedProduct||field.computedRoundedProduct||field.computedDiscountedTotal||
      x.behavior.input!==field.name||x.behavior.audit?.length!==1||
      x.behavior.audit[0]!==field.name||
      !x.capability||x.capability==="public"||
      x.capability===ir.operations.find(y=>y.entity===child.name&&y.behavior.kind==="get")?.capability;
  });
  const patches=ir.operations.filter(x=>x.entity===child?.name&&x.behavior.kind==="patchFields");
  const unsafePatches=patches.length>3||
    new Set(patches.map(x=>x.behavior.field)).size!==patches.length||
    new Set(patches.map(x=>x.capability)).size!==patches.length||
    patches.some(x=>x.behavior.audit?.length!==1);
  if(!parent||!meta||op.behavior.kind!=="create"||op.method!=="POST"||
    ![201,400,401,403,409].every(s=>op.statuses?.includes(s))||
    !bounded||typeof rows!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(rows)||
    parent.fields.some(f=>f.name===rows)||!child||child===parent||
    child.fields.some(f=>f.ownerManaged||f.initial!==undefined||f.readCapability)||
    parent.fields.some(f=>f.ownerManaged)||
    !relation||relation.type!=="string"||!relation.required||relation.nullable||
    relation.reference?.target!==parent.name||relation.reference?.onDelete!=="restrict"||
    child.fields.some(f=>f.reference&&f.name!==meta.parentField)||
    !allowed.length||allowed.some(f=>f.type!=="string"&&f.type!=="int32"&&f.type!=="decimal"&&f.type!=="utcDateTime")||
    childCreate.length!==1||parentCreate.length!==1||parentCreate[0].name!==op.name||
    !childCreate[0].capability||childCreate[0].capability==="public"||
    !op.capability||op.capability==="public"||
    childCreate[0].behavior.audit||childCreate[0].behavior.reserve||
    childCreate[0].behavior.moveUnits||childCreate[0].behavior.moveBatch||
    childCreate[0].behavior.createDetails||childCreate[0].behavior.debitExact||
    ir.operations.some(x=>x.entity===parent.name&&x.behavior.kind==="create"&&x.behavior.moveBatch)||
    op.behavior.moveUnits||op.behavior.moveBatch||op.behavior.reserve||
    op.behavior.debitExact||op.behavior.reverseExact||op.behavior.reverseBatch||
    ir.operations.some(x=>x.entity===child.name&&
      !["create","get","listPage","queryPage","auditPage","patchFields","health"].includes(x.behavior.kind))||
    (invalidPatch||unsafePatches))
    throw Error("Unsafe bounded relational header/detail contract");
  return {parent,child,relation,rowsField:rows,maxRows:20,fields:allowed,
    childWriteCapability:childCreate[0].capability};
}
