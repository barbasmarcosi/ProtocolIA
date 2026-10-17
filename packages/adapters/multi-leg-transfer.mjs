/**
 * B10 finite declarative atomic transfer batch, independent of one example domain.
 * Parents lock by public identity; settlement uses NET deltas per participating parent,
 * so a parent may receive and dispatch within the same indivisible batch.
 */
export function assertMoveBatch(ir,entity,op){
  const b=op?.behavior,rule=b?.moveBatch,legs=rule?.legs;
  if(b?.kind!=="create"||!rule||op.method!=="POST"||
      ![201,400,401,403,409].every(x=>op.statuses?.includes(x))||
      !Array.isArray(legs)||legs.length<2||legs.length>4||
      b.moveUnits||b.reverseUnits||b.reserve||b.release||b.debitExact||
      b.reverseExact||b.field||b.input||b.from||b.to)
    throw Error("Unsupported compound movement operation");
  const stock=ir.entities.find(e=>e.name===rule.stockEntity);
  const available=stock?.fields.find(f=>f.name===rule.availableField);
  if(!stock||!entity||stock===entity||
      stock.fields.some(f=>f.ownerManaged)||entity.fields.some(f=>f.ownerManaged)||
      !available||available.type!=="int32"||!available.required||available.nullable||
      available.min!==0||available.reference||
      available.computedSum||available.computedProduct||
      available.computedRoundedProduct||available.computedDiscountedTotal||
      (available.max!==undefined&&
        (!Number.isInteger(available.max)||available.max<1||available.max>2147483647)))
    throw Error("Unsafe batch balance definition");
  const write=ir.operations.filter(x=>x.entity===stock.name&&x.behavior.kind==="create");
  const related=ir.operations.filter(x=>x.entity===entity.name&&x.behavior.kind!=="health");
  if(write.length!==1||!write[0].capability||write[0].capability==="public"||
    related.some(x=>!["create","get","listPage","queryPage","auditPage"].includes(x.behavior.kind)&&
      !(x.behavior.kind==="transition"&&x.behavior.reverseBatch))||
    related.filter(x=>x.behavior.kind==="create").length!==1)
    throw Error("Multi-leg journal requires one immutable create and independent parent write permission");
  const seen=new Set([entity.publicIdentity]);
  for(const leg of legs){
    if(!leg||typeof leg!=="object")throw Error("Invalid movement leg");
    const names=[leg.sourceField,leg.targetField,leg.quantityField];
    if(names.some(n=>typeof n!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(n)||
      seen.has(n)))throw Error("Reused or invalid batch input");
    for(const n of names)seen.add(n);
    const source=entity.fields.find(f=>f.name===leg.sourceField);
    const target=entity.fields.find(f=>f.name===leg.targetField);
    const quantity=entity.fields.find(f=>f.name===leg.quantityField);
    if([source,target].some(f=>!f||f.type!=="string"||!f.required||f.nullable||
        f.ownerManaged||f.reference?.target!==stock.name||f.reference.onDelete!=="restrict")||
       !quantity||quantity.type!=="int32"||!quantity.required||quantity.nullable||
       !Number.isInteger(quantity.min)||quantity.min<1||
       (quantity.max!==undefined&&(!Number.isInteger(quantity.max)||
         quantity.max>2147483647||quantity.max<quantity.min)))
      throw Error("Unsafe movement leg "+leg.sourceField);
  }
  return {stock,available,legs,parentWriteCapability:write[0].capability};
}


/** Validate reversible multi-leg journal lifecycle, without silently permitting mutable entries. */
export function assertReverseBatch(ir,entity,op){
  const b=op?.behavior,rule=b?.reverseBatch;
  if(!rule||b.kind!=="transition"||op.method!=="POST"||
    ![200,400,401,403,404,409].every(x=>op.statuses?.includes(x))||
    b.from!=="posted"||b.to!=="reversed"||
    !b.field||!Array.isArray(b.audit)||b.audit.length!==1||b.audit[0]!==b.field||
    b.moveUnits||b.moveBatch||b.reverseUnits||b.reserve||b.release||
    b.debitExact||b.reverseExact)
    throw Error("Invalid multi-leg reversal transition contract");
  const state=entity?.fields.find(f=>f.name===b.field);
  if(!state||state.type!=="string"||!state.required||state.nullable||
    state.initial!=="posted"||entity.fields.filter(f=>f.initial!==undefined).length!==1)
    throw Error("Exactly one immutable server-initialized posted state is required");
  const creators=ir.operations.filter(x=>x.entity===entity.name&&x.behavior.kind==="create");
  const reversers=ir.operations.filter(x=>x.entity===entity.name&&x.behavior.reverseBatch);
  if(creators.length!==1||reversers.length!==1||reversers[0].name!==op.name||
    ir.operations.some(x=>x.entity===entity.name&&x.behavior.kind==="transition"&&
      x.name!==op.name))
    throw Error("Batch must have exactly one creator and one reversal");
  const source=creators[0].behavior.moveBatch;
  if(!source||source.stockEntity!==rule.stockEntity||
      source.availableField!==rule.availableField||
      JSON.stringify(source.legs)!==JSON.stringify(rule.legs))
    throw Error("Reversal must match every declared immutable batch leg");
  const plan=assertMoveBatch(ir,entity,creators[0]);
  return {...plan,field:state,rule};
}
