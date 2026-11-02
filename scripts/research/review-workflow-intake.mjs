#!/usr/bin/env node
// Deterministic, source-bound state-machine contract. This file does not grant
// business ownership or production authorization to the source or an agent.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,lstatSync,mkdirSync,readdirSync,existsSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {reviewSemanticIr,emitReviewTypeSpec} from "./typed-review-workflow.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const configPath=join(root,"examples/vnext/review-workflow/tspconfig.yaml");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const json=v=>JSON.stringify(v,null,2)+"\n";
const insist=(x,message)=>{if(!x)throw Error("REVIEW_INTAKE_REJECTED: "+message);};
function safeRead(path){
 const info=lstatSync(resolve(path));
 insist(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=262144,"unsafe input");
 return readFileSync(resolve(path));
}
function expected(src){
 const source=JSON.parse(src),ir=reviewSemanticIr(source);
 const documentId=sha(src);
 const requirements=[
  {id:"WF-01",text:"Create and read an independently identified review case, then list cases by page.",
   scope:"supported",operations:["createReviewCase","getReviewCase","listReviewCases"]},
  {id:"WF-02",text:"Progress a draft case into review, then choose exactly one terminal decision: approve or reject.",
   scope:"supported",operations:["submitReviewCase","approveReviewCase","rejectReviewCase"]},
  {id:"WF-03",text:"Expose only an unauthenticated health endpoint to anonymous callers.",
   scope:"supported",operations:["health"]},
  {id:"WF-04",text:"Real reviewer identity, notifications, attachments, digital signatures, deadlines and appeals remain undefined.",
   scope:"deferred",operations:[]}
 ].map(r=>({...r,origin:"source_brief_unverified",evidenceRefs:["source-sha256:"+documentId]}));
 const questions=[
  {id:"WF-Q01",question:"What are the actual identities, authorization scopes and separation-of-duties rules for reviewers?",
   classification:"security_privilege",affectsSupported:false},
  {id:"WF-Q02",question:"Is an appeal, reversal or escalation permitted after the final decision?",
   classification:"material_business",affectsSupported:false}
 ].map(r=>({...r,state:"unresolved",origin:"source_brief_unverified",
  evidenceRefs:["source-sha256:"+documentId]}));
 const files=new Map([
  ["contracts/main.tsp",emitReviewTypeSpec(ir)],
  ["tspconfig.yaml",safeRead(configPath).toString("utf8")],
  ["semantic-ir.json",json(ir)],
  ["requirements.json",json({schemaVersion:"protocolia-requirements/v1",requirements})],
  ["decisions.json",json({schemaVersion:"protocolia-decision-ledger/v0.1",authority:"SELF_DECLARED_UNVERIFIED",
   sourceSha256:documentId,decisions:questions})],
  ["protocolia-intake-report.json",json({schemaVersion:"protocolia-intake-report/v0.1",
   status:"PARTIAL_DRAFT_UNVERIFIED",generatorProfile:ir.profile,sourceSha256:documentId,
   semanticIrSha256:sha(json(ir)),generatedOperations:ir.operations.map(o=>o.name),
   deferredRequirements:["WF-04"],limitations:[
    "Synthetic document, owner is not authenticated",
    "State names are configurable but machine shape and capabilities are sealed",
    "No financial, external, destructive or permission-changing effects",
    "No real model execution occurred in this contract generation"
   ]})]
 ]);
 files.set("protocolia-intake.lock.json",json({schemaVersion:"protocolia-review-workflow-lock/v0.1",
  sourceSha256:documentId,semanticIrSha256:sha(files.get("semantic-ir.json")),
  files:Object.fromEntries([...files].map(([p,v])=>[p,sha(v)]).sort((a,b)=>a[0].localeCompare(b[0])))}));
 return files;
}
export function compileReviewWorkflow(sourcePath,outPath,mode="generate"){
 insist(["generate","verify"].includes(mode),"unknown mode");
 const a=resolve(sourcePath),out=resolve(outPath);
 insist(a!==out&&!a.startsWith(out+"/")&&!out.startsWith(a+"/"),"path aliases");
 const files=expected(safeRead(a));
 if(mode==="generate"){
  if(existsSync(out))insist(lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink()&&
   readdirSync(out).length===0,"output must be empty");
  else mkdirSync(out,{recursive:true,mode:0o700});
  for(const [path,contents] of files){
   const file=join(out,path);mkdirSync(dirname(file),{recursive:true});
   writeFileSync(file,contents,{flag:"wx",mode:0o600});
  }
 }else{
  insist(existsSync(out)&&lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink(),"output missing");
  const actual=[];
  function walk(dir){for(const item of readdirSync(dir,{withFileTypes:true})){
   insist(item.isFile()||item.isDirectory(),"output symlink/unsafe node");
   const file=join(dir,item.name);if(item.isDirectory())walk(file);
   else actual.push(file.slice(out.length+1).replaceAll("\\","/"));
  }}walk(out);
  insist(JSON.stringify(actual.sort())===JSON.stringify([...files.keys()].sort()),"output file inventory changed");
  for(const [path,contents] of files)insist(sha(safeRead(join(out,path)))===sha(contents),"artifact drift: "+path);
 }
 return {status:mode==="generate"?"PARTIAL_DRAFT_UNVERIFIED":"CONSISTENT_DRAFT_NOT_ATTESTED",
  sourceSha256:sha(safeRead(a)),files:files.size};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  insist(process.argv.length===5,
   "usage: review-workflow-intake.mjs generate|verify SOURCE.json OUTPUT");
  process.stdout.write(json(compileReviewWorkflow(process.argv[3],process.argv[4],process.argv[2])));
 }catch(e){process.stderr.write(String(e.message).slice(0,260)+"\n");process.exitCode=1;}
}
