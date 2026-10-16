import {
  emitFile, getEncode, getMinLength, getMaxLength, getMinValue,
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
  ["create","get","listPage","auditPage","inboxPage","ackNotification","queryPage","patchFields","atomicIncrement","transition","reassignReference","delete","health"];

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
           value.unique||value.reference||value.initial||value.computedSum||value.choices||value.requiredWhen||
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
        result.initial!==undefined||result.computedSum||result.computedRoundedProduct||result.requiredWhen||
        result.afterField||result.greaterThanField||
        left.computedProduct||right.computedProduct||left.computedRoundedProduct||
        right.computedRoundedProduct||left.computedSum||right.computedSum||
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
        result.initial!==undefined||result.computedSum||result.computedProduct||
        result.requiredWhen||result.afterField||result.greaterThanField||
        left.computedRoundedProduct||right.computedRoundedProduct||
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
    entities.push({
      name:m.name,publicIdentity:identity.name,fields,
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
      if (!["create","transition","reassignReference"].includes(kind) || !list.length || list.length>8 ||
          list.some(x=>x.length===0 || x.trim()!==x || !allowed.has(x)) ||
          new Set(list).size!==list.length ||
          (["transition","reassignReference"].includes(kind) && (list.length!==1 || list[0]!==f)) ||
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
    const reservation = metadata(p,"reserve",op);
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
    if (kind === "delete" && (!statuses.includes(204) || http.verb !== "delete")) {
      reject("delete-http",op.name+" must DELETE and return 204",op);continue;
    }
    if (kind === "transition" && (!statuses.includes(200) || !statuses.includes(409) || http.verb !== "post" ||
         http.parameters.body !== undefined)) {
      reject("transition-http",op.name+" must POST without request body and return 200",op);continue;
    }
    if (reservation && (!statuses.includes(400) || !statuses.includes(409) ||
         http.parameters.body?.bodyKind!=="single")) {
      reject("reserve-http",op.name+" requires POST body with declared 201, 400 and 409 responses",op);
      continue;
    }
    if (kind === "create" && (!statuses.includes(201) || http.verb !== "post")) {
      reject("create-http",op.name+" must POST and return 201",op);continue;
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
      for(const exact of entity.fields.filter(field=>field.type==="decimal"&&!field.computedProduct&&!field.computedRoundedProduct)){
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
      for(const computed of entity.fields.filter(field=>field.computedProduct||field.computedRoundedProduct))
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
      const guarded=entity.fields.filter(x=>x.requiredWhen);
      const dto=op.parameters.properties.get("input")?.type;
      const properties=dto?.kind==="Model"?dto.properties:undefined;
      let mismatch=false;
      for(const target of guarded){
        if(kind==="patchFields"&&(target.name===f||target.requiredWhen!.field===f)){
          reject("conditional-patch-unsupported",op.name+
            " cannot patch conditional field or its enum trigger without a transactional rule-aware update",op);
          mismatch=true;break;
        }
        if(kind==="create"){
          const payload=properties?.get(target.name);
          if(!payload||!payload.optional||typeOfField(payload)?.type!=="string"||
            typeOfField(payload)?.choices||typeOfField(payload)?.nullable){
            reject("conditional-request-mismatch",op.name+
              " must preserve optional plain string field "+target.name+" in create DTO",op);
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
    operations.push({
      name:op.name,entity:entity.name,method:http.verb.toUpperCase(),path:http.path,
      behavior:{kind:kind as Kind,...(f?{field:f}:{}),...(input?{input}:{}),...(auditFields?{audit:auditFields}:{}),
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
        ...(reservation ? {reserve:{
          stockEntity:String(reservation.stockEntity),
          availableField:String(reservation.availableField),
          referenceField:String(reservation.referenceField),
          quantityField:String(reservation.quantityField)
        }} : {})},
      capability:String(cap.name), statuses,
      ...(http.parameters.body?.bodyKind === "single" &&
        http.parameters.body.type.kind === "Model" ?
        {request:http.parameters.body.type.name}:{}),
    });
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
