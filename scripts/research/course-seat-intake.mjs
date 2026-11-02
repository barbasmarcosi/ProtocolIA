#!/usr/bin/env node
// Second independent source-bounded domain: course seats and booking cancellation.
// No AI may modify a reviewed operation graph, authorization or business rule.
import {createHash} from "node:crypto";
import {readFileSync,lstatSync,readdirSync,mkdirSync,writeFileSync,existsSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {courseSeatSemanticIr,emitCourseSeatTypeSpec} from "./course-seat-semantic-ir.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const configFile=join(root,"examples/vnext/course-seats/tspconfig.yaml");
const schema="protocolia-course-seat-source/v0.1";
const allowedOps=["createCourseSession","getCourseSession","listCourseSessions",
 "createSeatBooking","getSeatBooking","listSeatBookings","cancelSeatBooking","health"];
const classes=new Set(["reversible_technical","material_business","security_privilege","external_effect","destructive_change"]);
const sha=x=>createHash("sha256").update(x).digest("hex");
const json=x=>JSON.stringify(x,null,2)+"\n";
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function fail(ok,message){if(!ok)throw Error("COURSE_INTAKE_REJECTED: "+message);}
function fields(x,keys,label){fail(obj(x)&&Object.keys(x).length===keys.length&&
  Object.keys(x).every(k=>keys.includes(k)),label+" missing/unknown fields");}
function phrase(s,label,max=1000){
 fail(typeof s==="string"&&s.length>0&&s.length<=max&&s.trim()===s&&
  !/[\u0000-\u001f\u007f]/.test(s),label+" invalid text");
}
function id(s,label){fail(typeof s==="string"&&/^[A-Z][A-Z0-9-]{1,50}$/.test(s),label+" invalid ID");}
function unique(xs,label){fail(new Set(xs).size===xs.length,"duplicate "+label);}
function readSafe(path){
 const s=lstatSync(resolve(path));fail(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=262144,"unsafe input file");
 return readFileSync(resolve(path));
}
export function validateCourseSource(input){
 fields(input,["schemaVersion","project","requirements","questions"],"course source");
 fail(input.schemaVersion===schema,"unsupported course source");
 const ir=courseSeatSemanticIr(input.project);
 fail(Array.isArray(input.requirements)&&input.requirements.length>=4&&input.requirements.length<=40,
  "wrong requirement count");
 fail(Array.isArray(input.questions)&&input.questions.length<=40,"wrong question count");
 const ids=[],ops=[];
 for(const fact of input.requirements){
  fields(fact,["id","text","scope","operations"],"course source requirement");
  id(fact.id,"requirement");phrase(fact.text,"requirement");
  fail(["supported","deferred"].includes(fact.scope),"bad scope");
  fail(Array.isArray(fact.operations)&&fact.operations.length<=8&&
   fact.operations.every(op=>typeof op==="string"&&allowedOps.includes(op)),
   "unknown course operation");
  unique(fact.operations,"fact operations");
  fail(fact.scope==="supported"?fact.operations.length>0:fact.operations.length===0,
   "deferred or supported coverage mismatch");
  ids.push(fact.id);ops.push(...fact.operations);
 }
 unique(ops,"all supported operations");
 fail(ops.length===allowedOps.length&&allowedOps.every(op=>ops.includes(op)),
  "source does not cover exactly the approved course operations");
 for(const q of input.questions){
  fields(q,["id","question","classification","affectsSupported"],"source question");
  id(q.id,"question");phrase(q.question,"question");
  fail(classes.has(q.classification)&&typeof q.affectsSupported==="boolean",
   "unknown question classification");
  ids.push(q.id);
 }
 unique(ids,"source IDs");
 const blockers=input.questions.filter(q=>q.affectsSupported);
 fail(blockers.length===0,"supported semantics has unanswered material questions: "+blockers.map(q=>q.id).join(","));
 return {ir,source:input};
}
function expectedFiles(sourceBytes){
 const {ir,source}=validateCourseSource(JSON.parse(sourceBytes));
 const contract=emitCourseSeatTypeSpec(ir);
 const requirements={schemaVersion:"protocolia-requirements/v1",requirements:source.requirements.map(r=>({
  ...r,origin:"source_brief_unverified",evidenceRefs:["source-sha256:"+sha(sourceBytes)+"#"+r.id]
 }))};
 const decisions={schemaVersion:"protocolia-decision-ledger/v0.1",authority:"SELF_DECLARED_UNVERIFIED",
  sourceSha256:sha(sourceBytes),decisions:source.questions.map(q=>({
   ...q,state:"unresolved",origin:"source_brief_unverified",
   evidenceRefs:["source-sha256:"+sha(sourceBytes)+"#"+q.id]
  }))};
 const report={schemaVersion:"protocolia-intake-report/v0.1",
  status:"PARTIAL_DRAFT_UNVERIFIED",profile:ir.profile,sourceSha256:sha(sourceBytes),
  semanticIrSha256:sha(json(ir)),
  generatedOperations:ir.operations.map(o=>o.name),
  deferredRequirements:source.requirements.filter(r=>r.scope==="deferred").map(r=>r.id),
  limitations:["Only source-bounded course seat capacity and cancel-once semantics are executable",
   "This source is a synthetic research case, not authenticated owner approval",
   "No calendar scheduling, attendee ownership, charges, refunds or production authorization",
   "No AI agent participated in choosing the frozen operation graph"]};
 const files=new Map([
  ["contracts/main.tsp",contract],
  ["tspconfig.yaml",readSafe(configFile).toString("utf8")],
  ["semantic-ir.json",json(ir)],
  ["requirements.json",json(requirements)],
  ["decisions.json",json(decisions)],
  ["protocolia-intake-report.json",json(report)]
 ]);
 const lock={schemaVersion:"protocolia-course-seat-intake-lock/v0.1",
  sourceSha256:sha(sourceBytes),semanticIrSha256:sha(files.get("semantic-ir.json")),
  generator:"protocolia-course-seat-intake@0.1.0",
  files:Object.fromEntries([...files].map(([name,body])=>[name,sha(body)]).sort((a,b)=>a[0].localeCompare(b[0])))};
 files.set("protocolia-intake.lock.json",json(lock));
 return {files,report};
}
export function compileCourseSource(inputPath,outPath,mode="generate"){
 fail(["generate","verify"].includes(mode),"unknown CLI action");
 const source=resolve(inputPath),out=resolve(outPath);
 fail(source!==out&&!source.startsWith(out+"/")&&!out.startsWith(source+"/"),
  "input/output alias");
 const {files,report}=expectedFiles(readSafe(source));
 if(mode==="generate"){
  if(existsSync(out))fail(lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink()&&
   readdirSync(out).length===0,"output must be empty");
  else mkdirSync(out,{recursive:true,mode:0o700});
  for(const [name,contents] of files){
   const dest=join(out,name);mkdirSync(dirname(dest),{recursive:true});
   writeFileSync(dest,contents,{flag:"wx",mode:0o600});
  }
 }else{
  fail(existsSync(out)&&lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink(),"missing output");
  const found=[];
  function walk(path){for(const ent of readdirSync(path,{withFileTypes:true})){
   fail(ent.isDirectory()||ent.isFile(),"unexpected output node/symlink");
   const child=join(path,ent.name);
   if(ent.isDirectory())walk(child);else found.push(child.slice(out.length+1).replaceAll("\\","/"));
  }}
  walk(out);
  fail(JSON.stringify(found.sort())===JSON.stringify([...files.keys()].sort()),"output files changed");
  for(const [name,contents] of files)fail(sha(readSafe(join(out,name)))===sha(contents),"artifact drift: "+name);
 }
 return {status:mode==="generate"?report.status:"CONSISTENT_DRAFT_NOT_ATTESTED",
  sourceSha256:report.sourceSha256,files:files.size,profile:report.profile};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  fail(process.argv.length===5,"Usage: course-seat-intake.mjs generate|verify SOURCE.json OUT");
  process.stdout.write(json(compileCourseSource(process.argv[3],process.argv[4],process.argv[2])));
 }catch(e){process.stderr.write(String(e.message).slice(0,230)+"\n");process.exitCode=1;}
}
