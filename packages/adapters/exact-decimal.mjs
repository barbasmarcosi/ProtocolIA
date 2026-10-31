// Shared generator-side invariant for TypeSpec decimal encoded as a JSON string.
// Both executable adapters MUST apply this same precision/scale/bounds contract.
const numeric=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
function units(value,scale){
  if(typeof value!=="string"||!numeric.test(value))return null;
  const negative=value.startsWith("-");
  const [whole,fraction=""]=(negative?value.slice(1):value).split(".");
  if(fraction.length>scale)return null;
  return BigInt((negative?"-":"")+whole+fraction.padEnd(scale,"0"));
}
export function assertDecimalField(field,identity){
  if(field.type!=="decimal"){
    if(field.decimal!==undefined||field.computedProduct!==undefined||field.computedRoundedProduct!==undefined||field.computedDiscountedTotal!==undefined)throw Error("Unbound exact decimal metadata "+identity);
    return;
  }
  const d=field.decimal;
  if(!d||!Number.isInteger(d.precision)||d.precision<1||d.precision>38||
    !Number.isInteger(d.scale)||d.scale<0||d.scale>d.precision||
    field.reference||field.choices||field.initial||field.computedSum||field.requiredWhen||
    field.min!==undefined||field.max!==undefined||field.minLength!==undefined||
    field.maxLength!==undefined||field.pattern!==undefined||field.unique)
      throw Error("Invalid exact decimal metadata "+identity);
  for(const value of [d.min,d.max]){
    if(value===undefined)continue;
    if(units(value,d.scale)===null||
       value.split(".")[0].replace(/^-/,"").replace(/^0+/,"").length>d.precision-d.scale)
      throw Error("Invalid exact decimal bound "+identity);
  }
  if(d.min!==undefined&&d.max!==undefined&&units(d.min,d.scale)>units(d.max,d.scale))
    throw Error("Inverted exact decimal range "+identity);
}
// Both executable adapters defend against handwritten or corrupted canonical IR.
export function assertComputedProduct(field,entity){
  if(field.computedProduct===undefined)return;
  const parts=field.computedProduct;
  const left=entity.fields.find(f=>f.name===parts?.[0]);
  const right=entity.fields.find(f=>f.name===parts?.[1]);
  const a=left?.decimal,b=right?.decimal,c=field.decimal;
  if(!Array.isArray(parts)||parts.length!==2||
     parts.some(x=>typeof x!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(x))||
     !left||!right||left===right||left===field||right===field||
     left.type!=="decimal"||right.type!=="decimal"||field.type!=="decimal"||
     !left.required||!right.required||left.nullable||right.nullable||
     !field.required||field.nullable||field.unique||field.reference||
     field.initial!==undefined||field.computedSum||field.computedRoundedProduct||field.computedDiscountedTotal||field.requiredWhen||
     field.afterField||field.greaterThanField||
     left.computedProduct||right.computedProduct||left.computedRoundedProduct||
     right.computedRoundedProduct||left.computedDiscountedTotal||right.computedDiscountedTotal||
     left.computedSum||right.computedSum||
     left.reference||right.reference||left.greaterThanField||right.greaterThanField||
     !a||!b||!c||a.min!=="0"||b.min!=="0"||c.min!=="0"||
     a.precision+b.precision>38||c.precision!==a.precision+b.precision||
     c.scale!==a.scale+b.scale)
    throw Error("Invalid exact computed product "+entity.name+"."+field.name);
}
export function assertComputedRoundedProduct(field,entity){
  if(field.computedRoundedProduct===undefined)return;
  const spec=field.computedRoundedProduct;
  const validIds=[spec?.left,spec?.right].every(x=>
    typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x));
  const left=entity.fields.find(f=>f.name===spec?.left);
  const right=entity.fields.find(f=>f.name===spec?.right);
  const a=left?.decimal,b=right?.decimal,c=field.decimal;
  const integerDigits=a&&b?a.precision-a.scale+b.precision-b.scale+1:undefined;
  if(!validIds||spec?.mode!=="half_up"||
     !left||!right||left===right||left===field||right===field||
     left.type!=="decimal"||right.type!=="decimal"||field.type!=="decimal"||
     !left.required||!right.required||left.nullable||right.nullable||
     !field.required||field.nullable||field.unique||field.reference||
     field.initial!==undefined||field.computedSum||field.computedProduct||field.computedDiscountedTotal||
     field.requiredWhen||field.afterField||field.greaterThanField||
     left.computedProduct||right.computedProduct||left.computedRoundedProduct||
     right.computedRoundedProduct||left.computedDiscountedTotal||right.computedDiscountedTotal||
     left.computedSum||right.computedSum||
     left.reference||right.reference||left.greaterThanField||right.greaterThanField||
     !a||!b||!c||a.min!=="0"||b.min!=="0"||c.min!=="0"||c.max!==undefined||
     c.scale>=a.scale+b.scale||c.precision!==integerDigits+c.scale||c.precision>38)
    throw Error("Invalid rounded decimal product "+entity.name+"."+field.name);
}
// Both generators must reject invalid handwritten IR without trusting the compiler.
export function assertComputedDiscountedTotal(field,entity){
  if(field.computedDiscountedTotal===undefined)return;
  const rule=field.computedDiscountedTotal;
  const names=[rule?.price,rule?.quantity,rule?.discount];
  const values=names.map(n=>entity.fields.find(f=>f.name===n));
  const [price,quantity,discount]=values;
  const [a,b,d]=values.map(v=>v?.decimal),out=field.decimal;
  const digits=a&&b?a.precision-a.scale+b.precision-b.scale+1:undefined;
  const invalidInput=f=>!f||f.type!=="decimal"||!f.required||f.nullable||
    f.reference||f.computedSum||f.computedProduct||f.computedRoundedProduct||
    f.computedDiscountedTotal||f.afterField||f.greaterThanField||f.requiredWhen;
  if(names.some(n=>typeof n!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(n))||
     new Set(names).size!==3||rule?.mode!=="half_up"||names.includes(field.name)||
     values.some(invalidInput)||!a||!b||!d||!out||
     a.min!=="0"||b.min!=="0"||d.min!=="0"||d.max!=="100"||
     field.type!=="decimal"||!field.required||field.nullable||field.unique||
     field.reference||field.initial!==undefined||field.computedSum||
     field.computedProduct||field.computedRoundedProduct||
     field.requiredWhen||field.afterField||field.greaterThanField||
     out.min!=="0"||out.max!==undefined||
     out.scale>=a.scale+b.scale+d.scale+2||
     out.precision!==digits+out.scale||out.precision>38)
    throw Error("Invalid discounted total "+entity.name+"."+field.name);
}
export function decimalSql(field,column){
  const d=field.decimal;
  return {
    type:"NUMERIC("+d.precision+","+d.scale+")",
    checks:[
      "CHECK ("+column+"::text NOT IN ('NaN','Infinity','-Infinity'))",
      "CHECK (scale("+column+") <= "+d.scale+")",
      ...(d.min!==undefined?["CHECK ("+column+">="+d.min+")"]:[]),
      ...(d.max!==undefined?["CHECK ("+column+"<="+d.max+")"]:[])
    ]
  };
}
export function assertDecimalWireSchema(spec,op,entity,ir){
  const deref=x=>x?.$ref?x.$ref.split("/").slice(1).reduce((v,k)=>v?.[k],spec):x;
  const http=spec.paths?.[op.path]?.[op.method.toLowerCase()];
  const body=deref(http?.requestBody);
  const model=deref(body?.content?.["application/json"]?.schema);
  // A reconciliation may opt into server-only exact balances: these are
  // persisted, validated, and returned, but intentionally absent from CREATE.
  const ledger=ir?.operations?.find(x=>x.entity===entity.name&&
    x.behavior?.kind==="reconcileExact")?.behavior?.reconcileExact;
  const derived=ledger?.serverOnly===true?
    [ledger.openingField,ledger.availableField]:[];
  for(const f of entity.fields.filter(f=>f.type==="decimal"&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal&&!derived.includes(f.name))){
    const property=deref(model?.properties?.[f.name]);
    // A required/optional decimal must be a JSON string (and never a JSON number).
    const leaf=property?.anyOf?.find(x=>deref(x)?.type==="string")??property?.oneOf?.find(x=>deref(x)?.type==="string")??property;
    const schema=deref(leaf);
    if(!schema||!(schema.type==="string"||
      Array.isArray(schema.type)&&schema.type.includes("string")&&!schema.type.includes("number")))
      throw Error("OpenAPI decimal must be JSON string: "+op.name+"."+f.name);
  }
}
