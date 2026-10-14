import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "templates");
const j = (v) => JSON.stringify(v);
const n = (v) => typeof v === "number" && Number.isInteger(v) ? String(v) : "null";
function name(value) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw Error("Unsafe identifier " + JSON.stringify(value));
  return value;
}
const snake = (v) => name(v).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const resolveRef = (obj, value) => {
  if (value?.$ref) return value.$ref.split("/").slice(1).reduce((current, key) => current?.[key], obj);
  return value;
};
function queryParameter(spec, op, parameter) {
  const source = resolveRef(spec,spec.paths[op.path][op.method.toLowerCase()].parameters.find((p) => {
    const d = resolveRef(spec,p); return d?.name === parameter && d?.in === "query";
  }));
  const schema = resolveRef(spec,source?.schema);
  if (!schema || !Number.isInteger(schema.default) || !Number.isInteger(schema.minimum) ||
      !Number.isInteger(schema.maximum)) throw Error("Unresolved query bounds/default for " + op.name + "." + parameter);
  return schema;
}
function inputBounds(spec, op) {
  const operation = spec.paths[op.path]?.[op.method.toLowerCase()];
  const requestBody = resolveRef(spec,operation?.requestBody);
  const schema = resolveRef(spec,requestBody?.content?.["application/json"]?.schema);
  const field = resolveRef(spec,schema?.properties?.[op.behavior.input]);
  if (!field || !Number.isInteger(field.minimum) || !Number.isInteger(field.maximum))
    throw Error("Unresolved atomic increment input bounds from TypeSpec OpenAPI");
  return field;
}
export function generate(ir, openapi, outDir) {
  if(ir.irVersion !== "vnext-a0.1") throw Error("Unsupported canonical IR version");
  if(!Array.isArray(ir.entities)||ir.entities.length===0||ir.entities.length>8)
    throw Error("Modular A4 supports 1–8 entities");
  const entities=ir.entities;
  const entityMap=new Map();
  const tableNames=new Set();
  for(const e of entities){
    name(e.name);
    if(entityMap.has(e.name)||tableNames.has(snake(e.name)))
      throw Error("Duplicate entity or SQL table identifier");
    entityMap.set(e.name,e);
    tableNames.add(snake(e.name));
    const identity=e.fields.find(f=>f.name===e.publicIdentity);
    if(!identity||identity.type!=="string"||!identity.unique||!identity.required||identity.nullable)
      throw Error("External identity must be a required unique string");
    const cols=new Set();
    for(const f of e.fields){
      name(f.name);
      if(cols.has(snake(f.name)))throw Error("Duplicate SQL column identifier");
      cols.add(snake(f.name));
      if(!["string","int32","utcDateTime"].includes(f.type))
        throw Error("Unsupported field type: "+f.type);
    }
  }
  for(const e of entities)for(const f of e.fields){
    if(!f.reference)continue;
    const parent=entityMap.get(f.reference.target);
    const pk=parent?.fields.find(x=>x.name===parent.publicIdentity);
    if(!parent||parent===e||f.reference.onDelete!=="restrict"||
       f.type!=="string"||!f.required||f.nullable||!pk||pk.type!=="string"||
       (f.maxLength??255)<(pk.maxLength??255))
      throw Error("Unsupported FK "+e.name+"."+f.name+": reference another entity's public identity with onDelete=restrict");
  }
  const supported = new Set(["create","get","listPage","patchFields","atomicIncrement","transition","delete","health"]);
  const methods = {create:"POST",get:"GET",listPage:"GET",patchFields:"PATCH",atomicIncrement:"PATCH",transition:"POST",delete:"DELETE",health:"GET"};
  const success = {create:201,get:200,listPage:200,patchFields:200,atomicIncrement:200,transition:200,delete:204,health:200};
  const ops = ir.operations;
  const routes = new Set();
  for(const op of ops){
    if(!supported.has(op.behavior.kind)) throw Error("Unsupported operation " + op.behavior.kind);
    const bound=entityMap.get(op.entity);
    if(!bound || !/^[A-Z]+$/.test(op.method) ||
      !/^\/[A-Za-z0-9_\/{}-]+$/.test(op.path)) throw Error("Unsupported routing/entity binding");
    if(op.method !== methods[op.behavior.kind] ||
       !Array.isArray(op.statuses) || !op.statuses.includes(success[op.behavior.kind]))
      throw Error("Contract HTTP verb/status mismatch in " + op.name);
    const key=bound.publicIdentity;
    const placeholders=[...op.path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(m=>m[1]);
    const requiresKey=["get","patchFields","atomicIncrement","transition","delete"].includes(op.behavior.kind);
    if(requiresKey && (placeholders.length!==1 || placeholders[0]!==key))
      throw Error("Public identity path must contain {" + key + "} in " + op.name);
    if(!requiresKey && placeholders.length!==0)
      throw Error("Unexpected route placeholders in " + op.name);
    const routeKey=op.method+" "+op.path;
    if(routes.has(routeKey))throw Error("Duplicate HTTP route: "+routeKey);
    routes.add(routeKey);
    if(op.capability==="public" && op.behavior.kind!=="health") throw Error("Anonymous operations not supported in this A0 profile");
    if(op.behavior.reserve){
      const r=op.behavior.reserve,stock=entityMap.get(r.stockEntity);
      const available=stock?.fields.find(x=>x.name===r.availableField);
      const relation=bound.fields.find(x=>x.name===r.referenceField);
      const amount=bound.fields.find(x=>x.name===r.quantityField);
      if(op.behavior.kind!=="create"||!stock||stock===bound||
         !available||available.type!=="int32"||!available.required||available.nullable||
         (available.min??-1)<0 || !relation || relation.type!=="string" ||
         relation.reference?.target!==stock.name || !relation.required || relation.nullable ||
         !amount || amount.type!=="int32" || !amount.required || amount.nullable ||
         (amount.min??-1)<1 || !op.statuses.includes(400)||!op.statuses.includes(409))
        throw Error("Invalid atomic cross-entity reserve "+op.name);
    }
    if(op.behavior.release){
      const r=op.behavior.release,stock=entityMap.get(r.stockEntity);
      const available=stock?.fields.find(x=>x.name===r.availableField);
      const relation=bound.fields.find(x=>x.name===r.referenceField);
      const amount=bound.fields.find(x=>x.name===r.quantityField);
      const state=bound.fields.find(x=>x.name===op.behavior.field);
      const matching=ops.filter(x=>x.entity===bound.name && x.behavior.kind==="create" &&
        x.behavior.reserve && Object.keys(r).every(k=>x.behavior.reserve[k]===r[k]));
      if(op.behavior.kind!=="transition"||!state?.initial||
         op.behavior.from!==state.initial||!stock||stock===bound||
         !available||available.type!=="int32"||!available.required||available.nullable||(available.min??-1)<0||
         !relation||relation.reference?.target!==stock.name||relation.type!=="string"||!relation.required||relation.nullable||
         !amount||amount.type!=="int32"||!amount.required||amount.nullable||(amount.min??-1)<1||
         matching.length!==1||
         ops.some(x=>x.entity===bound.name&&x.behavior.kind==="transition"&&
           x.behavior.field===state.name&&x.behavior.from===op.behavior.to))
        throw Error("Invalid exactly-once stock release "+op.name);
    }
    if(op.behavior.kind==="transition"){
      const f=bound.fields.find(x=>x.name===op.behavior.field);
      const b=op.behavior;
      const safe=x=>typeof x==="string" && /^[a-z][a-z0-9_-]{0,63}$/.test(x) &&
        x.length>=(f?.minLength??1) && x.length<=(f?.maxLength??255);
      if(!f||!f.initial||f.type!=="string"||!f.required||f.nullable||
        !safe(b.from)||!safe(b.to)||b.from===b.to||b.input)
        throw Error("Invalid guarded transition "+op.name);
      if(!op.statuses.includes(409))throw Error("Transition must declare 409 "+op.name);
    }
    if(["atomicIncrement","patchFields"].includes(op.behavior.kind)){
      const f=bound.fields.find(x=>x.name===op.behavior.field);
      if(!f||op.behavior.input!==op.behavior.field&&op.behavior.kind==="patchFields") throw Error("Unsupported field/input mapping");
      if(op.behavior.kind==="atomicIncrement"&&f.type!=="int32") throw Error("Atomic addition requires int32 field");
      if(op.behavior.kind==="patchFields"&&(f.type!=="string"||f.nullable||f.initial!==undefined))
        throw Error("Current patchFields runtime supports only non-null string fields");
    }
  }
  const byKind=(kind,entity)=>ops.filter(o=>o.behavior.kind===kind&&(!entity||o.entity===entity));
  if(byKind("health").length!==1)throw Error("Exactly one health operation required");
  const readCaps=[],writeCaps=[];
  for(const e of entities){
    for(const kind of ["create","get","listPage"])
      if(byKind(kind,e.name).length!==1)throw Error("Entity "+e.name+" requires one "+kind);
    for(const kind of ["patchFields","atomicIncrement","delete"])
      if(byKind(kind,e.name).length>1)throw Error("Duplicate "+kind+" for "+e.name);
    const read=byKind("get",e.name)[0].capability;
    const write=byKind("create",e.name)[0].capability;
    if(!read||!write||read===write||read==="public"||write==="public")
      throw Error("Invalid capabilities on "+e.name);
    if(!readCaps.includes(read))readCaps.push(read);
    if(!writeCaps.includes(write))writeCaps.push(write);
    for(const op of ops.filter(o=>o.entity===e.name&&o.behavior.kind!=="health")){
      const expected=["create","patchFields","atomicIncrement","transition","delete"].includes(op.behavior.kind)?write:read;
      if(op.capability!==expected)throw Error("Inconsistent capability on "+op.name);
    }
  }
  if(readCaps.some(x=>writeCaps.includes(x)))throw Error("Read/write authorities cannot overlap");
  if(existsSync(outDir) && readdirSync(outDir,{withFileTypes:true}).length>0)throw Error("Output is not empty; refusing to overwrite consumer files");
  const base="src/main/java/dev/protocolia/modular/";
  const outputs=[];
  function write(path,data) {
    const full=join(outDir,path);
    mkdirSync(dirname(full),{recursive:true});
    writeFileSync(full,data);
    outputs.push(path);
  }
  function copy(path,source) {
    const full=join(outDir,path);
    mkdirSync(dirname(full),{recursive:true});
    copyFileSync(join(toolRoot,source),full);
    outputs.push(path);
  }
  const classes=[
    "package dev.protocolia.modular;",
    "import java.util.List;",
    "public final class Manifest {",
    "  private Manifest() {}",
    "  public record Field(String name,String column,String type,boolean required,boolean nullable,Integer min,Integer max,Integer minLength,Integer maxLength,String referenceTarget,String initial) {}",
    "  public record Entity(String name,String table,String identity,String identityColumn,List<Field> fields) {}",
    "  public record Reserve(String stockTable,String stockKeyColumn,String availableColumn,String referenceField,String amountField,String stockWriteCapability) {}",
    "  public record Op(String name,String method,String path,String entity,String kind,String capability,String field,String input,int inputMin,int inputMax,int limitDefault,int limitMin,int limitMax,int offsetDefault,int offsetMax,String fromState,String toState,Reserve reserve,Reserve release) {}",
    "  public static final List<String> READ_CAPABILITIES=List.of("+readCaps.map(j).join(",")+");",
    "  public static final List<String> WRITE_CAPABILITIES=List.of("+writeCaps.map(j).join(",")+");",
    "  public static final List<Entity> ENTITIES=List.of(",
    entities.map(e=>{
      const parts=e.fields.map(f=>"      new Field("+[
        j(f.name),j(snake(f.name)),j(f.type),f.required,f.nullable,
        n(f.min),n(f.max),n(f.minLength),n(f.maxLength),f.reference?j(f.reference.target):"null",f.initial!==undefined?j(f.initial):"null"
      ].join(",")+")").join(",\n");
      return "    new Entity("+[j(e.name),j(snake(e.name)),j(e.publicIdentity),j(snake(e.publicIdentity))].join(",")+
        ",List.of(\n"+parts+"\n    ))";
    }).join(",\n"),
    "  );",
    "  public static final List<Op> OPS=List.of(",
  ];
  const mapped=ops.filter(op=>op.behavior.kind!=="health").map(op=>{
    const b=op.behavior;
    let mn=0,mx=0,ld=0,lmin=0,lmax=0,od=0,om=0;
    if(b.kind==="atomicIncrement"){
      const range=inputBounds(openapi,op);mn=range.minimum;mx=range.maximum;
    }
    if(b.kind==="listPage"){
      const l=queryParameter(openapi,op,"limit");
      const o=queryParameter(openapi,op,"offset");
      ld=l.default;lmin=l.minimum;lmax=l.maximum;od=o.default;om=o.maximum;
    }
    let reserve="null";
    if(b.reserve){
      const stock=entityMap.get(b.reserve.stockEntity);
      const stockWrite=byKind("create",stock.name)[0]?.capability;
      if(!stockWrite||stockWrite==="public")throw Error("Missing stock write capability");
      reserve="new Reserve("+[
        j(snake(stock.name)),j(snake(stock.publicIdentity)),j(snake(b.reserve.availableField)),
        j(b.reserve.referenceField),j(b.reserve.quantityField),j(stockWrite)
      ].join(",")+")";
    }
    let release="null";
    if(b.release){
      const stock=entityMap.get(b.release.stockEntity);
      const stockWrite=byKind("create",stock.name)[0]?.capability;
      if(!stockWrite||stockWrite==="public")throw Error("Missing stock write capability");
      release="new Reserve("+[
        j(snake(stock.name)),j(snake(stock.publicIdentity)),j(snake(b.release.availableField)),
        j(b.release.referenceField),j(b.release.quantityField),j(stockWrite)
      ].join(",")+")";
    }
    return "    new Op("+[j(op.name),j(op.method),j(op.path),j(op.entity),j(b.kind),
      j(op.capability),j(b.field??""),j(b.input??""),
      mn,mx,ld,lmin,lmax,od,om,j(b.from??""),j(b.to??""),reserve,release].join(",")+")";
  });
  classes.push(mapped.join(",\n"),"  );","}");
  write(base+"Manifest.java",classes.join("\n")+"\n");
  for(const filename of ["ContractApplication.java","SecurityConfig.java","DomainRuntime.java"]) copy(base+filename,filename);
  copy("pom.xml","pom.xml");
  copy("src/main/resources/application.properties","application.properties");
  const resources=entities.map(entity=>({
    entity,view:entity.view??entity.name,
    transitions:ops.filter(op=>op.entity===entity.name&&op.behavior.kind==="transition").map(op=>({name:op.name,method:op.method,path:op.path,capability:op.capability,behavior:op.behavior})),
    operations:Object.fromEntries(ops.filter(op=>op.entity===entity.name&&op.behavior.kind!=="health"&&op.behavior.kind!=="transition").map(op=>[
      op.behavior.kind,{method:op.method,path:op.path,capability:op.capability,behavior:op.behavior}
    ]))
  }));
  write("src/main/resources/static/protocolia-ui.json",JSON.stringify({
    ...resources[0], resources
  },null,2)+"\n");
  for(const file of [
    "package.json","index.html","vite.config.mjs",
    "src/main.jsx","src/App.jsx","src/style.css"
  ]) copy("web/"+file,"web/"+file);
  for(const file of ["Dockerfile","compose.yaml",".env.example",".dockerignore"])
    copy(file,file);
  const sql=[];
  for(const e of entities){
    const table=snake(e.name),key=e.publicIdentity;
    const columns=e.fields.map(f=>{
      const col=snake(f.name);
      const type=f.type==="string"?"VARCHAR("+(f.maxLength??255)+")":
        f.type==="int32"?"INTEGER":"TIMESTAMP WITH TIME ZONE";
      const checks=[];
      if(f.name===key)checks.push("PRIMARY KEY");
      if(f.required&&!f.nullable)checks.push("NOT NULL");
      if(f.unique&&f.name!==key)checks.push("UNIQUE");
      if(f.type==="string"&&f.minLength!==undefined)
        checks.push("CHECK (char_length("+col+") >= "+f.minLength+")");
      if(f.type==="string"&&f.required&&!f.nullable)
        checks.push("CHECK (char_length(btrim("+col+")) > 0)");
      if(f.min!==undefined)checks.push("CHECK ("+col+">="+f.min+")");
      if(f.max!==undefined)checks.push("CHECK ("+col+"<="+f.max+")");
      if(f.initial!==undefined){
        const values=new Set([f.initial,...ops.filter(op=>
          op.entity===e.name&&op.behavior.kind==="transition"&&op.behavior.field===f.name)
          .flatMap(op=>[op.behavior.from,op.behavior.to])]);
        if(values.size<2||[...values].some(x=>typeof x!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(x)))
          throw Error("Unresolved finite state values "+e.name+"."+f.name);
        checks.push("CHECK ("+col+" IN ("+[...values].sort().map(x=>"'"+x+"'").join(",")+"))");
      }
      return "  "+col+" "+type+" "+checks.join(" ");
    });
    sql.push("CREATE TABLE "+table+" (\n"+columns.join(",\n")+"\n);");
  }
  for(const e of entities)for(const f of e.fields){
    if(!f.reference)continue;
    const parent=entityMap.get(f.reference.target);
    sql.push("ALTER TABLE "+snake(e.name)+" ADD CONSTRAINT fk_"+snake(e.name)+"_"+
      snake(f.name)+" FOREIGN KEY ("+snake(f.name)+") REFERENCES "+
      snake(parent.name)+" ("+snake(parent.publicIdentity)+") ON DELETE RESTRICT;");
  }
  const signature=createHash("sha256").update(JSON.stringify(entities)).digest("hex");
  write("src/main/resources/db/migration/V1__contract_baseline.sql",
    "-- ProtocolIA schema SHA256 "+signature+" (generated from canonical IR)\n"+
    sql.join("\n")+"\n");
  const manifest={
    adapter:"modular-spring-a0",irVersion:ir.irVersion,sourceSha256:createHash("sha256").update(JSON.stringify(ir)).digest("hex"),
    supportedKinds:[...supported].sort(),outcomes:"Generated; not proof of compilation or HTTP conformance",
    files:outputs.sort()
  };
  write("protocolia-generation.json",JSON.stringify(manifest,null,2)+"\n");
  return manifest;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [irFile,openapiFile,output]=process.argv.slice(2);
  if(!irFile||!openapiFile||!output)throw Error("Usage: node generate.mjs ir.json openapi.json output-dir");
  const manifest=generate(JSON.parse(readFileSync(irFile,"utf8")),JSON.parse(readFileSync(openapiFile,"utf8")),resolve(output));
  console.log("MODULAR_A0_PROJECT_GENERATED "+JSON.stringify({files:manifest.files.length,sourceSha256:manifest.sourceSha256}));
}
