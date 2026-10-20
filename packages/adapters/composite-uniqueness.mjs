/**
 * Portable compound business-key preflight and PostgreSQL projection.
 * Never interpolate names without the same fail-closed syntax check as TypeSpec.
 */
const safe=s=>{
  if(typeof s!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(s))
    throw Error("Unsafe composite business identifier");
  return s;
};
const snake=s=>safe(s).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
export function uniqueTogetherSql(entity){
  const raw=entity.uniqueTogether;
  if(raw===undefined)return [];
  const fields=entity.fields??[];
  if(!Array.isArray(raw)||raw.length<2||raw.length>4||
     raw.some(n=>typeof n!=="string"||!n)||new Set(raw).size!==raw.length)
    throw Error("Invalid compound business uniqueness on "+entity.name);
  const selected=raw.map(n=>fields.find(f=>f.name===n));
  if(selected.some(f=>!f||!f.required||f.nullable||f.unique||
     f.name===entity.publicIdentity||f.initial!==undefined||
     f.computedSum||f.computedProduct||f.computedRoundedProduct||
     f.computedDiscountedTotal||f.requiredWhen||f.forbidWhen||f.readCapability))
    throw Error("Unsupported compound business uniqueness on "+entity.name);
  // Stable short name (max table identifier length validated by caller).
  const table=snake(entity.name);
  const name="uq_"+table+"_business";
  if(Buffer.byteLength(name,"utf8")>63)throw Error("Compound uniqueness constraint name too long");
  return ["  CONSTRAINT "+name+" UNIQUE ("+raw.map(snake).join(",")+")"];
}
