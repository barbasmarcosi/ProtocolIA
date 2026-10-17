/**
 * Adapter-level fail-closed validation for generated two-field atomic updates.
 * The compiler additionally validates the source TypeSpec DTO and HTTP shape.
 */
export function assertPatchTogether(entity,op){
  const b=op?.behavior??{};
  if(b.kind!=="patchTogether")throw Error("Expected patchTogether operation");
  const names=typeof b.input==="string"?b.input.split(","):[];
  const expected=entity?.uniqueTogether;
  if(!Array.isArray(expected)||(expected.length<2||expected.length>4)||
     names.length!==expected.length||names.join(",")!==expected.join(",")||
     b.field!==undefined||b.audit!==undefined||b.reserve!==undefined||
     b.release!==undefined||b.from!==undefined||b.to!==undefined||
     entity.uniqueWhen||op.method!=="PATCH"||
     ![200,400,404,409].every(code=>op.statuses?.includes(code)))
    throw Error("Unsafe atomic business-key patch: "+op.name);
  for(const name of names){
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))throw Error("Unsafe business-key field");
    const f=entity.fields.find(x=>x.name===name);
    if(!f||f.type!=="string"||!f.required||f.nullable||f.unique||
       f.name===entity.publicIdentity||f.reference||f.ownerManaged||f.readCapability||
       f.initial!==undefined||f.requiredWhen||f.forbidWhen||
       f.computedSum||f.computedProduct||f.computedRoundedProduct||
       f.computedDiscountedTotal||f.afterField||f.greaterThanField)
      throw Error("Unsupported atomic business-key patch field: "+name);
  }
  return names;
}
