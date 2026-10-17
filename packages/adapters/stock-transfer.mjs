/**
 * B8: strict target-neutral validation of a two-parent inventory move.
 * No SQL can be emitted before identifying both required FKs and a bounded integer balance.
 */
export function assertMoveUnits(ir,entity,op){
  const rule=op?.behavior?.moveUnits;
  if(!rule||op.behavior.kind!=="create"||op.method!=="POST"||
      ![201,400,401,403,409].every(status=>op.statuses?.includes(status))||
      op.behavior.reserve||op.behavior.release||op.behavior.debitExact||
      op.behavior.reverseExact||op.behavior.field||op.behavior.input||
      op.behavior.from||op.behavior.to)throw Error("Unsupported stock transfer operation");
  const stock=ir.entities.find(e=>e.name===rule.stockEntity);
  const available=stock?.fields.find(f=>f.name===rule.availableField);
  const source=entity?.fields.find(f=>f.name===rule.sourceField);
  const target=entity?.fields.find(f=>f.name===rule.targetField);
  const amount=entity?.fields.find(f=>f.name===rule.quantityField);
  const fields=[rule.stockEntity,rule.availableField,rule.sourceField,rule.targetField,rule.quantityField];
  if(!stock||!entity||stock===entity||!fields.every(f=>typeof f==="string"&&
      /^[A-Za-z][A-Za-z0-9_]*$/.test(f))||
      new Set([rule.sourceField,rule.targetField,rule.quantityField,entity.publicIdentity]).size!==4||
      stock.fields.some(f=>f.ownerManaged)||entity.fields.some(f=>f.ownerManaged)||
      !available||available.type!=="int32"||!available.required||available.nullable||
      available.min!==0||(available.max!==undefined&&
        (!Number.isInteger(available.max)||available.max>2147483647||available.max<1))||
      available.reference||available.computedSum||available.computedProduct||
      available.computedRoundedProduct||available.computedDiscountedTotal||
      [source,target].some(f=>!f||f.type!=="string"||!f.required||f.nullable||
        f.reference?.target!==stock.name||f.reference.onDelete!=="restrict")||
      !amount||amount.type!=="int32"||!amount.required||amount.nullable||
      !Number.isInteger(amount.min)||amount.min<1||
      (amount.max!==undefined&&(!Number.isInteger(amount.max)||amount.max>2147483647)))
    throw Error("Unsafe stock transfer IR: "+op.name);
  const write=ir.operations.filter(x=>x.entity===stock.name&&x.behavior.kind==="create");
  if(write.length!==1||!write[0].capability||write[0].capability==="public")
    throw Error("Stock transfer requires independent parent write capability");
  return {stock,available,source,target,amount,parentWriteCapability:write[0].capability};
}


/** B9: validate the complete paired lifecycle before any adapter emits SQL. */
export function assertReverseUnits(ir,entity,op){
  const rule=op?.behavior?.reverseUnits;
  if(!rule||op.behavior.kind!=="transition"||op.method!=="POST"||
    ![200,400,401,403,404,409].every(code=>op.statuses?.includes(code))||
    op.behavior.from!=="posted"||op.behavior.to!=="reversed"||
    !op.behavior.field||!Array.isArray(op.behavior.audit)||
    op.behavior.audit.length!==1||op.behavior.audit[0]!==op.behavior.field||
    op.behavior.reserve||op.behavior.release||op.behavior.moveUnits||
    op.behavior.exactDebit||op.behavior.exactReverse)
    throw Error("Invalid reversible movement contract");
  const state=entity?.fields.find(f=>f.name===op.behavior.field);
  if(!state||state.type!=="string"||state.initial!=="posted"||
    !state.required||state.nullable||
    entity.fields.filter(f=>f.initial!==undefined).length!==1)
    throw Error("A transfer reversal requires one server-initialized posted state");
  const names=["stockEntity","availableField","sourceField","targetField","quantityField"];
  const creates=ir.operations.filter(x=>x.entity===entity.name&&
    x.behavior.kind==="create"&&x.behavior.moveUnits&&
    names.every(key=>x.behavior.moveUnits[key]===rule[key]));
  const reversals=ir.operations.filter(x=>x.entity===entity.name&&x.behavior.reverseUnits);
  const forbidden=ir.operations.filter(x=>x.entity===entity.name&&
    !["create","get","listPage","transition","auditPage"].includes(x.behavior.kind));
  if(creates.length!==1||reversals.length!==1||forbidden.length||
    ir.operations.some(x=>x.entity===entity.name&&x.behavior.kind==="transition"&&
      x.name!==op.name)||
    ir.operations.filter(x=>x.entity===entity.name&&x.behavior.kind==="create").length!==1)
    throw Error("A movement must have exactly one creator and exactly one reversal");
  const plan=assertMoveUnits(ir,entity,creates[0]);
  const stock=ir.entities.find(e=>e.name===rule.stockEntity);
  if(!stock||stock!==plan.stock||!["sourceField","targetField","quantityField"].every(
    k=>entity.fields.some(f=>f.name===rule[k])))
    throw Error("Reversal metadata does not match the transfer");
  return {...plan,rule,field:state,createCapability:creates[0].capability};
}
