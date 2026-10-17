import {
  emitFile, getEncode, getMinLength, getMaxLength, getMinItems, getMaxItems, getMinValue,
  getMaxValue, getPattern, navigateProgram, resolvePath,
  type EmitContext, type Model, type ModelProperty, type Operation, type Type,
  type Program,
} from "@typespec/compiler";
import { getHttpOperation } from "@typespec/http";
import { readDomainDecorator } from "@protocolia/domain";
import { emitJdl, emitJhipsterApplicationJdl, planJhipster, type IrDocument, type IrEntity, type IrField,
  type IrOperation } from "@protocolia/jhipster";

const metadata = (p: Program, name: string, target: Type) =>
  readDomainDecorator(p, name, target);
type Kind = IrOperation["behavior"]["kind"];
const supported: readonly string[] =
  ["create","get","listPage","auditPage","inboxPage","ackNotification","queryPage","sumRelated","sumDetails","reconcileExact","patchFields","patchTogether","atomicIncrement","transition","reassignReference","delete","health"];

function typeOfField(prop: ModelProperty): { type: IrField["type"]; nullable: boolean; choices?: Array<{value:string;label:string}> } | null {
  let t: Type = prop.type;
  let nullable = false;
  if (t.kind === "Union") {
    const choices = [...t.variants.values()].map((x) => x.type);
    const values = choices.filter((x) => x.kind !== "Intrinsic" || x.name !== "null");
    nullable = values.length !== choices.length;
    if (!nullable || values.length !== 1) return null;
    t = values[0];
  }
  if(t.kind==="Enum"){
    // Only string enums with explicit, portable values are currently executable.
    const choices=[...t.members.values()].map(member=>({
      value:member.value,label:member.name.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/_/g," ")
    }));
    if(choices.length<2||choices.length>16||choices.some(x=>typeof x.value!=="string"||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(x.value)||!x.label||
      x.label.length>90)||new Set(choices.map(x=>x.value)).size!==choices.length)return null;
    return {type:"string",nullable,choices:choices as Array<{value:string;label:string}>};
  }
  if (t.kind !== "Scalar") return null;
  const names: Record<string, IrField["type"]> = {
    string: "string", int32: "int32", utcDateTime: "utcDateTime", decimal: "decimal",
  };
  return names[t.name] ? { type: names[t.name], nullable } : null;
}

// No Number conversion is allowed for semantic decimal comparisons, including contract bounds.
function decimalUnits(s:string,scale:number): bigint | undefined {
  if(!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(s))return undefined;
  const negative=s.startsWith("-");
  const [whole,fraction=""]=(negative?s.slice(1):s).split(".");
  if(fraction.length>scale)return undefined;
  return BigInt((negative?"-":"")+whole+fraction.padEnd(scale,"0"));
}

function field(p: Program, prop: ModelProperty): IrField | null {
  const parsed = typeOfField(prop);
  if (!parsed) return null;
  const spec=metadata(p,"exactDecimal",prop);
  return {
    name: prop.name, type: parsed.type, required: !prop.optional,
    ...(metadata(p,"ownerIdentity",prop)?{ownerManaged:true}:{}),
    ...(metadata(p,"readCapability",prop)?{readCapability:String(metadata(p,"readCapability",prop)?.capability)}:{}),
    nullable: parsed.nullable, unique: !!metadata(p,"unique",prop),
    ...(parsed.choices?{choices:parsed.choices}:{}),
    ...(spec?{decimal:{precision:Number(spec.precision),scale:Number(spec.scale),
      ...(spec.min!==undefined?{min:String(spec.min)}:{}),
      ...(spec.max!==undefined?{max:String(spec.max)}:{})}}:{}),
    ...(metadata(p,"afterField",prop)?{afterField:String(metadata(p,"afterField",prop)?.field)}:{}),
    ...(metadata(p,"greaterThanField",prop)?{greaterThanField:String(metadata(p,"greaterThanField",prop)?.field)}:{}),
    ...(metadata(p,"requiredWhen",prop)?{requiredWhen:{
      field:String(metadata(p,"requiredWhen",prop)?.field),
      equals:String(metadata(p,"requiredWhen",prop)?.equals)
    }}:{}),
    ...(metadata(p,"forbidWhen",prop)?{forbidWhen:{
      field:String(metadata(p,"forbidWhen",prop)?.field),
      equals:String(metadata(p,"forbidWhen",prop)?.equals)
    }}:{}),
    ...(metadata(p,"uiLabel",prop) ? {uiLabel:String(metadata(p,"uiLabel",prop)?.label)} : {}),
    ...(metadata(p,"uiHelp",prop) ? {uiHelp:String(metadata(p,"uiHelp",prop)?.help)} : {}),
    ...(metadata(p,"uiControl",prop) ? {uiControl:String(metadata(p,"uiControl",prop)?.control) as "month"|"textarea"} : {}),
    ...(metadata(p,"uiSection",prop) ? {uiSection:String(metadata(p,"uiSection",prop)?.section)} : {}),
    ...(metadata(p,"uiPlaceholder",prop) ? {uiPlaceholder:String(metadata(p,"uiPlaceholder",prop)?.placeholder)} : {}),
    ...(metadata(p,"initial",prop) ? {initial:String(metadata(p,"initial",prop)?.value)} : {}),
    ...(metadata(p,"computedSum",prop) ? {computedSum:String(metadata(p,"computedSum",prop)?.fields).split(",").map(s=>s.trim())} : {}),
    ...(metadata(p,"computedProduct",prop) ? {computedProduct:[
      String(metadata(p,"computedProduct",prop)?.left),
      String(metadata(p,"computedProduct",prop)?.right)
    ] as [string,string]} : {}),
    ...(metadata(p,"computedRoundedProduct",prop) ? {computedRoundedProduct:{
      left:String(metadata(p,"computedRoundedProduct",prop)?.left),
      right:String(metadata(p,"computedRoundedProduct",prop)?.right),
      mode:String(metadata(p,"computedRoundedProduct",prop)?.mode) as "half_up"
    }} : {}),
    ...(metadata(p,"computedDiscountedTotal",prop) ? {computedDiscountedTotal:{
      price:String(metadata(p,"computedDiscountedTotal",prop)?.price),
      quantity:String(metadata(p,"computedDiscountedTotal",prop)?.quantity),
      discount:String(metadata(p,"computedDiscountedTotal",prop)?.discount),
      mode:String(metadata(p,"computedDiscountedTotal",prop)?.mode) as "half_up"
    }} : {}),
    ...(metadata(p,"reference",prop) ? {reference:{
      target:String(metadata(p,"reference",prop)?.entity),
      onDelete:String(metadata(p,"reference",prop)?.onDelete) as "restrict"
    }} : {}),
    ...(getMinLength(p,prop) !== undefined ? {minLength:getMinLength(p,prop)} : {}),
    ...(getMaxLength(p,prop) !== undefined ? {maxLength:getMaxLength(p,prop)} : {}),
    ...(getPattern(p,prop) !== undefined ? {pattern:getPattern(p,prop)} : {}),
    ...(parsed.type!=="decimal"&&getMinValue(p,prop) !== undefined ? {min:getMinValue(p,prop)} : {}),
    ...(parsed.type!=="decimal"&&getMaxValue(p,prop) !== undefined ? {max:getMaxValue(p,prop)} : {}),
  };
}

function report(p: Program, code: string, message: string, target: Type) {
  p.reportDiagnostic({code:"protocolia-" + code, severity:"error", message, target});
}

