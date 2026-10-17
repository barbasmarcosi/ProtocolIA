// B14 strict whole-document int32 sum: a single parent-existence-guarded
// PostgreSQL MVCC statement using the relation from a matching @createDetails.
// The bigint/string wire contract never goes through IEEE-754 arithmetic.
const ident=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x);
const snake=x=>x.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
export function compileDetailSums(ir){
  const result=new Map(),entities=new Map(ir.entities.map(e=>[e.name,e]));
  for(const op of ir.operations.filter(o=>o.behavior.kind==="sumDetails")){
    const cfg=op.behavior.detailSum,parent=entities.get(op.entity),
      child=entities.get(cfg?.childEntity);
    const qty=child?.fields.find(f=>f.name===cfg?.quantityField);
    const fk=child?.fields.find(f=>f.name===cfg?.parentField);
    const creator=ir.operations.filter(o=>o.entity===parent?.name&&
      o.behavior.kind==="create"&&o.behavior.createDetails?.childEntity===child?.name&&
      o.behavior.createDetails?.parentField===cfg?.parentField);
    const parentReader=ir.operations.find(o=>o.entity===parent?.name&&o.behavior.kind==="get");
    const childReader=ir.operations.find(o=>o.entity===child?.name&&o.behavior.kind==="get");
    if(!cfg||!parent||!child||parent===child||
      ![parent.name,parent.publicIdentity,child.name,cfg.parentField,cfg.quantityField].every(ident)||
      !fk?.reference||fk.reference.target!==parent.name||!fk.required||fk.nullable||
      qty?.type!=="int32"||!qty.required||qty.nullable||(qty.min??0)<1||
      creator.length!==1||!parentReader||parentReader.capability!==op.capability||
      !childReader||childReader.capability==="public"||
      op.method!=="GET"||![200,401,403,404].every(code=>op.statuses.includes(code))||
      op.path.split("{").length!==2||
      !op.path.includes("{"+parent.publicIdentity+"}")||
      op.behavior.field||op.behavior.input||op.behavior.audit)
      throw Error("Unsafe contract-derived full detail aggregation "+op.name);
    const p=snake(parent.name),c=snake(child.name),pk=snake(parent.publicIdentity);
    const fkCol=snake(cfg.parentField),qtyCol=snake(cfg.quantityField);
    const q="SELECT COALESCE(SUM(c."+qtyCol+"::bigint),0)::text AS \"totalUnits\""+
      " FROM "+p+" p LEFT JOIN "+c+" c ON c."+fkCol+"=p."+pk+
      " WHERE p."+pk+"=";
    result.set(op.name,{sqlNest:q+"$1 GROUP BY p."+pk,
      sqlSpring:q+":identity GROUP BY p."+pk,
      childReadCapability:childReader.capability});
  }
  if(ir.operations.some(x=>x.behavior.detailSum&&x.behavior.kind!=="sumDetails"))
    throw Error("Orphan @detailSum metadata");
  return result;
}
