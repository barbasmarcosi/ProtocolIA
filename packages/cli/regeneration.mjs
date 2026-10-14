// A5 contract evolution: additive-only, staged, with Flyway baseline preservation.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {copyFileSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,
  readdirSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {basename,dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {sealApp,verifyApp} from "./ownership.mjs";

const shaTag=()=>randomBytes(7).toString("hex");
const safeName=value=> {
  if(typeof value!=="string"||!/^[A-Za-z][A-Za-z0-9_]*$/.test(value))
    throw Error("Unsafe schema identifier "+JSON.stringify(value));
  return value;
};
const snake=value=>safeName(value).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function describe(field){return field.name+":"+field.type;}
export function diffContracts(oldIr,nextIr){
  const blockers=[],changes=[];
  if(oldIr?.irVersion!=="vnext-a0.1"||nextIr?.irVersion!==oldIr.irVersion)
    blockers.push("Canonical IR version changed");
  if(oldIr.namespace!==nextIr.namespace)
    blockers.push("Namespace changed");
  const before=new Map(oldIr.entities.map(e=>[e.name,e]));
  const after=new Map(nextIr.entities.map(e=>[e.name,e]));
  if(before.size!==oldIr.entities.length||after.size!==nextIr.entities.length)
    blockers.push("Duplicate entity");
  for(const previous of oldIr.entities){
    const next=after.get(previous.name);
    if(!next){blockers.push("Removed entity "+previous.name);continue;}
    if(previous.publicIdentity!==next.publicIdentity)
      blockers.push("Public identity changed on "+previous.name);
    if(previous.view!==next.view)
      changes.push({kind:"view",entity:previous.name,from:previous.view??null,to:next.view??null});
    const oldFields=new Map(previous.fields.map(f=>[f.name,f]));
    const newFields=new Map(next.fields.map(f=>[f.name,f]));
    for(const field of previous.fields){
      const value=newFields.get(field.name);
      if(!value)blockers.push("Removed field "+previous.name+"."+field.name);
      else if(!same(field,value))
        blockers.push("Incompatible field/constraint change "+previous.name+"."+field.name);
    }
    for(const field of next.fields){
      if(oldFields.has(field.name))continue;
      if(field.initial!==undefined){
        if(field.type!=="string"||!field.required||field.nullable||field.unique||
           field.reference||!/^([a-z][a-z0-9_-]{0,63})$/.test(field.initial)||
           (field.minLength??1)>field.initial.length||
           (field.maxLength??255)<field.initial.length)
          blockers.push("Invalid required initial-state addition: "+previous.name+"."+field.name);
        else changes.push({kind:"addInitialState",entity:previous.name,field:structuredClone(field)});
      }else if(field.required||!field.nullable||field.unique||field.reference)
        blockers.push("New field must be optional, nullable, nonunique and non-reference: "+
          previous.name+"."+field.name);
      else if(!["string","int32","utcDateTime"].includes(field.type))
        blockers.push("Unsupported new type "+describe(field));
      else{
        safeName(field.name);
        changes.push({kind:"addField",entity:previous.name,field:structuredClone(field)});
      }
    }
  }
  for(const next of nextIr.entities)
    if(!before.has(next.name))blockers.push("New entity needs a separate migration profile: "+next.name);
  const previousOperations=new Map(oldIr.operations.map(op=>[op.name,op]));
  const futureOperations=new Map(nextIr.operations.map(op=>[op.name,op]));
  if(previousOperations.size!==oldIr.operations.length||futureOperations.size!==nextIr.operations.length)
    blockers.push("Duplicate operation name");
  for(const oldOp of oldIr.operations){
    if(!same(oldOp,futureOperations.get(oldOp.name)))
      blockers.push("Operation/routing/capability changed: "+oldOp.name);
  }
  const additions=nextIr.operations.filter(op=>!previousOperations.has(op.name));
  const initialStates=changes.filter(c=>c.kind==="addInitialState");
  for(const op of additions){
    const field=initialStates.find(c=>c.entity===op.entity&&c.field.name===op.behavior.field);
    const b=op.behavior,release=b.release;
    const source=oldIr.operations.find(x=>x.entity===op.entity&&x.behavior.kind==="create");
    const linked=source?.behavior.reserve;
    const parent=linked?oldIr.entities.find(e=>e.name===linked.stockEntity):undefined;
    const parentWrite=oldIr.operations.find(x=>x.entity===parent?.name&&x.behavior.kind==="create");
    if(b.kind==="auditPage"){
      const existing=oldIr.operations.filter(x=>x.entity===op.entity);
      const baseEntity=oldIr.entities.find(e=>e.name===op.entity);
      const readers=existing.filter(x=>["get","listPage"].includes(x.behavior.kind));
      const writers=existing.filter(x=>["create","transition","patchFields","atomicIncrement","delete"].includes(x.behavior.kind));
      const identity=baseEntity?.publicIdentity;
      const tokens=[...op.path.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
      const previouslyAudited=existing.some(x=>["create","transition"].includes(x.behavior.kind)&&
        Array.isArray(x.behavior.audit)&&x.behavior.audit.length>0);
      const distinct=[...new Set([...readers,...writers].map(x=>x.capability))];
      const oldRoute=oldIr.operations.some(x=>x.method===op.method&&x.path===op.path);
      if(!baseEntity||!previouslyAudited||existing.some(x=>x.behavior.kind==="auditPage")||
         op.method!=="GET"||tokens.length!==1||tokens[0]!==identity||
         !op.path.startsWith("/api/")||!op.path.endsWith("/audit")||oldRoute||
         !op.statuses.includes(200)||!op.statuses.includes(400)||!op.statuses.includes(404)||
         !op.statuses.includes(401)||!op.statuses.includes(403)||
         !op.capability||op.capability==="public"||distinct.includes(op.capability)||
         Object.keys(b).length!==1){
        blockers.push("Unsafe audit reader addition (separate authority, unchanged audited source, GET identity and 200/400/401/403/404 required): "+op.name);
      }else changes.push({kind:"addOperation",entity:op.entity,operation:structuredClone(op)});
      continue;
    }
    if(!field||b.kind!=="transition"||!release||!linked||!parentWrite||
       b.from!==field.field.initial||b.to===b.from||
       op.method!=="POST"||!op.statuses.includes(200)||!op.statuses.includes(409)||
       op.capability!==source.capability||
       !Object.entries(linked).every(([k,v])=>release[k]===v)||
       !/^[a-z][a-z0-9_-]{0,63}$/.test(b.to)||
       (field.field.minLength??1)>b.to.length||
       (field.field.maxLength??255)<b.to.length)
      blockers.push("Unsupported new operation (requires exactly one matching stock cancellation): "+op.name);
    else changes.push({kind:"addOperation",entity:op.entity,operation:structuredClone(op)});
  }
  for(const state of initialStates){
    const itsOperations=changes.filter(c=>c.kind==="addOperation" &&
      c.entity===state.entity&&c.operation.behavior.field===state.field.name);
    if(itsOperations.length!==1)blockers.push("Required initial-state addition must have one safe cancellation transition: "+
      state.entity+"."+state.field.name);
  }
  return {compatible:blockers.length===0,changes,blockers};
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
/**
 * The canonical IR only includes the operation's request model name, not all
 * request-field validators. Disallow invisible HTTP API drift when evolving.
 */
export function validateOpenApiEvolution(oldApi,newApi,oldIr,nextIr,plan){
  const issues=[];
  if(!oldApi||!newApi||oldApi.openapi!==newApi.openapi){
    return ["OpenAPI version changed or snapshot is missing"];
  }
  const next=structuredClone(newApi);
  const beforeSchemas=oldApi.components?.schemas??{};
  const nextSchemas=next.components?.schemas??{};
  const reachableSchemas=new Set();
  function gatherRefs(value,seen=new Set()){
    if(!value||typeof value!=="object"||seen.has(value))return;
    seen.add(value);
    if(typeof value.$ref==="string"&&value.$ref.startsWith("#/components/schemas/")){
      const name=value.$ref.slice("#/components/schemas/".length).replace(/~1/g,"/").replace(/~0/g,"~");
      if(!Object.hasOwn(beforeSchemas,name)&&Object.hasOwn(nextSchemas,name)&&
         !reachableSchemas.has(name)){
        reachableSchemas.add(name);
        gatherRefs(nextSchemas[name],seen);
      }
    }
    for(const item of Object.values(value))gatherRefs(item,seen);
  }
  for(const change of plan.changes.filter(c=>c.kind==="addOperation")){
    const op=change.operation;
    if(oldApi.paths?.[op.path]?.[op.method.toLowerCase()]){
      issues.push("New operation overrides an existing route: "+op.name);continue;
    }
    const endpoint=next.paths?.[op.path]?.[op.method.toLowerCase()];
    if(!endpoint){
      issues.push("New operation missing from OpenAPI: "+op.name);continue;
    }
    if(op.behavior.kind==="auditPage")gatherRefs(endpoint);
    delete next.paths[op.path][op.method.toLowerCase()];
    if(Object.keys(next.paths[op.path]).length===0)delete next.paths[op.path];
  }
  for(const change of plan.changes.filter(c=>c.kind==="addInitialState")){
    const entity=change.entity,field=change.field.name;
    const operation=oldIr.operations.find(op=>op.entity===entity&&op.behavior.kind==="create");
    const request=operation?.request;
    const nextEntity=nextSchemas[entity],nextRequest=nextSchemas[request];
    const previousEntity=beforeSchemas[entity],previousRequest=beforeSchemas[request];
    if(!request||!nextEntity?.properties?.[field]||!nextRequest?.properties?.[field]||
       previousEntity?.properties?.[field]||previousRequest?.properties?.[field]||
       nextRequest.required?.includes(field)||
       !nextEntity.required?.includes(field)){
      issues.push("Unsafe initial-state property in entity or legacy request schema: "+entity+"."+field);
      continue;
    }
    // The entity must expose this required field, while the existing CREATE DTO
    // stays backward compatible by accepting omission and filling it server-side.
    const nextValue=nextEntity.properties[field],requestValue=nextRequest.properties[field];
    if(!same(canonical(nextValue),canonical(requestValue))){
      issues.push("Initial-state request/entity validators diverged: "+entity+"."+field);
      continue;
    }
    delete nextEntity.properties[field];
    nextEntity.required=nextEntity.required.filter(x=>x!==field);
    delete nextRequest.properties[field];
  }
  for(const change of plan.changes.filter(c=>c.kind==="addField")){
    const entity=change.entity,field=change.field.name;
    const op=nextIr.operations.find(x=>x.entity===entity&&x.behavior.kind==="create");
    const request=op?.request;
    if(!request||!nextSchemas[entity]?.properties||!nextSchemas[request]?.properties){
      issues.push("Unresolved OpenAPI entity/request schemas for "+entity+"."+field);
      continue;
    }
    const entityValue=nextSchemas[entity].properties[field];
    const requestValue=nextSchemas[request].properties[field];
    if(!entityValue||!requestValue||beforeSchemas[entity]?.properties?.[field]||
       beforeSchemas[request]?.properties?.[field]||
       !same(canonical(entityValue),canonical(requestValue))){
      issues.push("Added field does not match entity and create-request OpenAPI: "+entity+"."+field);
      continue;
    }
    delete nextSchemas[entity].properties[field];
    delete nextSchemas[request].properties[field];
  }
  for(const name of reachableSchemas)delete nextSchemas[name];
  if(!same(canonical(oldApi),canonical(next)))
    issues.push("Undeclared OpenAPI model/validation/routing change");
  return issues;
}

function fieldDdl(field){
  const col=snake(field.name);
  const type=field.type==="string"?"VARCHAR("+(field.maxLength??255)+")":
    field.type==="int32"?"INTEGER":"TIMESTAMP WITH TIME ZONE";
  const checks=[];
  if(field.minLength!==undefined)checks.push("CHECK (char_length("+col+") >= "+field.minLength+")");
  if(field.maxLength!==undefined && field.type!=="string")
    throw Error("maxLength on non-string not supported");
  if(field.min!==undefined)checks.push("CHECK ("+col+">="+field.min+")");
  if(field.max!==undefined)checks.push("CHECK ("+col+"<="+field.max+")");
  return col+" "+type+(checks.length?" "+checks.join(" "):"");
}
export function additiveSql(plan){
  if(!plan.compatible)throw Error("Refusing destructive migration: "+plan.blockers.join("; "));
  return plan.changes.filter(x=>["addField","addInitialState"].includes(x.kind))
    .map(x=>{
      if(x.kind==="addField")return "ALTER TABLE "+snake(x.entity)+" ADD COLUMN "+fieldDdl(x.field)+";";
      const field=x.field,initial=field.initial;
      const values=new Set([initial,...plan.changes.filter(c=>c.kind==="addOperation"&&
        c.entity===x.entity&&c.operation.behavior.field===field.name)
        .flatMap(c=>[c.operation.behavior.from,c.operation.behavior.to])]);
      if(!initial||values.size<2||[...values].some(value=>
          typeof value!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(value)))
        throw Error("Unresolved safe cancellation states on "+x.entity+"."+field.name);
      const allowed=[...values].sort().map(value=>"'"+value+"'").join(",");
      return "ALTER TABLE "+snake(x.entity)+" ADD COLUMN "+fieldDdl(field)+
        " DEFAULT '"+initial+"' NOT NULL CHECK ("+snake(field.name)+" IN ("+allowed+"));";
    }).join("\n");
}
function run(command,args,options={}){
  const p=spawnSync(command,args,{stdio:"inherit",timeout:600000,...options});
  if(p.error)throw p.error;
  if(p.status!==0)throw Error(command+" exited with "+p.status);
}
function readJson(path){return JSON.parse(readFileSync(path,"utf8"));}
function contractFrom(directory){return readJson(join(directory,"protocolia-contract-ir.json"));}
function migrations(folder,target){
  if(target==="modular-spring"){
    const root=join(folder,"src/main/resources/db/migration");
    const files=readdirSync(root);
    if(files.some(name=>!/^V[1-9]\d*__[A-Za-z0-9_-]+\.sql$/.test(name)))
      throw Error("Unknown Flyway migration file; refusing evolution");
    if(!files.some(name=>name.startsWith("V1__")))throw Error("Missing Flyway V1 migration");
    const numbers=files.map(name=>Number(name.match(/^V(\d+)__/)[1])).sort((a,b)=>a-b);
    if(numbers.some((v,i)=>v!==i+1))throw Error("Non-sequential Flyway migration versions");
    return {root,files,lastVersion:Math.max(...numbers)};
  }
  if(target==="nestjs"){
    const root=join(folder,"src/migrations"),baseline=join(folder,"src/schema.sql");
    if(!existsSync(root)||!existsSync(baseline))throw Error("Missing Nest SQL baseline/migrations directory");
    const files=readdirSync(root);
    if(files.some(name=>!/^V[2-9]\d*__[A-Za-z0-9_-]+\.sql$/.test(name)))
      throw Error("Unknown Nest migration file; refusing evolution");
    const numbers=files.map(name=>Number(name.match(/^V(\d+)__/)[1])).sort((a,b)=>a-b);
    if(numbers.some((v,i)=>v!==i+2))throw Error("Non-sequential Nest migration versions");
    return {root,files,lastVersion:numbers.length+1,baseline};
  }
  throw Error("Unsupported evolution target: "+target);
}
function ownedArea(folder,target){
  const trees=target==="nestjs"?[
    ["web",new Set(["src","node_modules","package.json","package-lock.json","index.html","vite.config.mjs"])],
    ["src",new Set(["main.ts","manifest.json","schema.sql","migrations"])]
  ]:[
    ["web",new Set(["src","node_modules","package.json","package-lock.json","index.html","vite.config.mjs"])],
    ["src",new Set(["main"])],
    ["src/main",new Set(["java","resources"])]
  ];
  for(const [path,allowed] of trees){
    const dir=join(folder,path);
    if(!existsSync(dir))throw Error("Missing generated tree: "+path);
    for(const name of readdirSync(dir)){
      if(!allowed.has(name))throw Error("Unmanaged file under generated tree: "+join(path,name));
    }
  }
}
function preflight(out){
  verifyApp(out);
  const meta=readJson(join(out,"protocolia-build.json"));
  if(!["modular-spring","nestjs"].includes(meta.target))throw Error("Unsupported evolution target");
  ownedArea(out,meta.target);
  return {target:meta.target,...migrations(out,meta.target)};
}
function copyConsumer(oldDir,newDir){
  for(const path of ["extensions",".env"]){
    const from=join(oldDir,path),to=join(newDir,path);
    if(!existsSync(from))continue;
    if(existsSync(to))throw Error("Consumer-owned path conflicts with generator: "+path);
    cpSync(from,to,{recursive:true,errorOnExist:true,force:false});
  }
}
export async function evolve(action,projectPath,outputPath){
  if(!["plan","evolve"].includes(action)||!projectPath||!outputPath)
    throw Error("Usage: protocolia <plan|evolve> <TypeSpec-project> <generated-directory>");
  const project=resolve(projectPath),out=resolve(outputPath);
  if(!existsSync(join(project,"tspconfig.yaml")))throw Error("Missing source TypeSpec project");
  const oldState=preflight(out);
  const oldIr=contractFrom(out);
  const oldOpenApi=readJson(join(out,"protocolia-contract-openapi.json"));
  const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
  run("npm",["run","build:vnext"],{cwd:repoRoot});
  run(join(repoRoot,"node_modules/.bin/tsp"),["compile",project],{cwd:repoRoot});
  const newIr=readJson(join(project,"tsp-output/@protocolia/compiler/ir.json"));
  const diff=diffContracts(oldIr,newIr);
  const nextOpenApi=readJson(join(project,"tsp-output/@typespec/openapi3/openapi.json"));
  diff.blockers.push(...validateOpenApiEvolution(oldOpenApi,nextOpenApi,oldIr,newIr,diff));
  diff.compatible=diff.blockers.length===0;
  console.log("PROTOCOLIA_EVOLUTION_PLAN "+JSON.stringify(diff));
  if(action==="plan")return diff;
  if(!diff.compatible)throw Error("Breaking evolution forbidden: "+diff.blockers.join("; "));
  if(!diff.changes.length){
    console.log("PROTOCOLIA_EVOLUTION_NO_CHANGES");
    return diff;
  }
  const parent=dirname(out);
  const stage=mkdtempSync(join(parent,".protocolia-stage-"));
  let backup;
  try{
    run(process.execPath,[
      join(repoRoot,"packages/cli/protocolia.mjs"),"build",project,
      "--target",oldState.target,"--out",stage
    ],{cwd:repoRoot});
    const fresh=migrations(stage,oldState.target);
    if(oldState.target==="nestjs"){
      // Nest executes this immutable initial schema only for an empty database.
      // Never install the new model as V1 when upgrading an existing database.
      copyFileSync(oldState.baseline,fresh.baseline);
    }
    for(const filename of oldState.files)
      copyFileSync(join(oldState.root,filename),join(fresh.root,filename));
    const sql=additiveSql(diff);
    if(sql){
      const next=oldState.lastVersion+1;
      writeFileSync(join(fresh.root,"V"+next+"__protocolia_additive.sql"),
        "-- Non-destructive TypeSpec contract evolution; original baseline preserved\n"+sql+"\n");
    }
    copyConsumer(out,stage);
    if(oldState.target==="modular-spring"){
      // Flyway migrations are classpath resources: repackage the jar after restoring history.
      run("mvn",["-B","-ntp","-DskipTests","package"],{cwd:stage});
    }
    // Nest reads baseline and patch files on startup, protected by a DB transaction
    // and its versioned checksums. The compiled JS is unchanged by restoring SQL.
    sealApp(stage);
    // Do not swap if another process touched a managed output while we compiled.
    preflight(out);
    backup=join(parent,".protocolia-backup-"+basename(out)+"-"+shaTag());
    renameSync(out,backup);
    try {renameSync(stage,out);}
    catch(error){
      renameSync(backup,out);
      backup=undefined;
      throw error;
    }
    console.log("PROTOCOLIA_EVOLUTION_APPLIED "+JSON.stringify({
      output:out,previousSnapshot:backup,changes:diff.changes,
      warning:"Schema migration runs on next application startup. Database downgrade is not automatic."
    }));
    return diff;
  }finally{
    if(existsSync(stage))rmSync(stage,{recursive:true,force:true});
  }
}
