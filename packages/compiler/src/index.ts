import {
  emitFile, getMinLength, getMaxLength, getMinValue,
  getMaxValue, navigateProgram, resolvePath,
  type EmitContext, type Model, type ModelProperty, type Operation, type Type,
  type Program,
} from "@typespec/compiler";
import { getHttpOperation } from "@typespec/http";
import { readDomainDecorator } from "@protocolia/domain";
import { emitJdl, planJhipster, type IrDocument, type IrEntity, type IrField,
  type IrOperation } from "@protocolia/jhipster";

const metadata = (p: Program, name: string, target: Type) =>
  readDomainDecorator(p, name, target);
type Kind = IrOperation["behavior"]["kind"];
const supported: readonly string[] =
  ["create","get","listPage","patchFields","atomicIncrement","health"];

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
    if (kind === "create" && (!statuses.includes(201) || http.verb !== "post")) {
      reject("create-http",op.name+" must POST and return 201",op);continue;
    }
    operations.push({
      name:op.name,entity:entity.name,method:http.verb.toUpperCase(),path:http.path,
      behavior:{kind:kind as Kind,...(f?{field:f}:{}),...(input?{input}:{})},
      capability:String(cap.name), statuses,
      ...(http.parameters.body?.bodyKind === "single" &&
        http.parameters.body.type.kind === "Model" ?
        {request:http.parameters.body.type.name}:{}),
    });
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
    path:resolvePath(out,"jhipster-capability-report.json"),
    content:JSON.stringify(plan,null,2)+"\n",
  });
}
