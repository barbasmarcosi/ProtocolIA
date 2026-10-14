import {
  emitFile, getMinLength, getMaxLength, getMinValue,
  getMaxValue, navigateProgram, resolvePath,
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
  ["create","get","listPage","patchFields","atomicIncrement","transition","delete","health"];

function typeOfField(prop: ModelProperty): { type: IrField["type"]; nullable: boolean } | null {
  let t: Type = prop.type;
  let nullable = false;
  if (t.kind === "Union") {
    const choices = [...t.variants.values()].map((x) => x.type);
    const values = choices.filter((x) => x.kind !== "Intrinsic" || x.name !== "null");
    nullable = values.length !== choices.length;
    if (!nullable || values.length !== 1) return null;
    t = values[0];
  }
  if (t.kind !== "Scalar") return null;
  const names: Record<string, IrField["type"]> = {
    string: "string", int32: "int32", utcDateTime: "utcDateTime",
  };
  return names[t.name] ? { type: names[t.name], nullable } : null;
}

function field(p: Program, prop: ModelProperty): IrField | null {
  const parsed = typeOfField(prop);
  if (!parsed) return null;
  return {
    name: prop.name, type: parsed.type, required: !prop.optional,
    nullable: parsed.nullable, unique: !!metadata(p,"unique",prop),
    ...(metadata(p,"initial",prop) ? {initial:String(metadata(p,"initial",prop)?.value)} : {}),
    ...(metadata(p,"reference",prop) ? {reference:{
      target:String(metadata(p,"reference",prop)?.entity),
      onDelete:String(metadata(p,"reference",prop)?.onDelete) as "restrict"
    }} : {}),
    ...(getMinLength(p,prop) !== undefined ? {minLength:getMinLength(p,prop)} : {}),
    ...(getMaxLength(p,prop) !== undefined ? {maxLength:getMaxLength(p,prop)} : {}),
    ...(getMinValue(p,prop) !== undefined ? {min:getMinValue(p,prop)} : {}),
    ...(getMaxValue(p,prop) !== undefined ? {max:getMaxValue(p,prop)} : {}),
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
      if (value.initial !== undefined &&
          (value.type !== "string" || !value.required || value.nullable ||
           value.unique || value.reference || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.initial) ||
           value.initial.length < (value.minLength ?? 1) ||
           value.initial.length > (value.maxLength ?? 255))) {
        reject("invalid-initial",m.name+"."+prop.name+" requires a valid required string state field",prop);
      }
      fields.push(value);
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
    entities.push({
      name:m.name,publicIdentity:identity.name,fields,
      ...(metadata(p,"view",m)?.label !== undefined ? {view:String(metadata(p,"view",m)?.label)} : {}),
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
    if (cap.name === "public" && !["get","listPage","health"].includes(kind)) {
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
    const [http, diagnostics] = getHttpOperation(p,op);
    if (diagnostics.length) {
      reject("http",op.name+" has invalid TypeSpec HTTP binding",op);continue;
    }
    const statuses = http.responses.map((x)=>x.statusCodes).filter(
      (x):x is number => typeof x === "number").sort((a,b)=>a-b);
    if (!statuses.some((x)=>x>=200 && x<300)) {
      reject("http-status",op.name+" is missing a success status",op);continue;
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
    operations.push({
      name:op.name,entity:entity.name,method:http.verb.toUpperCase(),path:http.path,
      behavior:{kind:kind as Kind,...(f?{field:f}:{}),...(input?{input}:{}),
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
