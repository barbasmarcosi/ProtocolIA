// Validated, generated-only transaction plan shared by NestJS and Spring Boot.
// This describes no arbitrary SQL, script, expression or user-selected identifier.
const ident=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x);
const snake=x=>x.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
const units=(raw,scale)=>{
  if(typeof raw!=="string"||!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(raw))return null;
  const negative=raw.startsWith("-"),[whole,fract=""]=(negative?raw.slice(1):raw).split(".");
  return fract.length>scale?null:BigInt((negative?"-":"")+whole+fract.padEnd(scale,"0"));
};
export function compileExactDebits(ir){
  const entities=new Map(ir.entities.map(e=>[e.name,e])),out=new Map();
  for(const op of ir.operations){
    const cfg=op.behavior?.debitExact;
    if(!cfg)continue;
    const target=entities.get(op.entity),parent=entities.get(cfg.stockEntity);
    const balance=parent?.fields.find(f=>f.name===cfg.availableField);
    const amount=target?.fields.find(f=>f.name===cfg.quantityField);
    const relation=target?.fields.find(f=>f.name===cfg.referenceField);
    const write=ir.operations.filter(x=>x.entity===parent?.name&&x.behavior.kind==="create");
    const b=balance?.decimal,c=amount?.decimal;
    if(!target||!parent||parent===target||
      !Object.values(cfg).every(ident)||!ident(parent.publicIdentity)||
      op.behavior.kind!=="create"||op.method!=="POST"||
      ![201,400,409].every(x=>op.statuses?.includes(x))||
      op.behavior.reserve||op.behavior.release||op.behavior.from||op.behavior.to||
      op.behavior.field||op.behavior.input||!balance||!amount||!relation||
      balance.type!=="decimal"||amount.type!=="decimal"||
      !b||!c||!balance.required||balance.nullable||!amount.required||amount.nullable||
      b.min!=="0"||c.min===undefined||units(c.min,c.scale)===null||
      units(c.min,c.scale)<=0n||b.scale!==c.scale||b.precision<c.precision||
      balance.computedSum||balance.computedProduct||balance.computedRoundedProduct||balance.computedDiscountedTotal||
      amount.computedSum||amount.computedProduct||amount.computedRoundedProduct||amount.computedDiscountedTotal||
      relation.reference?.target!==parent.name||!relation.required||relation.nullable||
      write.length!==1||!write[0].capability||write[0].capability==="public")
        throw Error("Invalid exact debit transaction "+op.name);
    out.set(op.name,{
      balanceTable:snake(parent.name),balanceKey:snake(parent.publicIdentity),
      balanceColumn:snake(balance.name),referenceField:relation.name,
      amountField:amount.name,parentWriteCapability:write[0].capability
    });
  }
  return out;
}