export function compileDomain(p: Program): IrDocument | undefined {
  const models: Model[] = [];
  const ops: Operation[] = [];
  navigateProgram(p, {
    model(m) { if (metadata(p,"entity",m)) models.push(m); },
    operation(op) { ops.push(op); },
  });
  let invalid = false;
  const reject = (code: string, message: string, target: Type) => {
    invalid=true; report(p,code,message,target);
  };
  if (!models.length) return reject("empty","No @entity models found",p.getGlobalNamespaceType()), undefined;

  const namespaces = new Set(models.map((m)=>m.namespace));
  const entities: IrEntity[] = [];
  for (const m of models) {
    const fields: IrField[] = [];
    const publicKeys: string[] = [];
    for (const prop of m.properties.values()) {
      const value = field(p,prop);
      if (!value) {
        reject("unsupported-field","Unsupported field type on " + m.name + "." + prop.name,prop);
        continue;
      }
      if (metadata(p,"publicIdentity",prop)) publicKeys.push(prop.name);
      if(value.computedDiscountedTotal!==undefined&&value.type!=="decimal")
        reject("invalid-computed-discounted-total",m.name+"."+prop.name+" total must be exact decimal",prop);
      if(value.computedRoundedProduct!==undefined&&value.type!=="decimal")
        reject("invalid-computed-rounded-product",m.name+"."+prop.name+" target must be exact decimal",prop);
      if(value.computedProduct!==undefined&&value.type!=="decimal")
        reject("invalid-computed-product",m.name+"."+prop.name+" target must be exact decimal",prop);
      if(value.type==="decimal"){
        const d=value.decimal,encoding=getEncode(p,prop);
        const valid=!!d&&Number.isInteger(d.precision)&&d.precision>=1&&d.precision<=38&&
          Number.isInteger(d.scale)&&d.scale>=0&&d.scale<=d.precision&&
          (d.min===undefined||decimalUnits(d.min,d.scale)!==undefined)&&
          (d.max===undefined||decimalUnits(d.max,d.scale)!==undefined)&&
          (d.min===undefined||d.min.split(".")[0].replace(/^-/,"").replace(/^0+/,"").length<=d.precision-d.scale)&&
          (d.max===undefined||d.max.split(".")[0].replace(/^-/,"").replace(/^0+/,"").length<=d.precision-d.scale)&&
          (d.min===undefined||d.max===undefined||decimalUnits(d.min,d.scale)!<=decimalUnits(d.max,d.scale)!)&&
          d.precision-d.scale>=0;
        if(!valid||encoding?.type.name!=="string"||encoding.encoding!==undefined||
           d!.precision-d!.scale<0||getMinValue(p,prop)!==undefined||getMaxValue(p,prop)!==undefined||
           value.unique||value.reference||value.initial||value.computedSum||value.choices||value.requiredWhen||value.forbidWhen||
           value.minLength!==undefined||value.maxLength!==undefined||value.pattern!==undefined||
           metadata(p,"publicIdentity",prop))
          reject("invalid-exact-decimal",m.name+"."+prop.name+
            " requires decimal with @encode(string), @exactDecimal(precision,scale,min?,max?) and valid exact bounds",prop);
      }else if(value.decimal||metadata(p,"exactDecimal",prop))
        reject("invalid-exact-decimal",m.name+"."+prop.name+" @exactDecimal requires TypeSpec decimal",prop);
      if(value.uiLabel!==undefined&&(value.uiLabel.trim()!==value.uiLabel||
         !value.uiLabel.length||value.uiLabel.length>90||/[\r\n<>]/.test(value.uiLabel)))
        reject("invalid-ui-label",m.name+"."+prop.name+" uiLabel must be a single-line 1..90 character display caption",prop);
      if(value.uiHelp!==undefined&&(value.uiHelp.trim()!==value.uiHelp||
         !value.uiHelp.length||value.uiHelp.length>240||/[\r\n<>]/.test(value.uiHelp)))
        reject("invalid-ui-help",m.name+"."+prop.name+" uiHelp must be a single-line 1..240 character description",prop);
      if(value.choices!==undefined&&(
        value.type!=="string"||value.unique||value.reference||value.computedSum||
        metadata(p,"publicIdentity",prop)||value.pattern!==undefined||
        value.choices.some(x=>x.value.length<(value.minLength??1)||
          x.value.length>(value.maxLength??255))||
        (value.initial!==undefined&&!value.choices.some(x=>x.value===value.initial))))
        reject("invalid-enum-field",m.name+"."+prop.name+
          " string enum must have distinct safe bounded values, no identity/reference, and declared initial value",prop);
      if(value.pattern!==undefined&&(value.pattern!=="^[0-9]{4}-(0[1-9]|1[0-2])$"||
         value.type!=="string"||value.minLength!==7||value.maxLength!==7))
        reject("unsupported-pattern",m.name+"."+prop.name+
          " requires a supported, portable YYYY-MM regex on seven-character string",prop);
      if(value.uiSection!==undefined&&(value.uiSection.trim()!==value.uiSection||
         value.uiSection.length<1||value.uiSection.length>64||/[\r\n<>]/.test(value.uiSection)||
         value.initial!==undefined||value.computedSum!==undefined))
        reject("invalid-ui-section",m.name+"."+prop.name+
          " section must be a trimmed, single-line 1..64 character title on an editable field",prop);
      if(value.uiPlaceholder!==undefined&&(value.uiPlaceholder.trim()!==value.uiPlaceholder||
         value.uiPlaceholder.length<1||value.uiPlaceholder.length>90||/[\r\n<>]/.test(value.uiPlaceholder)||
         !["string","decimal","int32"].includes(value.type)||
         value.reference!==undefined||value.choices!==undefined||
         value.initial!==undefined||value.computedSum!==undefined||
         value.uiControl==="month"))
        reject("invalid-ui-placeholder",m.name+"."+prop.name+
          " placeholder requires a short, plain example on a simple editable field",prop);
      if(value.uiControl!==undefined&&!((value.uiControl==="month"&&
         value.type==="string"&&value.minLength===7&&value.maxLength===7)||
        (value.uiControl==="textarea"&&value.type==="string"&&
         value.maxLength!==undefined&&value.maxLength>=1&&value.maxLength<=2000&&
         value.reference===undefined&&value.choices===undefined&&value.pattern===undefined&&
         value.initial===undefined&&value.computedSum===undefined&&
         !metadata(p,"publicIdentity",prop))))
        reject("invalid-ui-control",m.name+"."+prop.name+
          " uiControl requires a bounded YYYY-MM input or a <=2000 character plain textarea",prop);
      if (value.initial !== undefined &&
          (value.type !== "string" || !value.required || value.nullable ||
           value.unique || value.reference || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.initial) ||
           value.initial.length < (value.minLength ?? 1) ||
           value.initial.length > (value.maxLength ?? 255))) {
        reject("invalid-initial",m.name+"."+prop.name+" requires a valid required string state field",prop);
      }
      fields.push(value);
    }
    // Declarative strict UTC chronology; disallow identity/reference/computed fields.
    for(const end of fields.filter(f=>f.afterField!==undefined)){
      const source=fields.find(f=>f.name===end.afterField);
      if(!source||!end.afterField||!/^[A-Za-z][A-Za-z0-9_]*$/.test(end.afterField)||
        source===end||source.type!=="utcDateTime"||!source.required||source.nullable||
        source.afterField||end.type!=="utcDateTime"||end.nullable||
        end.unique||end.reference||end.initial||end.computedSum||end.requiredWhen||
        end.choices||end.decimal||metadata(p,"publicIdentity",
          m.properties.get(end.name)!))
        reject("invalid-after-field",m.name+"."+end.name+
          " must be a UTC date-time after a required, nonnullable sibling UTC date-time",m);
    }
    // Strict comparison remains typed and fail-closed, never an expression string.
    for(const greater of fields.filter(f=>f.greaterThanField!==undefined)){
      const source=fields.find(f=>f.name===greater.greaterThanField);
      if(!greater.greaterThanField||!/^[A-Za-z][A-Za-z0-9_]*$/.test(greater.greaterThanField)||
        !source||source===greater||!source.required||source.nullable||
        source.greaterThanField||source.computedSum||source.reference||
        !((source.type==="int32"&&greater.type==="int32")||
          (source.type==="decimal"&&greater.type==="decimal"&&source.decimal&&greater.decimal))||
        greater.nullable||greater.unique||greater.reference||
        greater.initial!==undefined||greater.computedSum||greater.requiredWhen||
        metadata(p,"publicIdentity",m.properties.get(greater.name)!))
        reject("invalid-greater-than-field",m.name+"."+greater.name+
          " must be an int32 or exact decimal strictly greater than a required sibling of the same type",m);
    }
    // A multiplication is exact only when the output scale and precision are
    // statically sufficient. PostgreSQL computes the value, not React/JS floats.
    for(const result of fields.filter(f=>f.computedProduct!==undefined)){
      const operands=result.computedProduct!;
      const left=fields.find(f=>f.name===operands[0]);
      const right=fields.find(f=>f.name===operands[1]);
      const a=left?.decimal,b=right?.decimal,c=result.decimal;
      if(operands.length!==2||operands.some(x=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(x))||
        !left||!right||left===right||left===result||right===result||
        left.type!=="decimal"||right.type!=="decimal"||result.type!=="decimal"||
        !left.required||!right.required||left.nullable||right.nullable||
        !result.required||result.nullable||result.unique||result.reference||
        result.initial!==undefined||result.computedSum||result.computedRoundedProduct||result.computedDiscountedTotal||result.requiredWhen||
        result.afterField||result.greaterThanField||
        left.computedProduct||right.computedProduct||left.computedRoundedProduct||
        right.computedRoundedProduct||left.computedDiscountedTotal||right.computedDiscountedTotal||
        left.computedSum||right.computedSum||
        left.reference||right.reference||left.greaterThanField||right.greaterThanField||
        !a||!b||!c||a.min!=="0"||b.min!=="0"||c.min!=="0"||
        a.precision+b.precision>38||c.precision!==a.precision+b.precision||
        c.scale!==a.scale+b.scale||
        metadata(p,"publicIdentity",m.properties.get(result.name)!))
        reject("invalid-computed-product",m.name+"."+result.name+
          " must multiply distinct required nonnegative decimals, with output precision "+
          "and scale equal to the sums of operand metadata (max 38)",m);
    }
    // Half-up matches PostgreSQL round(numeric,scale) for nonnegative operands.
    // One extra integer digit makes a carry on rounding provably safe.
    for(const result of fields.filter(f=>f.computedRoundedProduct!==undefined)){
      const spec=result.computedRoundedProduct!;
      const left=fields.find(f=>f.name===spec.left);
      const right=fields.find(f=>f.name===spec.right);
      const a=left?.decimal,b=right?.decimal,c=result.decimal;
      const integerDigits=a&&b?a.precision-a.scale+b.precision-b.scale+1:undefined;
      if(![spec.left,spec.right].every(s=>/^[A-Za-z][A-Za-z0-9_]*$/.test(s))||
        spec.mode!=="half_up"||!left||!right||left===right||left===result||right===result||
        left.type!=="decimal"||right.type!=="decimal"||result.type!=="decimal"||
        !left.required||!right.required||left.nullable||right.nullable||
        !result.required||result.nullable||result.unique||result.reference||
        result.initial!==undefined||result.computedSum||result.computedProduct||result.computedDiscountedTotal||
        result.requiredWhen||result.afterField||result.greaterThanField||
        left.computedRoundedProduct||right.computedRoundedProduct||
        left.computedDiscountedTotal||right.computedDiscountedTotal||
        left.computedProduct||right.computedProduct||left.computedSum||right.computedSum||
        left.reference||right.reference||left.greaterThanField||right.greaterThanField||
        !a||!b||!c||a.min!=="0"||b.min!=="0"||c.min!=="0"||
        c.max!==undefined||c.scale>=a.scale+b.scale||
        c.precision!==integerDigits!+c.scale||c.precision>38||
        metadata(p,"publicIdentity",m.properties.get(result.name)!))
        reject("invalid-computed-rounded-product",m.name+"."+result.name+
          " requires distinct required nonnegative decimal fields, explicit half_up mode, "+
          "scale reduction and output precision with a carry digit (max 38)",m);
    }
    // B2.3: a single generated PostgreSQL column, never a generated-on-generated dependency.
    for(const total of fields.filter(f=>f.computedDiscountedTotal!==undefined)){
      const rule=total.computedDiscountedTotal!;
      const names=[rule.price,rule.quantity,rule.discount];
      const values=names.map(name=>fields.find(f=>f.name===name));
      const [price,quantity,discount]=values;
      const a=price?.decimal,b=quantity?.decimal,d=discount?.decimal,out=total.decimal;
      const digits=a&&b?a.precision-a.scale+b.precision-b.scale+1:undefined;
      const invalidInput=(f:IrField|undefined)=>!f||f.type!=="decimal"||
        !f.required||f.nullable||f.reference||f.computedSum||f.computedProduct||
        f.computedRoundedProduct||f.computedDiscountedTotal||f.afterField||
        f.greaterThanField||f.requiredWhen;
      if(!names.every(n=>/^[A-Za-z][A-Za-z0-9_]*$/.test(n))||
        new Set(names).size!==3||rule.mode!=="half_up"||names.includes(total.name)||
        values.some(invalidInput)||!a||!b||!d||!out||
        a.min!=="0"||b.min!=="0"||d.min!=="0"||d.max!=="100"||
        total.type!=="decimal"||!total.required||total.nullable||total.unique||
        total.reference||total.initial!==undefined||total.computedSum||
        total.computedProduct||total.computedRoundedProduct||
        total.requiredWhen||total.afterField||total.greaterThanField||
        out.min!=="0"||out.max!==undefined||
        out.scale>=a.scale+b.scale+d.scale+2||
        out.precision!==digits!+out.scale||out.precision>38||
        metadata(p,"publicIdentity",m.properties.get(total.name)!))
        reject("invalid-computed-discounted-total",m.name+"."+total.name+
          " requires three distinct required decimal sources, 0..100 percent, "+
          "explicit half_up and carry-safe target precision up to 38",m);
    }
    // Conditional requirements are narrowly scoped, typed constraints, not arbitrary expressions.
    for(const conditionField of fields.filter(x=>x.requiredWhen!==undefined)){
      const {field:sourceName,equals}=conditionField.requiredWhen!;
      const source=fields.find(x=>x.name===sourceName);
      if(conditionField.type!=="string"||conditionField.required||
        conditionField.nullable||conditionField.unique||conditionField.reference||
        conditionField.computedSum||conditionField.initial!==undefined||
        conditionField.choices!==undefined||conditionField.name===sourceName||
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(sourceName)||
        !source||source.type!=="string"||source.nullable||source.initial!==undefined||
        !source.choices?.some(x=>x.value===equals)){
        reject("invalid-required-when",m.name+"."+conditionField.name+
          " requires an optional nonnullable string field and a sibling string enum with declared value",m);
      }
    }
    // Only a declared sibling enum equality may make a field forbidden.
    for(const target of fields.filter(x=>x.forbidWhen!==undefined)){
      const {field:sourceName,equals}=target.forbidWhen!;
      const source=fields.find(x=>x.name===sourceName);
      if(target.type!=="string"||target.required||target.nullable||target.unique||
        target.reference||target.initial!==undefined||target.computedSum||
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(sourceName)||target.name===sourceName||
        !source||source.type!=="string"||source.nullable||source.initial!==undefined||
        !source.choices?.some(x=>x.value===equals)||
        (target.requiredWhen?.field===sourceName&&target.requiredWhen.equals===equals))
        reject("invalid-forbid-when",m.name+"."+target.name+
          " needs an optional nonnullable string, sibling enum and noncontradictory rule",m);
    }
    for(const f of fields.filter(x=>x.computedSum!==undefined)) {
      const parts=f.computedSum!;
      const sources=parts.map(n=>fields.find(x=>x.name===n));
      const max=sources.reduce((n,x)=>n+(x?.max??0),0);
      if(f.name===publicKeys[0]||f.type!=="int32"||!f.required||f.nullable||f.unique||
        f.reference||f.initial!==undefined||parts.length<2||parts.length>8||
        new Set(parts).size!==parts.length||parts.some(n=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(n))||
        sources.some(x=>!x||x===f||x.type!=="int32"||!x.required||x.nullable||
          x.computedSum||x.min===undefined||x.min<0||!Number.isInteger(x.max))||
        max>2147483647||!Number.isSafeInteger(max)||
        (f.min!==undefined&&f.min>0)||(f.max!==undefined&&f.max<max))
        reject("invalid-computed-sum",m.name+"."+f.name+" must sum 2..8 distinct, bounded, nonnegative required int32 fields; total fits int32",m);
    }
    if (publicKeys.length !== 1) {
      reject("identity",m.name+" must declare exactly one @publicIdentity",m);
      continue;
    }
    const identity = fields.find((x) => x.name === publicKeys[0]);
    if (!identity || !identity.unique || !identity.required || identity.nullable) {
      reject("identity",m.name+" public key must be unique, non-null and required",m);
      continue;
    }
    const together=metadata(p,"uniqueTogether",m);
    let uniqueTogether: string[]|undefined;
    if(together){
      const raw=together.fields;
      const parts=typeof raw==="string"?raw.split(",").map(x=>x.trim()):[];
      const selected=parts.map(name=>fields.find(f=>f.name===name));
      if(parts.length<2||parts.length>4||
         parts.some(name=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))||
         new Set(parts).size!==parts.length||
         selected.some(f=>!f||!f.required||f.nullable||f.unique||
           f.name===publicKeys[0]||f.computedSum||f.computedProduct||
           f.computedRoundedProduct||f.computedDiscountedTotal||
           f.initial!==undefined||f.requiredWhen||f.forbidWhen||
           f.readCapability)){
        reject("invalid-unique-together",m.name+
          " @uniqueTogether requires 2..4 distinct, required, non-null, independent persisted fields",m);
      }else uniqueTogether=parts;
    }
    const conditionalUnique=metadata(p,"uniqueWhen",m);
    let uniqueWhen:IrEntity["uniqueWhen"]|undefined;
    if(conditionalUnique){
      const raw=conditionalUnique.fields;
      const parts=typeof raw==="string"?raw.split(",").map(x=>x.trim()):[];
      const stateField=String(conditionalUnique.stateField??"");
      const activeState=String(conditionalUnique.activeState??"");
      const state=fields.find(f=>f.name===stateField);
      const selected=parts.map(name=>fields.find(f=>f.name===name));
      if(metadata(p,"uniqueTogether",m)||parts.length<2||parts.length>4||
         parts.some(name=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))||
         new Set(parts).size!==parts.length||
         !/^[A-Za-z][A-Za-z0-9_]*$/.test(stateField)||
         !/^[a-z][a-z0-9_-]{0,63}$/.test(activeState)||
         !state||state.name===publicKeys[0]||state.unique||state.type!=="string"||
         !state.required||state.nullable||!state.initial||state.initial===activeState||
         state.reference||state.ownerManaged||state.computedSum||
         selected.some(f=>!f||!f.required||f.nullable||f.unique||
           f.name===publicKeys[0]||f.name===stateField||f.initial!==undefined||
           f.computedSum||f.computedProduct||f.computedRoundedProduct||
           f.computedDiscountedTotal||f.requiredWhen||f.forbidWhen||
           f.readCapability||f.ownerManaged)){
        reject("invalid-unique-when",m.name+
          " @uniqueWhen requires 2..4 distinct required non-null columns, a separate initial finite-state field and one safe active state",m);
      }else uniqueWhen={fields:parts,stateField,activeState};
    }
    const alert=metadata(p,"overdueAlert",m);
    if(alert){
      const due=fields.find(f=>f.name===alert.dueField);
      const state=fields.find(f=>f.name===alert.stateField);
      const recipient=fields.find(f=>f.name===alert.recipientField);
      const terminal=String(alert.terminalState??"");
      if(!due||due.type!=="utcDateTime"||!state||state.type!=="string"||
          !state.required||state.nullable||!state.initial||!recipient?.reference||
          recipient.type!=="string"||!recipient.required||recipient.nullable||
          recipient.reference.target===m.name||
          !/^[a-z][a-z0-9_-]{0,63}$/.test(terminal)||
          alert.channel!=="inbox"||due.name===state.name||due.name===recipient.name||
          state.name===recipient.name){
        reject("invalid-overdue-alert",m.name+" requires a UTC due field, finite-state field, terminal state, required recipient FK and inbox channel",m);
      }
    }
    const owners=fields.filter(x=>x.ownerManaged);
    const sensitive=fields.filter(x=>x.readCapability!==undefined);
    if(sensitive.length>2||sensitive.some(f=>!owners.length||f.name===identity.name||f.ownerManaged||
      f.type!=="string"||f.required||f.nullable||f.reference||f.unique||f.initial!==undefined||
      f.choices||f.computedSum||f.computedProduct||f.computedRoundedProduct||f.computedDiscountedTotal||
      f.requiredWhen||f.forbidWhen||f.afterField||f.greaterThanField||
      f.readCapability==="public"||
      !/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(f.readCapability??"")))
      reject("invalid-field-read-capability",m.name+" must use optional non-null scalar strings for sensitive owner fields",m);
    if(owners.length>1||owners.some(f=>f.name===identity.name||f.type!=="string"||!f.required||
      f.nullable||f.unique||f.reference||f.initial!==undefined||f.choices||f.computedSum||
      f.requiredWhen||f.forbidWhen||f.greaterThanField||f.pattern||
      (f.minLength??0)>1||(f.maxLength??255)<128))
      reject("invalid-owner-identity",m.name+" requires one dedicated required string owner field with maxLength >= 128",m);
    entities.push({
      name:m.name,publicIdentity:identity.name,fields,
      ...(uniqueTogether?{uniqueTogether}:{}),
      ...(uniqueWhen?{uniqueWhen}:{}),
      ...(metadata(p,"recipientIdentity",m)?{recipientIdentity:true}:{}),
      ...(metadata(p,"view",m)?.label !== undefined ? {view:String(metadata(p,"view",m)?.label)} : {}),
      ...(alert ? {overdueAlert:{
        dueField:String(alert.dueField),stateField:String(alert.stateField),
        terminalState:String(alert.terminalState),recipientField:String(alert.recipientField),
        channel:"inbox" as const
      }} : {}),
    });
  }
  for (const entity of entities) {
    for (const f of entity.fields) {
      if (!f.reference) continue;
      const target = entities.find(x=>x.name===f.reference?.target);
      const key = target?.fields.find(x=>x.name===target.publicIdentity);
      if (!target || !key || target.name===entity.name || f.type!=="string" ||
          f.nullable || !f.required || f.reference.onDelete!=="restrict" ||
          key.type!=="string" ||
          (f.maxLength!==undefined && key.maxLength!==undefined && f.maxLength < key.maxLength)) {
        reject("invalid-reference",entity.name+"."+f.name+
          " must reference another entity's public string identity with onDelete=restrict and sufficient length",
          models.find(m=>m.name===entity.name)!);
      }
    }
  }
  // S1d.2a: only a direct owner-to-owner child FK may cross private records.
  // Unowned-to-owned, owned-to-unowned, chains and multiple FKs remain forbidden.
  for(const entity of entities){
    const refs=entity.fields.filter(f=>f.reference);
    for(const f of refs){
      const target=entities.find(x=>x.name===f.reference?.target);
      const own=entity.fields.some(x=>x.ownerManaged),parentOwn=target?.fields.some(x=>x.ownerManaged);
      if(!own&&!parentOwn)continue;
      if(!own||!parentOwn||refs.length!==1||target!.fields.some(x=>x.reference)||
        f.ownerManaged||f.name===entity.publicIdentity||f.unique||f.initial!==undefined)
        reject("owner-cross-entity",entity.name+" supports only one required owner-scoped FK to a root owner-scoped parent",models.find(m=>m.name===entity.name)!);
    }
  }
  const operations: IrOperation[] = [];
  const relevant = ops.filter((x)=> namespaces.has(x.namespace));
  const declared = new Map(entities.map((x)=>[x.name,x]));
  for (const op of relevant) {
    const behavior = metadata(p,"behavior",op);
    const cap = metadata(p,"capability",op);
    if (!behavior || typeof behavior.kind !== "string") {
      reject("missing-behavior",op.name+" has no @behavior",op);continue;
    }
    if (!cap || typeof cap.name !== "string") {
      reject("missing-capability",op.name+" has no @capability",op);continue;
    }
    const kind = behavior.kind;
    const entity = declared.get(String(behavior.entity));
    if (!supported.includes(kind) || !entity) {
      reject("unsupported-behavior",op.name+" references unknown entity/behavior",op);continue;
    }
    if (cap.name === "public" && !["get","listPage","auditPage","health"].includes(kind)) {
      reject("public-write",op.name+" cannot expose mutation as public",op);continue;
    }
    const f = typeof behavior.field==="string" ? behavior.field : undefined;
    const input = typeof behavior.input==="string" ? behavior.input : undefined;
    if ((kind === "atomicIncrement" || kind === "patchFields") &&
      (!f || !input || !entity.fields.some((x)=>x.name===f))) {
      reject("behavior-field",op.name+" must bind a real entity field and input",op);continue;
    }
    if (kind === "atomicIncrement" && entity.fields.find((x)=>x.name===f)?.type !== "int32") {
      reject("atomic-type",op.name+" atomicIncrement requires an int32 field",op);continue;
    }
    const auditMeta = metadata(p,"audit",op);
    let auditFields: string[] | undefined;
    if (auditMeta) {
      const list = typeof auditMeta.fields==="string" ? auditMeta.fields.split(",") : [];
      const allowed = new Set(entity.fields.map(x=>x.name));
      if (!["create","transition","reassignReference","patchFields"].includes(kind) || !list.length || list.length>8 ||
          list.some(x=>x.length===0 || x.trim()!==x || !allowed.has(x)) ||
          new Set(list).size!==list.length ||
          (["transition","reassignReference","patchFields"].includes(kind) && (list.length!==1 || list[0]!==f)) ||
          (kind==="create" && list.includes(entity.publicIdentity))) {
        reject("invalid-audit",op.name+" must explicitly allowlist 1–8 supported entity fields (transition: state field only)",op);
        continue;
      }
      auditFields=list;
    }
    const release = metadata(p,"release",op);
    if (release) {
      const stock = declared.get(String(release.stockEntity));
      const available = stock?.fields.find(x=>x.name===release.availableField);
      const relation = entity.fields.find(x=>x.name===release.referenceField);
      const amount = entity.fields.find(x=>x.name===release.quantityField);
      const state = entity.fields.find(x=>x.name===f);
      const trans = metadata(p,"transition",op);
      if (kind!=="transition" || !state || !state.initial || trans?.from!==state.initial ||
          !stock || stock===entity || !available || available.type!=="int32" ||
          !available.required || available.nullable || (available.min??-1)<0 ||
          !relation || !relation.reference || relation.reference.target!==stock.name ||
          relation.type!=="string" || !relation.required || relation.nullable ||
          !amount || amount.type!=="int32" || !amount.required || amount.nullable ||
          (amount.min??-1)<1) {
        reject("invalid-release",op.name+" must release an initial-state reservation with positive units and a declared stock FK",op);
        continue;
      }
    }
    const reconciliation=metadata(p,"reconcileExact",op);
    if(kind==="reconcileExact"){
      const opening=entity.fields.find(x=>x.name===reconciliation?.openingField);
      const balance=entity.fields.find(x=>x.name===reconciliation?.availableField);
      const child=declared.get(String(reconciliation?.childEntity));
      const foreign=child?.fields.find(x=>x.name===reconciliation?.referenceField);
      const amount=child?.fields.find(x=>x.name===reconciliation?.amountField);
      const status=child?.fields.find(x=>x.name===reconciliation?.stateField);
      if(!reconciliation||!opening||!balance||opening===balance||
        opening.type!=="decimal"||balance.type!=="decimal"||!opening.decimal||!balance.decimal||
        !opening.required||opening.nullable||!balance.required||balance.nullable||
        opening.decimal.min!=="0"||balance.decimal.min!=="0"||
        opening.decimal.precision!==balance.decimal.precision||
        opening.decimal.scale!==balance.decimal.scale||
        !child||child===entity||!foreign?.reference||foreign.reference.target!==entity.name||
        !foreign.required||foreign.nullable||!amount||amount.type!=="decimal"||
        !status||status.initial!==reconciliation.postedState||
        reconciliation.postedState===reconciliation.reversedState||
        !Object.values(reconciliation).every(x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x))||
        f||input||auditMeta||release||metadata(p,"reserve",op)||metadata(p,"debitExact",op)||
        metadata(p,"reverseExact",op)||metadata(p,"transition",op)||
        op.parameters.properties.has("input")){
        reject("invalid-exact-reconciliation",op.name+" requires bounded exact opening/available fields and a matching decimal child ledger",op);
        continue;
      }
    }else if(reconciliation){
      reject("orphan-exact-reconciliation",op.name+" @reconcileExact must annotate reconcileExact behavior",op);continue;
    }
    const fullDetail=metadata(p,"detailSum",op);
    if(kind==="sumDetails"){
      const child=declared.get(String(fullDetail?.childEntity));
      const relation=child?.fields.find(x=>x.name===fullDetail?.parentField);
      const quantity=child?.fields.find(x=>x.name===fullDetail?.quantityField);
      if(!child||child===entity||!relation?.reference||
        relation.reference.target!==entity.name||!relation.required||relation.nullable||
        quantity?.type!=="int32"||!quantity.required||quantity.nullable||
        (quantity.min??0)<1||f!==undefined||input!==undefined||auditMeta||release||
        metadata(p,"transition",op)||metadata(p,"reserve",op)){
        reject("invalid-detail-sum",op.name+
          " requires an immutable required parent FK and a required positive int32 child quantity",op);
        continue;
      }
    }else if(fullDetail){
      reject("orphan-detail-sum",op.name+" @detailSum requires sumDetails behavior",op);continue;
    }
    const aggregate=metadata(p,"relatedSum",op);
    if(kind==="sumRelated"){
      const child=declared.get(String(aggregate?.childEntity));
      const relation=child?.fields.find(x=>x.name===aggregate?.referenceField);
      const amount=child?.fields.find(x=>x.name===aggregate?.quantityField);
      const state=child?.fields.find(x=>x.name===aggregate?.stateField);
      if(!child||child===entity||!relation?.reference||
         relation.reference.target!==entity.name||!relation.required||relation.nullable||
         !amount||amount.type!=="int32"||!amount.required||amount.nullable||(amount.min??0)<1||
         !state||state.type!=="string"||!state.required||state.nullable||
         state.initial!==aggregate?.activeState||
         !/^[a-z][a-z0-9_-]{0,63}$/.test(String(aggregate?.activeState))||
         f!==undefined||input!==undefined||auditMeta||release||
         metadata(p,"transition",op)||metadata(p,"reserve",op)){
        reject("invalid-related-sum",op.name+" requires a required positive int32 child quantity "+
          "with a FK to the parent and a guarded active state",op);continue;
      }
    }else if(aggregate){
      reject("orphan-related-sum",op.name+" @relatedSum requires sumRelated behavior",op);continue;
    }
    const reservation = metadata(p,"reserve",op);
    const details=metadata(p,"createDetails",op);
    let detailConfig:{childEntity:string;parentField:string;rowsField:string;maxRows:number}|undefined;
    if(details){
      const child=declared.get(String(details.childEntity));
      const relation=child?.fields.find(x=>x.name===details.parentField);
      const rowName=String(details.rowsField??"");
      const request=op.parameters.properties.get("input")?.type;
      const props=request?.kind==="Model"?request.properties:undefined;
      const rowProp=props?.get(rowName);
      const array=rowProp?.type;
      const item=array?.kind==="Model"&&array.indexer?.value.kind==="Model"?
        array.indexer.value:undefined;
      const itemProps=item?.properties;
      const reqFields=entity.fields.filter(x=>!x.computedSum&&!x.computedProduct&&
        !x.computedRoundedProduct&&!x.computedDiscountedTotal&&x.initial===undefined);
      const childFields=child?.fields.filter(x=>x.name!==details.parentField&&
        !x.computedSum&&!x.computedProduct&&!x.computedRoundedProduct&&!x.computedDiscountedTotal);
      const sameField=(a:IrField,b?:ModelProperty)=>{const parsed=b?field(p,b):undefined;
        return !!parsed&&a.type===parsed.type&&a.required===parsed.required&&
          a.nullable===parsed.nullable&&a.min===parsed.min&&a.max===parsed.max&&
          a.minLength===parsed.minLength&&a.maxLength===parsed.maxLength&&
          a.pattern===parsed.pattern&&
          JSON.stringify(a.decimal)===JSON.stringify(parsed.decimal)&&
          JSON.stringify(a.choices)===JSON.stringify(parsed.choices);};
      const valid=kind==="create"&&f===undefined&&input===undefined&&

        /^[A-Za-z][A-Za-z0-9_]*$/.test(rowName)&&
        !!child&&child!==entity&&!!relation&&
        relation.type==="string"&&relation.required&&!relation.nullable&&
        relation.reference?.target===entity.name&&relation.reference?.onDelete==="restrict"&&
        !entity.fields.some(x=>x.name===rowName||x.ownerManaged)&&
        !child.fields.some(x=>x.ownerManaged||x.initial!==undefined||
          x.reference&&x.name!==details.parentField)&&
        !!props&&props.size===reqFields.length+1&&
        reqFields.every(x=>sameField(x,props.get(x.name)))&&
        !!rowProp&&!rowProp.optional&&!!itemProps&&
        (getMinItems(p,rowProp)??-1)===1&&(getMaxItems(p,rowProp)??-1)===20&&
        !!childFields&&childFields.length>0&&
        itemProps.size===childFields.length&&
        childFields.every(x=>sameField(x,itemProps.get(x.name)))&&
        !metadata(p,"moveUnits",op)&&!metadata(p,"moveBatch",op)&&
        !metadata(p,"reserve",op)&&!metadata(p,"debitExact",op)&&
        !metadata(p,"reverseExact",op)&&!metadata(p,"reverseBatch",op)&&
        relevant.filter(x=>metadata(p,"behavior",x)?.kind==="create"&&
          metadata(p,"behavior",x)?.entity===entity.name).length===1;
      if(!valid){
        reject("invalid-create-details",op.name+
          " requires @minItems(1) @maxItems(20) typed nested child rows, "+
          " matching DTOs, and required restrict FK from child to parent",op);
        continue;
      }
      detailConfig={childEntity:child!.name,
        parentField:String(details.parentField),rowsField:rowName,maxRows:20};
    }
    const movement = metadata(p,"moveUnits",op);
    const multiMovement = metadata(p,"moveBatch",op);
    let batchLegs:{sourceField:string;targetField:string;quantityField:string}[]|undefined;
    if(multiMovement){
      const raw=String(multiMovement.legs??"");
      const parts=raw.split(";");
      const entries=parts.map(triple=>triple.split(","));
      const stock=declared.get(String(multiMovement.stockEntity));
      const available=stock?.fields.find(x=>x.name===multiMovement.availableField);
      const dto=op.parameters.properties.get("input")?.type;
      const props=dto?.kind==="Model"?dto.properties:undefined;
      const names=[entity.publicIdentity,...entries.flat()];
      const matched=!!props&&names.every(n=>{
        const original=entity.fields.find(x=>x.name===n);
        const prop=props.get(n);
        const actual=prop?field(p,prop):undefined;
        return !!original&&!!actual&&!prop?.optional&&!actual.nullable&&
          original.type===actual.type&&original.min===actual.min&&
          original.max===actual.max&&original.minLength===actual.minLength&&
          original.maxLength===actual.maxLength&&original.pattern===actual.pattern;
      });
      if(kind!=="create"||f!==undefined||input!==undefined||reservation||movement||
        metadata(p,"reserve",op)||release||metadata(p,"reverseUnits",op)||
        metadata(p,"debitExact",op)||metadata(p,"reverseExact",op)||
        metadata(p,"transition",op)||parts.length<2||parts.length>4||
        entries.some(x=>x.length!==3)||new Set(names).size!==names.length||
        names.some(x=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(x))||
        !stock||stock===entity||stock.fields.some(x=>x.ownerManaged)||
        entity.fields.some(x=>x.ownerManaged)||
        !available||available.type!=="int32"||!available.required||available.nullable||
        available.min!==0||available.max!==undefined&&available.max>2147483647||
        available.reference||available.computedSum||available.computedProduct||
        available.computedRoundedProduct||available.computedDiscountedTotal||
        !matched||entries.some(([from,to,quantity])=>{
          const s=entity.fields.find(x=>x.name===from),t=entity.fields.find(x=>x.name===to);
          const q=entity.fields.find(x=>x.name===quantity);
          return [s,t].some(x=>!x||x.type!=="string"||!x.required||x.nullable||
            x.reference?.target!==stock.name||x.reference.onDelete!=="restrict")||
            !q||q.type!=="int32"||!q.required||q.nullable||(q.min??0)<1;
        })){
        reject("invalid-move-batch",op.name+
          " needs 2–4 unique triples of typed positive quantities and required parent FKs with matching DTO",op);
        continue;
      }
      batchLegs=entries.map(([sourceField,targetField,quantityField])=>
        ({sourceField,targetField,quantityField}));
    }
    const reverseBatchMeta=metadata(p,"reverseBatch",op);
    let reverseBatchLegs:{sourceField:string;targetField:string;quantityField:string}[]|undefined;
    if(reverseBatchMeta){
      const raw=String(reverseBatchMeta.legs??"");
      const triples=raw.split(";").map(v=>v.split(","));
      const stock=declared.get(String(reverseBatchMeta.stockEntity));
      const available=stock?.fields.find(v=>v.name===reverseBatchMeta.availableField);
      const state=entity.fields.find(v=>v.name===f);
      const initial=entity.fields.filter(v=>v.initial!==undefined);
      const trans=metadata(p,"transition",op);
      const creators=relevant.filter(x=>{
        const meta=metadata(p,"behavior",x);
        const batch=metadata(p,"moveBatch",x);
        return meta?.kind==="create"&&meta?.entity===entity.name&&
          batch?.stockEntity===reverseBatchMeta.stockEntity&&
          batch?.availableField===reverseBatchMeta.availableField&&
          batch?.legs===reverseBatchMeta.legs;
      });
      const allReverse=relevant.filter(x=>!!metadata(p,"reverseBatch",x));
      const createInput=creators[0]?.parameters.properties.get("input")?.type;
      const prohibited=relevant.filter(x=>{
        const behavior=metadata(p,"behavior",x);
        return behavior?.entity===entity.name&&(
          !["create","get","listPage","queryPage","auditPage","transition","health"]
            .includes(String(behavior.kind))||
          behavior.kind==="transition"&&x!==op||
          behavior.kind==="create"&&x!==creators[0]);
      });
      const distinct=[entity.publicIdentity,...triples.flat()];
      if(kind!=="transition"||!state||state.type!=="string"||
        !state.required||state.nullable||state.initial!=="posted"||
        initial.length!==1||initial[0]!==state||
        trans?.from!=="posted"||trans?.to!=="reversed"||
        !auditFields||auditFields.length!==1||auditFields[0]!==f||
        creators.length!==1||allReverse.length!==1||prohibited.length>0||
        createInput?.kind!=="Model"||createInput.properties.has(state.name)||
        f===entity.publicIdentity||input!==undefined||release||reservation||
        movement||multiMovement||metadata(p,"reverseUnits",op)||
        metadata(p,"debitExact",op)||metadata(p,"reverseExact",op)||
        !stock||stock===entity||stock.fields.some(v=>v.ownerManaged)||
        entity.fields.some(v=>v.ownerManaged)||
        !available||available.type!=="int32"||available.nullable||
        !available.required||available.min!==0||
        triples.length<2||triples.length>4||
        triples.some(v=>v.length!==3)||new Set(distinct).size!==distinct.length||
        distinct.some(v=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(v))||
        triples.some(([source,target,units])=>{
          const a=entity.fields.find(v=>v.name===source);
          const b=entity.fields.find(v=>v.name===target);
          const c=entity.fields.find(v=>v.name===units);
          return [a,b].some(v=>!v||!v.required||v.nullable||
            v.type!=="string"||v.reference?.target!==stock.name||
            v.reference.onDelete!=="restrict")||
            !c||c.type!=="int32"||!c.required||c.nullable||(c.min??0)<1;
        })){
        reject("invalid-reverse-batch",op.name+
          " requires a unique matching immutable 2–4-leg journal, posted-to-reversed state transition and audit",op);
        continue;
      }
      reverseBatchLegs=triples.map(([sourceField,targetField,quantityField])=>({
        sourceField,targetField,quantityField
      }));
    }
    const reverseMovement = metadata(p,"reverseUnits",op);
    if(reverseMovement){
      const stock=declared.get(String(reverseMovement.stockEntity));
      const available=stock?.fields.find(x=>x.name===reverseMovement.availableField);
      const source=entity.fields.find(x=>x.name===reverseMovement.sourceField);
      const target=entity.fields.find(x=>x.name===reverseMovement.targetField);
      const quantity=entity.fields.find(x=>x.name===reverseMovement.quantityField);
      const state=entity.fields.find(x=>x.name===f);
      const trans=metadata(p,"transition",op);
      const sameRule=(x:any)=>["stockEntity","availableField","sourceField","targetField","quantityField"]
        .every(name=>x?.[name]===reverseMovement[name]);
      const creators=relevant.filter(x=>metadata(p,"behavior",x)?.kind==="create"&&
        metadata(p,"behavior",x)?.entity===entity.name&&sameRule(metadata(p,"moveUnits",x)));
      const creator=creators[0];
      const createDto=creator?.parameters.properties.get("input")?.type;
      const initFields=entity.fields.filter(x=>x.initial!==undefined);
      const invalidOps=relevant.filter(x=>metadata(p,"behavior",x)?.entity===entity.name &&
        !["create","get","listPage","transition","health"].includes(String(metadata(p,"behavior",x)?.kind)));
      const reverseOps=relevant.filter(x=>metadata(p,"reverseUnits",x));
      if(kind!=="transition"||!state||initFields.length!==1||initFields[0]!==state||
        state.type!=="string"||!state.required||state.nullable||state.initial!=="posted"||
        trans?.from!=="posted"||trans?.to!=="reversed"||
        !auditFields||auditFields.length!==1||auditFields[0]!==f||
        !stock||stock===entity||stock.fields.some(x=>x.ownerManaged)||
        entity.fields.some(x=>x.ownerManaged)||!available||
        available.type!=="int32"||!available.required||available.nullable||
        available.min!==0||!source||!target||source===target||
        [source,target].some(x=>x.type!=="string"||!x.required||x.nullable||
          x.reference?.target!==stock.name)||!quantity||quantity.type!=="int32"||
        !quantity.required||quantity.nullable||(quantity.min??0)<1||
        creators.length!==1||reverseOps.length!==1||invalidOps.length>0||
        createDto?.kind!=="Model"||createDto.properties.has(state.name)||
        release||reservation||movement||metadata(p,"debitExact",op)||metadata(p,"reverseExact",op)){
        reject("invalid-reverse-units",op.name+
          " requires a unique reversible move, immutable posted state, audited posted-to-reversed transition and no bypass mutations",op);
        continue;
      }
    }
    // B8: contract-only transfer between two distinct parent records, plus one immutable journal row.
    if(movement){
      const stock=declared.get(String(movement.stockEntity));
      const available=stock?.fields.find(x=>x.name===movement.availableField);
      const source=entity.fields.find(x=>x.name===movement.sourceField);
      const target=entity.fields.find(x=>x.name===movement.targetField);
      const amount=entity.fields.find(x=>x.name===movement.quantityField);
      const request=op.parameters.properties.get("input")?.type;
      const props=request?.kind==="Model"?request.properties:undefined;
      const all=[entity.publicIdentity,String(movement.sourceField),String(movement.targetField),
        String(movement.quantityField)];
      const dtoMatches=!!props&&all.every(n=>{
        const prop=props.get(n),original=entity.fields.find(x=>x.name===n);
        const parsed=prop?field(p,prop):undefined;
        return !!original&&!!parsed&&!prop?.optional&&
          parsed.type===original.type&&!parsed.nullable&&
          parsed.min===original.min&&parsed.max===original.max&&
          parsed.minLength===original.minLength&&parsed.maxLength===original.maxLength&&
          parsed.pattern===original.pattern;
      });
      if(kind!=="create"||f!==undefined||input!==undefined||reservation||release||
          metadata(p,"debitExact",op)||metadata(p,"reverseExact",op)||
          metadata(p,"transition",op)||!stock||stock===entity||
          stock.fields.some(x=>x.ownerManaged)||entity.fields.some(x=>x.ownerManaged)||
          !available||available.type!=="int32"||!available.required||available.nullable||
          available.min!==0||available.max!==undefined&&available.max>2147483647||
          available.reference||available.computedSum||available.computedProduct||
          available.computedRoundedProduct||available.computedDiscountedTotal||
          !source||!target||source===target||!amount||
          [source,target].some(x=>x.type!=="string"||!x.required||x.nullable||
            x.reference?.target!==stock.name||x.reference.onDelete!=="restrict")||
          amount.type!=="int32"||!amount.required||amount.nullable||
          (amount.min??-1)<1||!dtoMatches||new Set(all).size!==4){
        reject("invalid-move-units",op.name+" requires two distinct required parent FKs, positive int32 units, matching request DTO and nonnegative unowned stock",op);
        continue;
      }
    }
    const exactDebit = metadata(p,"debitExact",op);
    if(exactDebit){
      const wallet=declared.get(String(exactDebit.stockEntity));
      const balance=wallet?.fields.find(x=>x.name===exactDebit.availableField);
      const reference=entity.fields.find(x=>x.name===exactDebit.referenceField);
      const amount=entity.fields.find(x=>x.name===exactDebit.quantityField);
      const payload=op.parameters.properties.get("input")?.type;
      const props=payload?.kind==="Model"?payload.properties:undefined;
      const requestAmount=props?.get(String(exactDebit.quantityField));
      const requestReference=props?.get(String(exactDebit.referenceField));
      const requestId=props?.get(entity.publicIdentity);
      const bound=balance?.decimal,charge=amount?.decimal;
      if(kind!=="create"||f!==undefined||input!==undefined||reservation||release||
        metadata(p,"transition",op)||!wallet||wallet===entity||!balance||!amount||
        balance.type!=="decimal"||amount.type!=="decimal"||!bound||!charge||
        !balance.required||balance.nullable||!amount.required||amount.nullable||
        bound.min!=="0"||charge.min===undefined||decimalUnits(charge.min,charge.scale)===undefined||
        decimalUnits(charge.min,charge.scale)!<=0n||bound.scale!==charge.scale||
        bound.precision<charge.precision||balance.computedProduct||balance.computedRoundedProduct||
        balance.computedDiscountedTotal||balance.computedSum||amount.computedProduct||
        amount.computedRoundedProduct||amount.computedDiscountedTotal||amount.computedSum||
        !reference||reference.reference?.target!==wallet.name||!reference.required||reference.nullable||
        !requestReference||requestReference.optional||typeOfField(requestReference)?.type!=="string"||
        !requestAmount||requestAmount.optional||typeOfField(requestAmount)?.type!=="decimal"||
        !requestId||requestId.optional||typeOfField(requestId)?.type!=="string"){
        reject("invalid-exact-debit",op.name+" requires two required exact decimals with equal scale, positive debit, nonnegative balance, and a required parent FK",op);
        continue;
      }
    }
    if (reservation) {
      if (kind !== "create" || f !== undefined || input !== undefined) {
        reject("reserve-behavior",op.name+" @reserve must annotate a create operation",op);
        continue;
      }
      const stock = declared.get(String(reservation.stockEntity));
      const available = stock?.fields.find(x=>x.name===reservation.availableField);
      const relation = entity.fields.find(x=>x.name===reservation.referenceField);
      const amount = entity.fields.find(x=>x.name===reservation.quantityField);
      const payload = op.parameters.properties.get("input")?.type;
      const requestAmount = payload?.kind === "Model" ?
        payload.properties.get(String(reservation.quantityField)) : undefined;
      const requestRelation = payload?.kind === "Model" ?
        payload.properties.get(String(reservation.referenceField)) : undefined;
      const requestIdentity = payload?.kind === "Model" ?
        payload.properties.get(entity.publicIdentity) : undefined;
      if (!stock || stock===entity || !available || available.type!=="int32" ||
          !available.required || available.nullable || (available.min??-1)<0 ||
          !relation || relation.type!=="string" || !relation.reference ||
          relation.reference.target!==stock.name || !relation.required || relation.nullable ||
          !amount || amount.type!=="int32" || !amount.required || amount.nullable ||
          (amount.min??-1)<1 || payload?.kind!=="Model" ||
          !requestAmount || requestAmount.optional || typeOfField(requestAmount)?.type!=="int32" ||
          (getMinValue(p,requestAmount)??-1)<1 || !requestRelation ||
          requestRelation.optional || typeOfField(requestRelation)?.type!=="string" ||
          !requestIdentity || requestIdentity.optional ||
          typeOfField(requestIdentity)?.type!=="string") {
        reject("invalid-reserve",op.name+
          " must bind a required positive reservation amount and FK to a nonnegative stock field, with matching request inputs",op);
        continue;
      }
      // No arbitrary SQL or business expressions: only validated identifiers and integer fields.
    }
    const exactReverse=metadata(p,"reverseExact",op);
    if(exactReverse){
      const state=entity.fields.find(x=>x.name===f);
      const origin=metadata(p,"transition",op);
      if(kind!=="transition"||!state?.initial||origin?.from!==state.initial||
        input!==undefined||release||metadata(p,"reserve",op)||metadata(p,"debitExact",op)||
        !auditFields||auditFields.length!==1||auditFields[0]!==f||
        !Object.values(exactReverse).every(x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(x))){
        reject("invalid-exact-reversal",op.name+" requires a guarded initial-state transition, typed balance binding and state audit",op);
        continue;
      }
    }
    if (kind === "transition") {
      const state = f ? entity.fields.find((x)=>x.name===f) : undefined;
      const trans = metadata(p,"transition",op);
      const from = trans?.from, to = trans?.to;
      const validValue = (value: unknown) => typeof value === "string" &&
        /^[a-z][a-z0-9_-]{0,63}$/.test(value) && value.length > 0 && value.length >= (state?.minLength ?? 1) &&
        value.length <= (state?.maxLength ?? 255);
      if (!state || state.type !== "string" || !state.initial ||
          state.nullable || !state.required || !validValue(from) || !validValue(to) ||
          from === to || input !== undefined || op.parameters.properties.has("input")) {
        reject("invalid-transition",op.name+" must declare @transition(from,to) on an @initial string field, without a request body",op);
        continue;
      }
    }
    if (kind === "patchFields" && entity.fields.find((x)=>x.name===f)?.initial !== undefined) {
      reject("state-bypass",op.name+" cannot patch an @initial state field; use @transition",op);continue;
    }
    if (metadata(p,"transition",op) && kind !== "transition") {
      reject("orphan-transition",op.name+" uses @transition without transition behavior",op);continue;
    }
    if (kind === "atomicIncrement" || kind === "patchFields") {
      const payload = op.parameters.properties.get("input")?.type;
      if (payload?.kind !== "Model" || !payload.properties.has(input!)) {
        reject("behavior-input",op.name+" input field "+ input +" not found in request model",op);
        continue;
      }
      const value = payload.properties.get(input!)!;
      if(kind==="patchFields"&&auditFields){
        const old=payload.properties.get("expected");
        const parsed=old?field(p,old):undefined;
        const incoming=field(p,value);
        const target=entity.fields.find(x=>x.name===f);
        const scalarMatch=(v:IrField|undefined|null)=>!!v&&!!target&&
          v.type===target.type&&!v.nullable&&
          (target.type==="string"?
            v.minLength===target.minLength&&v.maxLength===target.maxLength&&
            v.pattern===target.pattern:
            v.min===target.min&&v.max===target.max);
        if(payload.properties.size!==2||!old||old.optional||value.optional||
          !target||!["string","int32"].includes(target.type)||
          target.reference||target.initial!==undefined||target.nullable||!target.required||
          target.ownerManaged||target.choices||target.computedSum||
          target.computedProduct||target.computedRoundedProduct||target.computedDiscountedTotal||
          (target.type==="int32"&&((target.min??0)<1||
            (target.max??2147483647)>1000000000))||
          !scalarMatch(incoming)||!scalarMatch(parsed)||
          incoming?.choices!==undefined||parsed?.choices!==undefined){
          reject("invalid-audited-patch",op.name+
            " needs required string or positive bounded int32 plus matching typed expected value",op);
          continue;
        }
      }
      if (kind === "atomicIncrement" &&
        (typeOfField(value)?.type !== "int32" || (getMinValue(p,value) ?? -1) < 1)) {
        reject("increment-input",op.name+" amount must be positive int32",op);continue;
      }
    }
    if(kind==="reassignReference"){
      const relation=f?entity.fields.find(x=>x.name===f):undefined;
      const payload=op.parameters.properties.get("input")?.type;
      const expected=payload?.kind==="Model"?payload.properties.get("expected"):undefined;
      const target=payload?.kind==="Model"?payload.properties.get(input??""):undefined;
      if(!relation?.reference||relation.type!=="string"||!relation.required||relation.nullable||
          f===entity.publicIdentity||input!==f||relation.initial!==undefined||
          payload?.kind!=="Model"||payload.properties.size!==2||!expected||!target||
          expected.optional||target.optional||typeOfField(expected)?.type!=="string"||
          typeOfField(target)?.type!=="string"||!auditFields||
          auditFields.length!==1||auditFields[0]!==f||
          metadata(p,"transition",op)||metadata(p,"reserve",op)||metadata(p,"release",op)){
        reject("invalid-reference-reassignment",op.name+
          " requires an existing required FK, one audited field and a body with required expected/current FK values",op);
        continue;
      }
    }
    if(kind!=="queryPage"&&(metadata(p,"queryOrder",op)||
       [...op.parameters.properties.values()].some(prop=>metadata(p,"queryFilter",prop)))){
      reject("orphan-query-decorator",op.name+" applies query decorators to a non-query operation",op);
      continue;
    }
    let queryFilters: {parameter:string;field:string;via?:string;operator:"eq"|"gte"|"lte"|"contains";type:IrField["type"]}[]|undefined;
    let querySort: {field:string;direction:"asc"|"desc"}|undefined;
    if(kind==="queryPage"){
      const sort=metadata(p,"queryOrder",op);
      const sortField=entity.fields.find(x=>x.name===sort?.field);
      const filterProperties=[...op.parameters.properties.values()].filter(x=>!!metadata(p,"queryFilter",x));
      const allowed=new Set(["limit","offset",...filterProperties.map(x=>x.name)]);
      if(f!==undefined||input!==undefined||auditMeta||reservation||release||
         metadata(p,"transition",op)||op.parameters.properties.has("input")||
         !sortField||!["asc","desc"].includes(String(sort?.direction))||
         !filterProperties.length||filterProperties.length>8||
         !op.parameters.properties.has("limit")||!op.parameters.properties.has("offset")||
         [...op.parameters.properties.keys()].some(key=>!allowed.has(key))||
         filterProperties.some(prop=>!prop.optional)){
        reject("query-shape",op.name+" must be read-only, sorted and bind 1–8 optional typed query filters",op);
        continue;
      }
      queryFilters=[];
      for(const prop of filterProperties){
        const meta=metadata(p,"queryFilter",prop);
        const segments=String(meta?.path??"").split(".");
        const operator=String(meta?.operator??"");
        const via=segments.length===2?entity.fields.find(x=>x.name===segments[0]):undefined;
        const target=via?.reference?declared.get(via.reference.target):undefined;
        const actual=(segments.length===1?entity:target)?.fields.find(x=>x.name===segments.at(-1));
        const propertyType=typeOfField(prop);
        if(segments.length>2||!["eq","gte","lte","contains"].includes(operator)||!actual||
           (segments.length===2&&(!via?.reference||!target))||
           propertyType?.type!==actual.type||propertyType?.nullable||
           (operator==="contains"?actual.type!=="string":operator!=="eq"&&!["int32","utcDateTime"].includes(actual.type))){
          reject("query-filter",op.name+"."+prop.name+" is not a typed, whitelisted local/one-hop FK filter",op);
          break;
        }
        queryFilters.push({parameter:prop.name,field:actual.name,
          ...(via?{via:via.name}:{}),operator:operator as "eq"|"gte"|"lte"|"contains",type:actual.type});
      }
      if(queryFilters.length!==filterProperties.length)continue;
      querySort={field:sortField.name,direction:sort?.direction as "asc"|"desc"};
    }
    if(kind==="auditPage"){
      if(f!==undefined||input!==undefined||op.parameters.properties.has("input")||
         metadata(p,"transition",op)||metadata(p,"reserve",op)||
         metadata(p,"release",op)||auditMeta){
        reject("audit-query-shape",op.name+" must be a read-only auditPage without mutation metadata",op);
        continue;
      }
    }
    const [http, diagnostics] = getHttpOperation(p,op);
    if (diagnostics.length) {
      reject("http",op.name+" has invalid TypeSpec HTTP binding",op);continue;
    }
    const statuses = http.responses.map((x)=>x.statusCodes).filter(
      (x):x is number => typeof x === "number").sort((a,b)=>a-b);
    if (!statuses.some((x)=>x>=200 && x<300)) {
      reject("http-status",op.name+" is missing a success status",op);continue;
    }
    if(details&&(http.verb!=="post"||http.parameters.body?.bodyKind!=="single"||
      ![201,400,401,403,409].every(x=>statuses.includes(x)))){
      reject("create-details-http",op.name+" requires POST JSON with 201/400/401/403/409",op);
      continue;
    }
    if(kind==="queryPage" && (http.verb!=="get"||http.parameters.body!==undefined||
         http.path.includes("{")||!statuses.includes(200)||!statuses.includes(400))){
      reject("query-http",op.name+" must be bounded GET with 200/400 and no body/path keys",op);
      continue;
    }
    if(kind==="inboxPage"||kind==="ackNotification"){
      const read=kind==="inboxPage";
      const allowed=read?["limit","offset"]:["notificationId"];
      const params=[...op.parameters.properties.keys()];
      const expected="/api/notifications/"+entity.name.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase()+
        (read?"":"/{notificationId}/ack");
      if(!entity.recipientIdentity||f||input||Object.keys(behavior).some(k=>!["kind","entity","field","input"].includes(k))||
         auditMeta||reservation||release||metadata(p,"transition",op)||metadata(p,"queryOrder",op)||
         http.parameters.body||http.verb!==(read?"get":"post")||http.path!==expected||
         params.length!==allowed.length||params.some(k=>!allowed.includes(k))||
         ![200,400,401,403,...(read?[]:[404])].every(code=>statuses.includes(code))){
        reject("recipient-inbox-shape",op.name+" requires explicit recipient identity and bounded inbox/ack HTTP binding",op);continue;
      }
    }
    if(kind==="auditPage"){
      const keys=[...http.path.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
      const allowedParams=new Set(["limit","offset",entity.publicIdentity]);
      if(http.verb!=="get"||http.parameters.body!==undefined||
         !statuses.includes(200)||!statuses.includes(400)||!statuses.includes(404)||
         keys.length!==1||keys[0]!==entity.publicIdentity||
         [...op.parameters.properties.keys()].some(x=>!allowedParams.has(x))||
         !op.parameters.properties.has("limit")||!op.parameters.properties.has("offset")){
        reject("audit-query-http",op.name+" requires bounded GET audit page, identity path, 200/400/404 and no body",op);continue;
      }
    }
    if(kind==="reassignReference" && (http.verb!=="patch"||
        http.parameters.body?.bodyKind!=="single"||
        ![200,400,404,409].every(status=>statuses.includes(status))||
        [...http.path.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]).join(",")!==entity.publicIdentity)){
      reject("reassign-http",op.name+" requires PATCH by identity, a JSON body and 200/400/404/409 responses",op);
      continue;
    }
    if(kind==="reconcileExact"){
      const keys=[...http.path.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
      const names=["openingBalance","available","postedTotal","reversedTotal","expectedAvailable","difference","postingCount","balanced"];
      const variants=op.returnType.kind==="Union"?[...op.returnType.variants.values()].map(v=>v.type):[op.returnType];
      const shape=variants.some(v=>v.kind==="Model"&&v.properties.size===names.length&&
        names.every(n=>{
          const prop=v.properties.get(n),type=prop?.type;
          return !!prop&&!prop.optional&&(n==="balanced"?
            type?.kind==="Scalar"&&type.name==="boolean":typeOfField(prop)?.type==="string");
        }));
      if(http.verb!=="get"||http.parameters.body||keys.length!==1||
        keys[0]!==entity.publicIdentity||op.parameters.properties.size!==1||
        ![200,401,403,404].every(s=>statuses.includes(s))||!shape){
        reject("exact-reconciliation-http",op.name+" needs keyed GET with typed eight-field snapshot and 200/401/403/404",op);
        continue;
      }
    }
    if(kind==="sumDetails"){
      const keys=[...http.path.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
      const results=op.returnType.kind==="Union"?
        [...op.returnType.variants.values()].map(v=>v.type):[op.returnType];
      if(http.verb!=="get"||http.parameters.body!==undefined||
         keys.length!==1||keys[0]!==entity.publicIdentity||
         op.parameters.properties.size!==1||
         !op.parameters.properties.has(entity.publicIdentity)||
         ![200,401,403,404].every(code=>statuses.includes(code))||
         !results.some(m=>m.kind==="Model"&&m.properties.size===1&&
           (m.properties.get("totalUnits")?typeOfField(m.properties.get("totalUnits")!):undefined)?.type==="string"&&
           m.properties.get("totalUnits")?.optional===false)){
        reject("detail-sum-http",op.name+" requires identity-keyed GET and {totalUnits:string}",op);
        continue;
      }
    }
    if(kind==="sumRelated"){
      const keys=[...http.path.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
      if(http.verb!=="get"||http.parameters.body!==undefined||
        keys.length!==1||keys[0]!==entity.publicIdentity||
        ![200,401,403,404].every(code=>statuses.includes(code))||
        op.parameters.properties.size!==1||
        !op.parameters.properties.has(entity.publicIdentity)){
        reject("related-sum-http",op.name+" needs GET keyed by parent identity, 200/401/403/404 and no body",op);
        continue;
      }
      // Reject contract response drift: exactly one required string named totalUnits.
      const responses=op.returnType.kind==="Union"?
        [...op.returnType.variants.values()].map(v=>v.type):[op.returnType];
      if(!responses.some(r=>r.kind==="Model"&&r.properties.size===1&&
        (r.properties.get("totalUnits")?typeOfField(r.properties.get("totalUnits")!):undefined)?.type==="string"&&
        r.properties.get("totalUnits")?.optional===false)){
        reject("related-sum-response",op.name+" must return {totalUnits: string} as the success body",op);
        continue;
      }
    }
    if(kind==="patchFields"&&auditFields&&
       (http.verb!=="patch"||![200,400,401,403,404,409].every(s=>statuses.includes(s)))){
      reject("audited-patch-http",op.name+" must declare 200/400/401/403/404/409",op);
      continue;
    }
    if (kind === "delete" && (!statuses.includes(204) || http.verb !== "delete")) {
      reject("delete-http",op.name+" must DELETE and return 204",op);continue;
    }
    if(reverseMovement){
      const keys=[...http.path.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
      if(![200,400,401,403,404,409].every(x=>statuses.includes(x))||
        http.verb!=="post"||http.parameters.body!==undefined||
        keys.length!==1||keys[0]!==entity.publicIdentity){
        reject("reverse-units-http",op.name+" must be keyed POST with no body and 200/400/401/403/404/409",op);
        continue;
      }
    }
    if (kind === "transition" && (!statuses.includes(200) || !statuses.includes(409) || http.verb !== "post" ||
         http.parameters.body !== undefined)) {
      reject("transition-http",op.name+" must POST without request body and return 200",op);continue;
    }
    if (exactDebit && (!statuses.includes(400)||!statuses.includes(409)||
        http.parameters.body?.bodyKind!=="single")){
      reject("exact-debit-http",op.name+" requires POST create with 201/400/409 and typed body",op);continue;
    }
    if(movement && (![201,400,401,403,409].every(x=>statuses.includes(x))||
        http.verb!=="post"||http.parameters.body?.bodyKind!=="single")){
      reject("move-units-http",op.name+" must declare POST 201/400/401/403/409 with one typed body",op);
      continue;
    }
    if(reverseBatchMeta){
      const keys=[...http.path.matchAll(/\{([^}]+)\}/g)].map(v=>v[1]);
      if(http.verb!=="post"||http.parameters.body!==undefined||keys.length!==1||
        keys[0]!==entity.publicIdentity||
        ![200,400,401,403,404,409].every(x=>statuses.includes(x))){
        reject("reverse-batch-http",op.name+
          " must be keyed POST without body and declare 200/400/401/403/404/409",op);
        continue;
      }
    }
    if(multiMovement&&(![201,400,401,403,409].every(x=>statuses.includes(x))||
        http.verb!=="post"||http.parameters.body?.bodyKind!=="single")){
      reject("move-batch-http",op.name+" must be POST with typed 201/400/401/403/409",op);
      continue;
    }
    if (reservation && (!statuses.includes(400) || !statuses.includes(409) ||
         http.parameters.body?.bodyKind!=="single")) {
      reject("reserve-http",op.name+" requires POST body with declared 201, 400 and 409 responses",op);
      continue;
    }
    if (kind === "create" && (!statuses.includes(201) || http.verb !== "post")) {
      reject("create-http",op.name+" must POST and return 201",op);continue;
    }
    // A scalar compound-key update is a single atomic PostgreSQL UPDATE.
    // The constraint arbitrates races; generated runtimes translate 23505 to
    // HTTP 409. Do not permit FK reassignment through the ordinary patch path.
    if(kind==="patchFields"&&entity.uniqueTogether?.includes(f??"")){
      const keyField=entity.fields.find(x=>x.name===f);
      const model=op.parameters.properties.get("input")?.type;
      const props=model?.kind==="Model"?model.properties:undefined;
      const fieldProp=props?.get(String(input));
      const actual=fieldProp?field(p,fieldProp):undefined;
      const expected=keyField;
      if(!expected||!actual||!statuses.includes(409)||
         !statuses.includes(400)||!statuses.includes(404)||
         http.verb!=="patch"||input!==f||!props||props.size!==1||
         !expected.required||expected.nullable||expected.type!=="string"||
         expected.reference||expected.ownerManaged||expected.initial!==undefined||
         expected.computedSum||expected.computedProduct||
         expected.computedRoundedProduct||expected.computedDiscountedTotal||
         actual.type!==expected.type||!actual.required||actual.nullable||
         actual.minLength!==expected.minLength||
         actual.maxLength!==expected.maxLength||
         actual.pattern!==expected.pattern||
         JSON.stringify(actual.choices)!==JSON.stringify(expected.choices)){
        reject("unique-together-patch-invalid",op.name+
          " must PATCH one non-FK required string compound-key field, preserve DTO constraints and declare 400/404/409",op);
        continue;
      }
    }
    if(kind==="create"&&entity.uniqueTogether){
      const request=op.parameters.properties.get("input")?.type;
      const props=request?.kind==="Model"?request.properties:undefined;
      let mismatch=false;
      for(const name of entity.uniqueTogether){
        const expected=entity.fields.find(x=>x.name===name)!;
        if(expected.ownerManaged)continue; // Server binds authenticated owner.
        const actualProp=props?.get(name);
        const actual=actualProp?field(p,actualProp):undefined;
        if(!actual||actual.type!==expected.type||!actual.required||actual.nullable||
          actual.minLength!==expected.minLength||actual.maxLength!==expected.maxLength||
          actual.min!==expected.min||actual.max!==expected.max||
          JSON.stringify(actual.decimal)!==JSON.stringify(expected.decimal)||
          JSON.stringify(actual.choices)!==JSON.stringify(expected.choices)||
          actual.pattern!==expected.pattern){
          reject("unique-together-request-mismatch",op.name+
            " must preserve compound unique key field "+name+" in CREATE DTO",op);
          mismatch=true;break;
        }
      }
      if(mismatch)continue;
    }
    // Create payloads must preserve time types and optionality for ordering rules.
    if(kind==="create"){
      const request=op.parameters.properties.get("input")?.type;
      const props=request?.kind==="Model"?request.properties:undefined;
      let mismatch=false;
      for(const order of entity.fields.filter(field=>field.afterField!==undefined)){
        const source=entity.fields.find(field=>field.name===order.afterField);
        if(!source){mismatch=true;break;}
        for(const expected of [order,source]){
          const actual=props?.get(expected.name);
          const parsed=actual?typeOfField(actual):undefined;
          if(!actual||parsed?.type!=="utcDateTime"||parsed.nullable!==expected.nullable||
             actual.optional===expected.required){
            reject("after-field-request-mismatch",op.name+" cannot weaken temporal field "+expected.name,op);
            mismatch=true;break;
          }
        }
        if(mismatch)break;
      }
      if(mismatch)continue;
    }
    // CREATE payloads must preserve both operands' type, decimal wire encoding, bounds and optionality.
    if(kind==="create"){
      const request=op.parameters.properties.get("input")?.type;
      const props=request?.kind==="Model"?request.properties:undefined;
      let mismatch=false;
      for(const compared of entity.fields.filter(field=>field.greaterThanField!==undefined)){
        const source=entity.fields.find(field=>field.name===compared.greaterThanField);
        for(const expected of [compared,source].filter(Boolean) as IrField[]){
          const dto=props?.get(expected.name);
          const actual=dto?field(p,dto):undefined;
          const encoding=dto?getEncode(p,dto):undefined;
          if(!dto||actual?.type!==expected.type||actual.nullable!==expected.nullable||
            dto.optional===expected.required||
            (expected.type==="int32"&&(actual.min!==expected.min||actual.max!==expected.max))||
            (expected.type==="decimal"&&(JSON.stringify(actual.decimal)!==JSON.stringify(expected.decimal)||
              encoding?.type.name!=="string"||encoding.encoding!==undefined))){
            reject("greater-than-request-mismatch",op.name+
              " must preserve compared field "+expected.name,op);
            mismatch=true;break;
          }
        }
        if(mismatch)break;
      }
      if(mismatch)continue;
    }
    // Exact decimal fields must retain encoding and constraints in CREATE input DTOs.
    if(kind==="create"){
      const request=op.parameters.properties.get("input")?.type;
      const props=request?.kind==="Model"?request.properties:undefined;
      let mismatch=false;
      for(const exact of entity.fields.filter(field=>field.type==="decimal"&&!field.computedProduct&&!field.computedRoundedProduct&&!field.computedDiscountedTotal)){
        const dto=props?.get(exact.name);
        const actual=dto?field(p,dto):undefined;
        const expected=exact.decimal;
        const encoding=dto?getEncode(p,dto):undefined;
        if(!dto||!actual||actual.type!=="decimal"||
           dto.optional!==!exact.required||actual.nullable!==exact.nullable||
           JSON.stringify(actual.decimal)!==JSON.stringify(expected)||
           encoding?.type.name!=="string"||encoding.encoding!==undefined){
          reject("decimal-request-mismatch",op.name+" must preserve decimal encoding and exact bounds for "+exact.name,op);
          mismatch=true;break;
        }
      }
      if(mismatch)continue;
      for(const computed of entity.fields.filter(field=>field.computedProduct||field.computedRoundedProduct||field.computedDiscountedTotal))
        if(props?.has(computed.name)){
          reject("computed-product-request",op.name+
            " must not accept read-only computed field "+computed.name,op);
          mismatch=true;
        }
      if(mismatch)continue;
    }
    // Source-declared enum membership must not be weakened in an HTTP request DTO.
    if(kind==="create"||kind==="patchFields"){
      const request=op.parameters.properties.get("input")?.type;
      const props=request?.kind==="Model"?request.properties:undefined;
      let mismatch=false;
      for(const choiceField of entity.fields.filter(field=>
        field.choices?.length&&(kind==="create"||field.name===f))){
        const dto=props?.get(choiceField.name);
        const dtoChoices=dto?typeOfField(dto)?.choices:undefined;
        if((!dto&&choiceField.required&&choiceField.initial===undefined)||dto&&(
           !dtoChoices||dto.optional!==!choiceField.required||
           dtoChoices.map(x=>x.value).join("\\0")!==choiceField.choices!.map(x=>x.value).join("\\0"))){
          reject("enum-request-mismatch",op.name+" request field "+choiceField.name+
            " must preserve TypeSpec enum values and optionality",op);
          mismatch=true;break;
        }
      }
      if(mismatch)continue;
    }
    if(kind==="create"||kind==="patchFields"){
      const guarded=entity.fields.filter(x=>x.requiredWhen||x.forbidWhen);
      const dto=op.parameters.properties.get("input")?.type;
      const properties=dto?.kind==="Model"?dto.properties:undefined;
      let mismatch=false;
      for(const target of guarded){
        if(kind==="patchFields"&&(target.name===f||target.requiredWhen?.field===f||target.forbidWhen?.field===f)){
          reject("conditional-patch-unsupported",op.name+
            " cannot patch conditional field or its enum trigger without a transactional rule-aware update",op);
          mismatch=true;break;
        }
        if(kind==="create"&&target.requiredWhen){
          const payload=properties?.get(target.name);
          if(!payload||!payload.optional||typeOfField(payload)?.type!=="string"||
            typeOfField(payload)?.choices||typeOfField(payload)?.nullable){
            reject("conditional-request-mismatch",op.name+
              " must preserve optional plain string field "+target.name+" in create DTO",op);
            mismatch=true;break;
          }
        }
        if(kind==="create"&&target.forbidWhen){
          const payload=properties?.get(target.name);
          const parsed=payload?typeOfField(payload):undefined;
          if(!payload||!payload.optional||parsed?.type!=="string"||parsed.nullable||
             JSON.stringify(parsed.choices??[])!==JSON.stringify(target.choices??[])){
            reject("forbid-request-mismatch",op.name+" must preserve optional "+target.name,op);
            mismatch=true;break;
          }
        }
      }
      if(mismatch)continue;
    }
    if(kind==="transition"){
      const state=entity.fields.find(field=>field.name===f);
      const allowed=state?.choices?.map(choice=>choice.value);
      if(allowed&&(!allowed.includes(String(metadata(p,"transition",op)?.from))||
         !allowed.includes(String(metadata(p,"transition",op)?.to)))){
        reject("enum-transition",op.name+" state transition contains a value absent from declared enum",op);
        continue;
      }
    }
    // B7: a single SQL UPDATE for all 2–4 members of a compound business key.
    // The database constraint arbitrates concurrent writers; no read-before-write.
    const patchSpec=metadata(p,"patchTogether",op);
    let patchNames:string[]|undefined;
    if(kind==="patchTogether"){
      const raw=patchSpec?.fields;
      const names=typeof raw==="string"?raw.split(",").map(x=>x.trim()):[];
      const expected=entity.uniqueTogether;
      const dto=op.parameters.properties.get("input")?.type;
      const props=dto?.kind==="Model"?dto.properties:undefined;
      const keys=[...http.path.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
      let valid=!!expected&&expected.length>=2&&expected.length<=4&&names.length===expected.length&&
        names.join(",")===expected.join(",")&&
        f===undefined&&input===undefined&&
        http.verb==="patch"&&http.parameters.body?.bodyKind==="single"&&
        keys.length===1&&keys[0]===entity.publicIdentity&&
        [200,400,401,403,404,409].every(code=>statuses.includes(code))&&
        !!props&&props.size===names.length&&names.every(n=>props.has(n))&&
        !entity.uniqueWhen;
      for(const n of names){
        const source=entity.fields.find(x=>x.name===n);
        const target=props?.get(n);
        const actual=target?field(p,target):undefined;
        if(!source||!actual||source.type!=="string"||!source.required||source.nullable||
          source.unique||source.reference||source.ownerManaged||source.readCapability||
          source.initial!==undefined||source.requiredWhen||source.forbidWhen||
          source.computedSum||source.computedProduct||source.computedRoundedProduct||
          source.computedDiscountedTotal||source.afterField||source.greaterThanField||
          target?.optional||actual.type!==source.type||actual.nullable||
          actual.minLength!==source.minLength||actual.maxLength!==source.maxLength||
          actual.pattern!==source.pattern||
          JSON.stringify(actual.choices)!==JSON.stringify(source.choices))
          valid=false;
      }
      if(!valid){
        reject("invalid-patch-together",op.name+
          " must PATCH exactly the 2–4 required editable string compound-key fields "+
          "with matching DTO constraints and 200/400/401/403/404/409",op);
        continue;
      }
      patchNames=names;
    }else if(patchSpec){
      reject("orphan-patch-together",op.name+" @patchTogether requires patchTogether behavior",op);
      continue;
    }
    operations.push({
      name:op.name,entity:entity.name,method:http.verb.toUpperCase(),path:http.path,
      behavior:{kind:kind as Kind,...(f?{field:f}:{}),...(patchNames?{input:patchNames.join(",")}:input?{input}:{}),...(auditFields?{audit:auditFields}:{}),
        ...(queryFilters?{filters:queryFilters,sort:querySort}:{}),
        ...(kind==="transition" ? {
          from:String(metadata(p,"transition",op)?.from),
          to:String(metadata(p,"transition",op)?.to)
        } : {}),
        ...(release ? {release:{
          stockEntity:String(release.stockEntity),
          availableField:String(release.availableField),
          referenceField:String(release.referenceField),
          quantityField:String(release.quantityField)
        }} : {}),
        ...(aggregate ? {relatedSum:{
          childEntity:String(aggregate.childEntity),
          referenceField:String(aggregate.referenceField),
          quantityField:String(aggregate.quantityField),
          stateField:String(aggregate.stateField),
          activeState:String(aggregate.activeState)
        }} : {}),
        ...(reconciliation ? {reconcileExact:{
          openingField:String(reconciliation.openingField),
          availableField:String(reconciliation.availableField),
          childEntity:String(reconciliation.childEntity),
          referenceField:String(reconciliation.referenceField),
          amountField:String(reconciliation.amountField),
          stateField:String(reconciliation.stateField),
          postedState:String(reconciliation.postedState),
          reversedState:String(reconciliation.reversedState)
        }} : {}),
        ...(exactReverse ? {reverseExact:{
          stockEntity:String(exactReverse.stockEntity),
          availableField:String(exactReverse.availableField),
          referenceField:String(exactReverse.referenceField),
          quantityField:String(exactReverse.quantityField)
        }} : {}),
        ...(exactDebit ? {debitExact:{
          stockEntity:String(exactDebit.stockEntity),
          availableField:String(exactDebit.availableField),
          referenceField:String(exactDebit.referenceField),
          quantityField:String(exactDebit.quantityField)
        }} : {}),
        ...(reservation ? {reserve:{
          stockEntity:String(reservation.stockEntity),
          availableField:String(reservation.availableField),
          referenceField:String(reservation.referenceField),
          quantityField:String(reservation.quantityField)
        }} : {}),
        ...(detailConfig ? {createDetails:detailConfig} : {}),
        ...(fullDetail ? {detailSum:{
          childEntity:String(fullDetail.childEntity),
          parentField:String(fullDetail.parentField),
          quantityField:String(fullDetail.quantityField)
        }} : {}),
        ...(movement ? {moveUnits:{
          stockEntity:String(movement.stockEntity),
          availableField:String(movement.availableField),
          sourceField:String(movement.sourceField),
          targetField:String(movement.targetField),
          quantityField:String(movement.quantityField)
        }} : {}),
        ...(multiMovement ? {moveBatch:{
          stockEntity:String(multiMovement.stockEntity),
          availableField:String(multiMovement.availableField),
          legs:batchLegs!
        }} : {}),
        ...(reverseBatchMeta ? {reverseBatch:{
          stockEntity:String(reverseBatchMeta.stockEntity),
          availableField:String(reverseBatchMeta.availableField),
          legs:reverseBatchLegs!
        }} : {}),
        ...(reverseMovement ? {reverseUnits:{
          stockEntity:String(reverseMovement.stockEntity),
          availableField:String(reverseMovement.availableField),
          sourceField:String(reverseMovement.sourceField),
          targetField:String(reverseMovement.targetField),
          quantityField:String(reverseMovement.quantityField)
        }} : {})},
      capability:String(cap.name), statuses,
      ...(http.parameters.body?.bodyKind === "single" &&
        http.parameters.body.type.kind === "Model" ?
        {request:http.parameters.body.type.name}:{}),
    });
  }
  // A partial unique index is only safe when a finite-state transition moves
  // into and out of the indexed state, and no patch/reassignment can mutate its
  // key outside that declarative workflow. PostgreSQL, not the UI, arbitrates races.
  for(const entity of entities.filter(e=>e.uniqueWhen)){
    const rule=entity.uniqueWhen!;
    const transitions=operations.filter(o=>o.entity===entity.name&&
      o.behavior.kind==="transition"&&o.behavior.field===rule.stateField);
    const enters=transitions.filter(o=>o.behavior.to===rule.activeState);
    const exits=transitions.filter(o=>o.behavior.from===rule.activeState);
    const unsafe=operations.some(o=>o.entity===entity.name&&(
      (o.behavior.kind==="patchFields"&&
       (rule.fields.includes(o.behavior.field??"")||o.behavior.field===rule.stateField))||
      (o.behavior.kind==="reassignReference"&&rule.fields.includes(o.behavior.field??""))));
    if(enters.length!==1||exits.length!==1||unsafe){
      reject("unique-when-lifecycle",entity.name+
        " needs exactly one entering and one exiting transition, and no direct PATCH/reassignment of partial-key fields",
        models.find(m=>m.name===entity.name)!);
    }
  }
  // S1a: isolated ownership must cover every exposed operation, not just GET.
  for(const entity of entities.filter(e=>e.fields.some(f=>f.ownerManaged))){
    const owner=entity.fields.find(f=>f.ownerManaged)!;
    const entityOps=operations.filter(o=>o.entity===entity.name&&o.behavior.kind!=="health");
    const scopedRead=entity.fields.filter(f=>f.readCapability);
    if(scopedRead.some(f=>entityOps.some(o=>o.capability===f.readCapability)||
      entityOps.some(o=>o.behavior.field===f.name)))
      reject("invalid-field-read-capability",entity.name+" needs independent read capability not reusable as operation or PATCH capability",models.find(m=>m.name===entity.name)!);
    const patches=entityOps.filter(o=>o.behavior.kind==="patchFields");
    const invalidPatch=patches.some(o=>{
      const target=entity.fields.find(x=>x.name===o.behavior.field);
      return !target||target.name===owner.name||target.name===entity.publicIdentity||
        target.type!=="string"||!target.required||target.nullable||target.reference||
        target.initial!==undefined||target.choices||target.computedSum||
        target.computedProduct||target.computedRoundedProduct||target.computedDiscountedTotal||
        target.requiredWhen||target.forbidWhen||target.pattern||
        o.behavior.input!==target.name||o.capability==="public"||
        o.capability===entityOps.find(x=>x.behavior.kind==="get")?.capability||
        o.capability===entityOps.find(x=>x.behavior.kind==="create")?.capability||
        ![200,400,401,403,404].every(status=>o.statuses.includes(status))||
        !!o.behavior.audit||!!o.behavior.reserve||!!o.behavior.release;
    });
    if(entityOps.some(o=>!["create","get","listPage","patchFields"].includes(o.behavior.kind))||
      ["create","get","listPage"].some(k=>entityOps.filter(o=>o.behavior.kind===k).length!==1)||
      patches.length>1||invalidPatch)
      reject("owner-unsupported-behavior",entity.name+" requires create/get/listPage and at most one independently authorized owner-guarded string PATCH",models.find(m=>m.name===entity.name)!);
    for(const patch of ops.filter(o=>entityOps.some(x=>x.name===o.name)&&metadata(p,"behavior",o)?.kind==="patchFields")){
      const meta=metadata(p,"behavior",patch);
      const target=entity.fields.find(x=>x.name===meta?.field);
      const request=patch.parameters.properties.get("input")?.type;
      const prop=request?.kind==="Model"?request.properties.get(target?.name??""):undefined;
      const parsed=prop?field(p,prop):undefined;
      if(request?.kind!=="Model"||request.properties.size!==1||!prop||prop.optional||
        !target||parsed?.type!==target.type||parsed?.nullable!==target.nullable||
        parsed.minLength!==target.minLength||parsed.maxLength!==target.maxLength||
        parsed.pattern!==target.pattern||parsed.choices||
        Object.keys(metadata(p,"ownerIdentity",prop)??{}).length>0)
        reject("owner-field-dto",patch.name+" must patch exactly its authorized field with unchanged constraints",patch);
    }
    for(const operation of ops.filter(o=>entityOps.some(x=>x.name===o.name)&&metadata(p,"behavior",o)?.kind==="create")){
      const payload=operation.parameters.properties.get("input")?.type;
      if(payload?.kind!=="Model"||payload.properties.has(owner.name))
        reject("owner-request-spoof",operation.name+" client request must omit server-managed "+owner.name,operation);
    }
  }
  // A B2.5 exact reversal must be paired with one original debit. It cannot
  // be bypassed by a second transition, reassigning its FK or deleting the ledger.
  for(const reverse of operations.filter(o=>o.behavior.reverseExact)){
    const r=reverse.behavior.reverseExact!;
    const originals=operations.filter(o=>o.entity===reverse.entity&&o.behavior.debitExact&&
      Object.entries(r).every(([key,value])=>(o.behavior.debitExact as unknown as Record<string,string>)[key]===value));
    const alternative=operations.some(o=>o.entity===reverse.entity&&
      ((o.behavior.kind==="transition"&&o!==reverse&&
        (o.behavior.field===reverse.behavior.field||o.behavior.from===reverse.behavior.to))||
      o.behavior.kind==="delete"||o.behavior.kind==="reassignReference"));
    if(originals.length!==1||alternative){
      reject("exact-reversal-lifecycle",reverse.name+" needs exactly one matching debit and terminal reversal, with no ledger deletion or reassignment",ops.find(o=>o.name===reverse.name)!);
    }
  }
  // B16: a declared dynamic detail may expose up to three independent
  // audited, optimistic, distinct scalar-field editors; never owner-scoped.
  // optimistic, audited text patch. Never allow direct FK/identity rewrites.
  for(const creator of operations.filter(o=>o.behavior.createDetails)){
    const cfg=creator.behavior.createDetails!;
    const patches=operations.filter(o=>o.entity===cfg.childEntity&&o.behavior.kind==="patchFields");
    if(patches.length>3||
       new Set(patches.map(o=>o.behavior.field)).size!==patches.length||
       new Set(patches.map(o=>o.capability)).size!==patches.length)
      reject("detail-edit-duplicate",creator.name+
        " requires at most three distinct audited editable child fields",ops.find(o=>o.name===creator.name)!);
    for(const mut of operations.filter(o=>o.entity===cfg.childEntity&&
      !["create","get","listPage","queryPage","auditPage","health"].includes(o.behavior.kind))){
      const child=entities.find(x=>x.name===cfg.childEntity);
      const field=child?.fields.find(x=>x.name===mut.behavior.field);
      if(mut.behavior.kind!=="patchFields"||!field||
        field.name===child?.publicIdentity||field.name===cfg.parentField||
        !["string","int32"].includes(field.type)||
        (field.type==="int32"&&((field.min??0)<1||
          (field.max??2147483647)>1000000000))||
        field.reference||!field.required||field.nullable||
        field.initial!==undefined||mut.behavior.audit?.length!==1||
        mut.behavior.audit[0]!==field.name||
        !mut.capability||mut.capability==="public"||
        mut.capability===operations.find(o=>o.entity===cfg.childEntity&&
          o.behavior.kind==="get")?.capability)
        reject("detail-edit-lifecycle",mut.name+
          " cannot mutate a child except an optimistic audited bounded scalar field",
          ops.find(o=>o.name===mut.name)!);
    }
  }
  // B14: the sum is linked to exactly one bounded dynamic detail creator, not an arbitrary join.
  for(const summary of operations.filter(x=>x.behavior.kind==="sumDetails")){
    const cfg=summary.behavior.detailSum!;
    const creator=operations.filter(x=>x.entity===summary.entity&&
      x.behavior.kind==="create"&&
      x.behavior.createDetails?.childEntity===cfg.childEntity&&
      x.behavior.createDetails?.parentField===cfg.parentField);
    const headRead=operations.find(x=>x.entity===summary.entity&&x.behavior.kind==="get");
    const childRead=operations.find(x=>x.entity===cfg.childEntity&&x.behavior.kind==="get");
    if(creator.length!==1||!headRead||!childRead||
      summary.capability!==headRead.capability||
      childRead.capability==="public")
      reject("detail-sum-lifecycle",summary.name+
        " needs one matching @createDetails and both non-public reader capabilities",
        ops.find(x=>x.name===summary.name)!);
  }
  // A B2.4 summary is not a free-form join. Only summarize an authoritative
  // reserve/cancel lifecycle with matching child read permissions and state.
  for(const summary of operations.filter(o=>o.behavior.kind==="sumRelated")){
    const cfg=summary.behavior.relatedSum!;
    const reader=operations.find(o=>o.entity===cfg.childEntity&&o.behavior.kind==="get");
    const reservations=operations.filter(o=>o.entity===cfg.childEntity&&o.behavior.reserve&&
      o.behavior.reserve.stockEntity===summary.entity&&
      o.behavior.reserve.referenceField===cfg.referenceField&&
      o.behavior.reserve.quantityField===cfg.quantityField);
    const cancellations=operations.filter(o=>o.entity===cfg.childEntity&&o.behavior.release&&
      o.behavior.release.stockEntity===summary.entity&&
      o.behavior.release.referenceField===cfg.referenceField&&
      o.behavior.release.quantityField===cfg.quantityField&&
      o.behavior.kind==="transition"&&o.behavior.field===cfg.stateField&&
      o.behavior.from===cfg.activeState);
    const parentReader=operations.find(o=>o.entity===summary.entity&&o.behavior.kind==="get");
    if(!reader||reader.capability==="public"||!parentReader||
       summary.capability!==parentReader.capability||reservations.length!==1||cancellations.length!==1)
      reject("related-sum-lifecycle",summary.name+
        " requires a matching reserve/release lifecycle and two non-public entity readers",
        ops.find(x=>x.name===summary.name)!);
  }
  const inboxKinds=["inboxPage","ackNotification"];
  for(const entity of entities){
    const inboxOps=operations.filter(o=>o.entity===entity.name&&inboxKinds.includes(o.behavior.kind));
    if(!entity.recipientIdentity&&!inboxOps.length)continue;
    const pages=inboxOps.filter(o=>o.behavior.kind==="inboxPage"),acks=inboxOps.filter(o=>o.behavior.kind==="ackNotification");
    const source=entities.some(e=>e.overdueAlert&&e.fields.find(f=>f.name===e.overdueAlert?.recipientField)?.reference?.target===entity.name);
    if(!entity.recipientIdentity||!source||pages.length!==1||acks.length!==1||
       inboxOps.some(o=>o.capability==="public"||operations.some(other=>!inboxKinds.includes(other.behavior.kind)&&other.capability===o.capability))||
       pages[0]?.capability===acks[0]?.capability){
      reject("recipient-inbox-permissions",entity.name+" needs one independently authorized inbox/ack pair and a recipient source",models.find(m=>m.name===entity.name)!);
    }
  }
  for(const entity of entities){
    const auditPages=operations.filter(o=>o.entity===entity.name&&o.behavior.kind==="auditPage");
    if(auditPages.length>1)reject("audit-query-duplicate",entity.name+" declares multiple audit readers",models.find(m=>m.name===entity.name)!);
    for(const page of auditPages){
      const create=operations.find(o=>o.entity===entity.name&&o.behavior.kind==="create");
      const get=operations.find(o=>o.entity===entity.name&&o.behavior.kind==="get");
      if(!operations.some(o=>o.entity===entity.name&&o.behavior.audit?.length)||
         page.capability==="public"||!/^[_a-zA-Z][_a-zA-Z0-9.:-]{0,127}$/.test(page.capability)||
         page.capability===create?.capability||page.capability===get?.capability)
        reject("audit-query-capability",page.name+" needs audited operations and a separate non-public audit capability",models.find(m=>m.name===entity.name)!);
    }
  }
  for (const entity of entities) {
    for (const state of entity.fields.filter((x)=>x.initial !== undefined)) {
      const transitions=operations.filter((o)=>o.entity===entity.name &&
        o.behavior.kind==="transition" && o.behavior.field===state.name);
      if (!transitions.length) {
        reject("orphan-initial",entity.name+"."+state.name+" has @initial but no transitions",models.find((m)=>m.name===entity.name)!);
      }
      const names=new Set<string>();
      for (const operation of transitions) {
        const key=operation.behavior.from+"->"+operation.behavior.to;
        if(names.has(key))reject("duplicate-transition",entity.name+"."+state.name+" has duplicated "+key,models.find((m)=>m.name===entity.name)!);
        names.add(key);
      }
    }
  }
  for (const op of operations.filter(o=>o.behavior.release)) {
    const release=op.behavior.release!;
    const matchingCreates=operations.filter(o=>o.entity===op.entity &&
      o.behavior.kind==="create" && o.behavior.reserve &&
      Object.entries(release).every(([key,value])=>
        (o.behavior.reserve as unknown as Record<string,string>)[key]===value));
    const reverse=operations.find(o=>o.entity===op.entity &&
      o.behavior.kind==="transition" && o.behavior.field===op.behavior.field &&
      o.behavior.from===op.behavior.to);
    if (matchingCreates.length!==1 || reverse) {
      reject("release-invariant",op.name+
        " must have exactly one matching @reserve create operation and a terminal destination state",
        ops.find(x=>x.name===op.name)!);
    }
  }
  // A143: terminal state must be a real TypeSpec transition target.
  for(const e of entities.filter(e=>e.overdueAlert)){
    const policy=e.overdueAlert!;
    if(!operations.some(op=>op.entity===e.name&&op.behavior.kind==="transition"&&
         op.behavior.field===policy.stateField&&op.behavior.to===policy.terminalState)||
       operations.some(op=>op.entity===e.name&&op.behavior.kind==="transition"&&
         op.behavior.field===policy.stateField&&op.behavior.from===policy.terminalState)){
      reject("overdue-terminal",e.name+" overdue terminal state must be declared by a transition",
        models.find(m=>m.name===e.name)!);
    }
  }
  if (invalid) return undefined;
  return {
    irVersion:"vnext-a0.1",
    namespace:models[0].namespace?.name || "Unknown",
    entities:entities.sort((a,b)=>a.name.localeCompare(b.name)),
    operations:operations.sort((a,b)=>a.name.localeCompare(b.name)),
  };
}

export async function $onEmit(context: EmitContext): Promise<void> {
  const ir = compileDomain(context.program);
  if (!ir || context.program.compilerOptions.noEmit) return;
  const plan = planJhipster(ir);
  const out = context.emitterOutputDir;
  // Fail-closed for IR semantic defects. JDL is an explicitly partial projection.
  await emitFile(context.program,{
    path:resolvePath(out,"ir.json"),content:JSON.stringify(ir,null,2)+"\n",
  });
  await emitFile(context.program,{
    path:resolvePath(out,"entities.jdl"),content:emitJdl(ir),
  });
  await emitFile(context.program,{
    path:resolvePath(out,"jhipster-app.jdl"),content:emitJhipsterApplicationJdl(ir),
  });
  await emitFile(context.program,{
    path:resolvePath(out,"jhipster-capability-report.json"),
    content:JSON.stringify(plan,null,2)+"\n",
  });
}
