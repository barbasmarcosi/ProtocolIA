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
      if(field.required||!field.nullable||field.unique||field.reference)
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
  if(!same(oldIr.operations,nextIr.operations))
    blockers.push("Operation/routing/capability changed; requires separate reviewed migration");
  return {compatible:blockers.length===0,changes,blockers};
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
  return plan.changes.filter(x=>x.kind==="addField")
    .map(x=>"ALTER TABLE "+snake(x.entity)+" ADD COLUMN "+fieldDdl(x.field)+";")
    .join("\n");
}
function run(command,args,options={}){
  const p=spawnSync(command,args,{stdio:"inherit",timeout:600000,...options});
  if(p.error)throw p.error;
  if(p.status!==0)throw Error(command+" exited with "+p.status);
}
function readJson(path){return JSON.parse(readFileSync(path,"utf8"));}
function contractFrom(directory){return readJson(join(directory,"protocolia-contract-ir.json"));}
function migrations(folder){
  const root=join(folder,"src/main/resources/db/migration");
  const files=readdirSync(root).filter(p=>/^V[1-9]\d*__[A-Za-z0-9_-]+\.sql$/.test(p));
  if(!files.some(f=>f.startsWith("V1__")))throw Error("Missing Flyway V1 migration");
  return {root,files};
}
function ownedArea(folder){
  for(const [path,allowed] of [
    ["web",new Set(["src","node_modules","package.json","package-lock.json","index.html","vite.config.mjs"])],
    ["src",new Set(["main"])],
    ["src/main",new Set(["java","resources"])]
  ]){
    const dir=join(folder,path);
    if(!existsSync(dir))throw Error("Missing generated tree: "+path);
    for(const name of readdirSync(dir)){
      if(!allowed.has(name))throw Error("Unmanaged file under generated tree: "+join(path,name));
    }
  }
}
function preflight(out){
  verifyApp(out);
  ownedArea(out);
  const dirs=migrations(out);
  for(const file of dirs.files)if(!/^V\d+__/.test(file))throw Error("Unsafe migration filename");
  return dirs;
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
  preflight(out);
  const oldIr=contractFrom(out);
  const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
  run("npm",["run","build:vnext"],{cwd:repoRoot});
  run(join(repoRoot,"node_modules/.bin/tsp"),["compile",project],{cwd:repoRoot});
  const newIr=readJson(join(project,"tsp-output/@protocolia/compiler/ir.json"));
  const diff=diffContracts(oldIr,newIr);
  console.log("PROTOCOLIA_EVOLUTION_PLAN "+JSON.stringify(diff));
  if(action==="plan")return diff;
  if(!diff.compatible)throw Error("Breaking evolution forbidden: "+diff.blockers.join("; "));
  if(!diff.changes.length){
    console.log("PROTOCOLIA_EVOLUTION_NO_CHANGES");
    return diff;
  }
  const parent=dirname(out);
  const stage=mkdtempSync(join(parent,".protocolia-stage-"));
  const oldMigrations=migrations(out);
  let backup;
  try{
    run(process.execPath,[
      join(repoRoot,"packages/cli/protocolia.mjs"),"build",project,
      "--target","modular-spring","--out",stage
    ],{cwd:repoRoot});
    const fresh=migrations(stage);
    for(const filename of oldMigrations.files)
      copyFileSync(join(oldMigrations.root,filename),join(fresh.root,filename));
    const sql=additiveSql(diff);
    if(sql){
      const versions=oldMigrations.files.map(file=>Number(file.match(/^V(\d+)__/)[1]));
      const next=Math.max(...versions)+1;
      writeFileSync(join(fresh.root,"V"+next+"__protocolia_additive.sql"),
        "-- Non-destructive TypeSpec contract evolution; existing Flyway files preserved\n"+sql+"\n");
    }
    copyConsumer(out,stage);
    // Repackage AFTER restoring the historical V1 and adding V2.
    // Otherwise the already-built JAR would still contain the new baseline V1
    // and silently fail Flyway checksum validation against the existing DB.
    run("mvn",["-B","-ntp","-DskipTests","package"],{cwd:stage});
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
