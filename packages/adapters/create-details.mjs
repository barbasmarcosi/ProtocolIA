/**
 * B12 bounded contract-derived parent + typed child collection.
 * Reject anything that might bypass a parent authorization boundary, mutate generated
 * child fields or create an unbounded batch.
 */
const ident=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x);
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
  // Auditing an independent child append is safe only when the parent FK is
  // recorded and the selected fields come from the declared, non-identity child.
  const childAudit=childCreate[0]?.behavior.audit;
  const invalidChildAudit=childAudit!==undefined&&(
    !Array.isArray(childAudit)||childAudit.length<1||childAudit.length>8||
    !childAudit.includes(meta?.parentField)||
    new Set(childAudit).size!==childAudit.length||
    childAudit.some(name=>!child?.fields.some(f=>f.name===name&&name!==child.publicIdentity))
  );
  const patches=ir.operations.filter(x=>x.entity===child?.name&&x.behavior.kind==="patchFields");
  const deletes=ir.operations.filter(x=>x.entity===child?.name&&x.behavior.kind==="delete");
  const unsafeDeletes=deletes.length>0&&(
    meta?.versioned!==true||deletes.length!==1||deletes.some(x=>
      x.method!=="DELETE"||![204,400,401,403,404,409].every(s=>x.statuses?.includes(s))||
      !x.behavior.audit?.includes(meta.parentField)||
      x.behavior.audit.some(name=>name===child.publicIdentity||
        !child.fields.some(f=>f.name===name))||
      x.behavior.audit.length>8||x.behavior.audit.length<1||
      new Set(x.behavior.audit).size!==x.behavior.audit.length||
      x.capability!==childCreate[0]?.capability
    )
  );
  // S2b-0: generic typed detail creation is not an authoritative money ledger.
  // The existing child-create route and parent scalar sources can bypass a financial
  // line-item total. Reject this combination until a reviewed, atomic itemized
  // contract binds the total and closes independent child mutations in BOTH targets.
  // Include unreconciled exact debit/reversal parents: removing the read endpoint
  // must never turn unsafe header/detail creation into an accepted financial plan.
  const exactLedgerParent=ir.operations.some(x=>
    x.entity===parent?.name&&x.behavior?.reconcileExact||
    x.behavior?.debitExact?.stockEntity===parent?.name||
    x.behavior?.reverseExact?.stockEntity===parent?.name);
  const itemized=meta?.chargeAmountField!==undefined||meta?.chargeTotalField!==undefined;
  const charge=child?.fields.find(f=>f.name===meta?.chargeAmountField);
  const total=parent?.fields.find(f=>f.name===meta?.chargeTotalField);
  const reconciliations=ir.operations.filter(x=>x.entity===parent?.name&&
    x.behavior.kind==="reconcileExact"&&x.behavior.reconcileExact);
  const cfg=reconciliations.length===1?reconciliations[0].behavior.reconcileExact:null;
  // An opt-in financial detail is a strict single-source ledger, not a
  // generic append/edit collection with a coincidental amount field.
  const validItemization=!itemized||(
    ident(meta.chargeAmountField)&&ident(meta.chargeTotalField)&&
    meta.versioned===undefined&&cfg?.serverOnly===true&&cfg.lifecycle===true&&
    (cfg.chargeSource===meta.chargeTotalField||
      cfg.chargeSources?.length===1&&cfg.chargeSources[0]===meta.chargeTotalField)&&
    !!charge&&charge.type==="decimal"&&charge.required&&!charge.nullable&&
    charge.decimal?.min==="0"&&!!total&&total.type==="decimal"&&
    total.required&&!total.nullable&&total.decimal?.min==="0"&&
    charge.decimal?.scale===total.decimal?.scale&&
    charge.decimal.precision<=total.decimal.precision&&
    meta.chargeAmountField!==meta.parentField&&
    child.publicIdentity!==meta.parentField&&
    !child.operations?.length&& // no custom child operation surface in entity metadata
    patches.length===0&&deletes.length===0&&
    ir.operations.every(x=>x.entity!==child.name||
      ["create","get","listPage","queryPage","auditPage","health"].includes(x.behavior.kind))&&
    !ir.operations.some(x=>x.entity===parent.name&&
      ["delete","patchTogether"].includes(x.behavior.kind))
  );
  const unsafePatches=patches.length>3||
    new Set(patches.map(x=>x.behavior.field)).size!==patches.length||
    new Set(patches.map(x=>x.capability)).size!==patches.length||
    patches.some(x=>x.behavior.audit?.length!==1);
  if(!parent||!meta||op.behavior.kind!=="create"||op.method!=="POST"||
    ![201,400,401,403,409].every(s=>op.statuses?.includes(s))||
    (exactLedgerParent&&!itemized)||!validItemization||!bounded||typeof rows!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(rows)||
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
    invalidChildAudit||(meta.versioned===true&&!childAudit)||
    (meta.versioned!==undefined&&meta.versioned!==true)||
    childCreate[0].behavior.reserve||
    childCreate[0].behavior.moveUnits||childCreate[0].behavior.moveBatch||
    childCreate[0].behavior.createDetails||childCreate[0].behavior.debitExact||
    ir.operations.some(x=>x.entity===parent.name&&x.behavior.kind==="create"&&x.behavior.moveBatch)||
    op.behavior.moveUnits||op.behavior.moveBatch||op.behavior.reserve||
    op.behavior.debitExact||op.behavior.reverseExact||op.behavior.reverseBatch||
    ir.operations.some(x=>x.entity===child.name&&
      !["create","get","listPage","queryPage","auditPage","patchFields","health",
        ...(meta.versioned?["delete"]:[])].includes(x.behavior.kind))||
    unsafeDeletes||
    (invalidPatch||unsafePatches))
    throw Error("Unsafe bounded relational header/detail contract");
  return {parent,child,relation,rowsField:rows,maxRows:20,fields:allowed,
    childWriteCapability:childCreate[0].capability,
    ...(itemized?{chargeAmountField:meta.chargeAmountField,
      chargeTotalField:meta.chargeTotalField}:{})};
}
