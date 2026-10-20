// Read-only, single-statement relational sums; both backends receive the same
// validated plan. This prevents arbitrary SQL/identifiers in untrusted IR.
const ident=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x);
const snake=x=>x.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
export function compileRelatedSums(ir){
  const entities=new Map(ir.entities.map(e=>[e.name,e]));
  const find=(kind,entity)=>ir.operations.filter(o=>o.entity===entity&&o.behavior.kind===kind);
  const result=new Map();
  for(const op of ir.operations.filter(o=>o.behavior.kind==="sumRelated")){
    const b=op.behavior,cfg=b.relatedSum,head=entities.get(op.entity),child=entities.get(cfg?.childEntity);
    const fk=child?.fields.find(x=>x.name===cfg?.referenceField);
    const qty=child?.fields.find(x=>x.name===cfg?.quantityField);
    const state=child?.fields.find(x=>x.name===cfg?.stateField);
    const reader=find("get",child?.name)[0],parentReader=find("get",head?.name)[0];
    const reserve=find("create",child?.name).filter(x=>x.behavior.reserve?.stockEntity===head?.name&&
      x.behavior.reserve?.referenceField===cfg?.referenceField&&
      x.behavior.reserve?.quantityField===cfg?.quantityField);
    const release=find("transition",child?.name).filter(x=>x.behavior.release?.stockEntity===head?.name&&
      x.behavior.release?.referenceField===cfg?.referenceField&&
      x.behavior.release?.quantityField===cfg?.quantityField&&
      x.behavior.field===cfg?.stateField&&x.behavior.from===cfg?.activeState);
    if(!head||!child||head===child||
      ![head.name,head.publicIdentity,child.name,...Object.values(cfg??{})].every(ident)||
      !fk?.reference||fk.reference.target!==head.name||!fk.required||fk.nullable||
      qty?.type!=="int32"||!qty.required||qty.nullable||(qty.min??0)<1||
      state?.type!=="string"||!state.required||state.nullable||
      state.initial!==cfg.activeState||!reader||reader.capability==="public"||
      !parentReader||parentReader.capability!==op.capability||
      reserve.length!==1||release.length!==1||
      op.method!=="GET"||![200,401,403,404].every(code=>op.statuses.includes(code))||
      op.path.split("{").length!==2||!op.path.includes("{"+head.publicIdentity+"}")||
      b.field||b.input||b.reserve||b.release||b.audit||b.from||b.to)
      throw Error("Invalid authorized related reservation sum "+op.name);
    const p=snake(head.name),c=snake(child.name),pk=snake(head.publicIdentity);
    const fkCol=snake(cfg.referenceField),qtyCol=snake(cfg.quantityField),stateCol=snake(cfg.stateField);
    // cfg.activeState is a verified TypeSpec @initial() state, strictly alphanumeric.
    const common="SELECT COALESCE(SUM(c."+qtyCol+"::bigint),0)::text AS \"totalUnits\""+
      " FROM "+p+" p LEFT JOIN "+c+" c ON c."+fkCol+"=p."+pk+
      " AND c."+stateCol+"='"+cfg.activeState+"' WHERE p."+pk+"=";
    result.set(op.name,{
      sqlNest:common+"$1 GROUP BY p."+pk,
      sqlSpring:common+":identity GROUP BY p."+pk,
      childReadCapability:reader.capability,
    });
  }
  for(const op of ir.operations.filter(o=>o.behavior.relatedSum&&o.behavior.kind!=="sumRelated"))
    throw Error("Orphan related sum metadata "+op.name);
  return result;
}
