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
