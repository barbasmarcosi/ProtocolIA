/**
 * Postgres partial UNIQUE is a database-level invariant: only rows with
 * exactly the selected finite state compete for the compound business key.
 * Only validated, domain-derived identifiers and state literals are emitted.
 */
const safe=s=>{
  if(typeof s!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(s))
    throw Error("Unsafe partial business uniqueness identifier");
  return s;
};
const snake=s=>safe(s).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
export function uniqueWhenSql(entity,ops){
  const rule=entity.uniqueWhen;
  if(rule===undefined)return [];
  const keys=rule.fields;
  const state=entity.fields?.find(f=>f.name===rule.stateField);
  const selected=Array.isArray(keys)?keys.map(n=>entity.fields?.find(f=>f.name===n)):[];
  if(entity.uniqueTogether||!Array.isArray(keys)||keys.length<2||keys.length>4||
    new Set(keys).size!==keys.length||keys.some(n=>typeof n!=="string"||!n)||
    typeof rule.activeState!=="string"||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(rule.activeState)||
    !state||state.name===entity.publicIdentity||state.unique||state.type!=="string"||
    !state.required||state.nullable||!state.initial||state.initial===rule.activeState||
    state.reference||state.ownerManaged||
    selected.some(f=>!f||!f.required||f.nullable||f.unique||
      f.name===entity.publicIdentity||f.name===state.name||f.initial!==undefined||
      f.computedSum||f.computedProduct||f.computedRoundedProduct||
      f.computedDiscountedTotal||f.requiredWhen||f.forbidWhen||
      f.readCapability||f.ownerManaged))
    throw Error("Unsupported partial business uniqueness on "+entity.name);
  const transitions=ops.filter(o=>o.entity===entity.name&&
    o.behavior?.kind==="transition"&&o.behavior.field===state.name);
  if(transitions.filter(o=>o.behavior.to===rule.activeState).length!==1||
    transitions.filter(o=>o.behavior.from===rule.activeState).length!==1||
    ops.some(o=>o.entity===entity.name&&
      ((o.behavior?.kind==="patchFields"&&
       (keys.includes(o.behavior.field)||o.behavior.field===state.name))||
      (o.behavior?.kind==="reassignReference"&&keys.includes(o.behavior.field)))))
    throw Error("Unsupported partial uniqueness lifecycle on "+entity.name);
  const table=snake(entity.name),index="uq_"+table+"_active";
  if(Buffer.byteLength(index,"utf8")>63)throw Error("Partial uniqueness index name too long");
  return ["CREATE UNIQUE INDEX "+index+" ON "+table+" ("+
    keys.map(snake).join(",")+") WHERE "+snake(state.name)+" = '"+
    rule.activeState+"';"];
}
