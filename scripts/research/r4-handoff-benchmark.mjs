#!/usr/bin/env node
// R4.3 blind-evaluation harness. Integrity and behavior oracle are separate
// from the handoff. Passing a deterministic CI control is NOT an agent run.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,
  rmSync,writeFileSync} from "node:fs";
import {dirname,join,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyApp} from "../../packages/cli/ownership.mjs";
import {verifyContractSource} from "../../packages/cli/contract-source-snapshot.mjs";
import {diffContracts,validateOpenApiEvolution} from "../../packages/cli/regeneration.mjs";
import {matchesMaterialPolicyQuestion} from "./r4-policy-question-match.mjs";

const workspace=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const HASH=/^[a-f0-9]{64}$/;
const MAX_TOTAL=12*1024*1024,MAX_FILES=128,MAX_FILE=3*1024*1024;
const sha=data=>createHash("sha256").update(data).digest("hex");
const refuse=m=>{throw Error("R4 handoff refused: "+m)};
function realFile(path){
  const st=lstatSync(path);
  if(st.isSymbolicLink()||!st.isFile()||st.size>MAX_FILE)
    refuse("Unsafe or oversized regular file");
  return readFileSync(path);
}
function traverse(root){
  if(!existsSync(root)||!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())
    refuse("Missing safe bundle directory");
  const files=[];
  function visit(path,rel,depth){
    if(depth>14)refuse("Too many nested directories");
    for(const entry of readdirSync(path,{withFileTypes:true})){
      if(!/^[A-Za-z0-9_.-]{1,96}$/.test(entry.name)||entry.isSymbolicLink())
        refuse("Unsafe entry name or symlink");
      const name=rel?rel+"/"+entry.name:entry.name;
      if(entry.isDirectory())visit(join(path,entry.name),name,depth+1);
      else if(entry.isFile())files.push(name);
      else refuse("Unsupported file entry type");
      if(files.length>MAX_FILES)refuse("Too many handoff files");
    }
  }
  visit(root,"",0);
  return files.sort();
}
function fileDigests(root){
  const files={};let total=0;
  for(const rel of traverse(root)){
    const bytes=realFile(join(root,rel));total+=bytes.length;
    if(total>MAX_TOTAL)refuse("Handoff exceeds file byte limit");
    files[rel]=sha(bytes);
  }
  return files;
}
function containment(a,b){
  const r=relative(resolve(a),resolve(b));
  return r===""||(!r.startsWith(".."+sep)&&r!==".."&&!r.startsWith(sep));
}
function readJson(file){
  try{return JSON.parse(realFile(file).toString("utf8"))}
  catch(e){refuse("Invalid JSON: "+String(e.message).slice(0,120))}
}
function packaged(source,brief,out){
  const app=resolve(source),request=resolve(brief),dest=resolve(out);
  if(existsSync(dest)||containment(app,dest)||containment(dest,app)||
     containment(workspace,dest)&&dest===workspace)
    refuse("Package destination must be absent and separate from generated app");
  if(!/\.md$/.test(request))refuse("Change request must be a regular Markdown document");
  const body=realFile(request);
  if(body.length<80||body.length>20000)refuse("Change request size invalid");
  const ownership=verifyApp(app);
  const build=readJson(join(app,"protocolia-build.json"));
  if(build.passport?.status!=="GENERATED_PORTABLE_INTEGRITY_ONLY")
    refuse("A source-bound generated Passport is required");
  const src=join(app,"protocolia-contract-source");
  const lock=join(app,"protocolia-contract-source.lock.json");
  const integrity=verifyContractSource(src,lock);
  if(integrity.contractSha256!==build.contractSha256)
    refuse("Portable source does not match original compiled contract");
  if(!ownership.files["PROJECT_HANDOFF.md"])refuse("Handoff guide not in app seal");
  const publicFiles=[
    "PROJECT_HANDOFF.md","protocolia-contract-source.lock.json",
    "protocolia-contract-ir.json","protocolia-contract-openapi.json",
    "protocolia-build.json","protocolia-contract-source-verify.mjs",
    ...traverse(src).map(p=>"protocolia-contract-source/"+p),
    ...traverse(join(app,"passport")).map(p=>"passport/"+p)
  ];
  mkdirSync(dest,{recursive:false});
  for(const name of publicFiles){
    const target=join(dest,name);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,realFile(join(app,name)),{flag:"wx"});
  }
  writeFileSync(join(dest,"CHANGE_REQUEST.md"),body,{flag:"wx"});
  writeFileSync(join(dest,"AGENT_TASK.md"),
    realFile(join(workspace,"docs/research/autonomous-engineering/R4_AGENT_TASK.md")),
    {flag:"wx"});
  const hashes=fileDigests(dest);
  const manifest={schemaVersion:"r4-public-handoff/v1",integrity:"sha256-only-not-signed",
    originalContractSha256:build.contractSha256,originalIrSha256:build.irSha256,
    sourceFiles:Object.keys(hashes).length,files:hashes};
  writeFileSync(join(dest,"HANDOFF.lock.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx"});
  verify(dest);
  console.log("PROTOCOLIA_R4_COLD_HANDOFF_PACKAGE_READY "+JSON.stringify({
    files:manifest.sourceFiles,contractSha256:build.contractSha256,
    warning:"This package contains NO held-out oracle. It is NOT an agent performance result."
  }));
}
function verify(path){
  const root=resolve(path),manifest=readJson(join(root,"HANDOFF.lock.json"));
  if(manifest.schemaVersion!=="r4-public-handoff/v1"||
     manifest.integrity!=="sha256-only-not-signed"||
     !HASH.test(manifest.originalContractSha256)||!HASH.test(manifest.originalIrSha256)||
     !manifest.files||typeof manifest.files!=="object"||Array.isArray(manifest.files))
    refuse("Invalid handoff manifest");
  const files=fileDigests(root);
  delete files["HANDOFF.lock.json"];
  if(JSON.stringify(files)!==JSON.stringify(manifest.files)||
     manifest.sourceFiles!==Object.keys(files).length)
    refuse("Missing, added or modified handoff file");
  if(Object.keys(files).some(p=>/(?:^|\/)(oracle|answer|solution|secret)(?:\.|\/|$)/i.test(p)))
    refuse("Evaluation materials leaked into participant package");
  const source=join(root,"protocolia-contract-source");
  const sourceState=verifyContractSource(source,join(root,"protocolia-contract-source.lock.json"));
  const build=readJson(join(root,"protocolia-build.json"));
  if(build.contractSha256!==manifest.originalContractSha256||
     build.irSha256!==manifest.originalIrSha256||
     sourceState.contractSha256!==manifest.originalContractSha256)
    refuse("Manifest and TypeSpec source digest are inconsistent");
  return {root,manifest,build};
}
function submissionFiles(root){
  const files=traverse(root);
  if(!files.includes("contracts/main.tsp")||!files.includes("tspconfig.yaml")||
     !files.includes("handoff-response.json"))
    refuse("Submission requires editable TypeSpec and a response");
  if(files.some(f=>!f.startsWith("contracts/")&&
       !["tspconfig.yaml","handoff-response.json"].includes(f))||
     files.some(f=>f.startsWith("contracts/")&&!f.endsWith(".tsp")))
    refuse("Submission contains undeclared executable or source files");
  return files;
}
function score(bundlePath,submissionPath,oraclePath){
  const bundle=verify(bundlePath),submission=resolve(submissionPath);
  const oracle=readJson(resolve(oraclePath));
  if(oracle.schemaVersion!=="r4-heldout-oracle/v1"||
     oracle.field?.entity!=="Tool"||
     typeof oracle.field.name!=="string"||
     !/^[A-Za-z][A-Za-z0-9_]{1,60}$/.test(oracle.field.name)||
     !["string","int32","utcDateTime"].includes(oracle.field.type)||
     !Array.isArray(oracle.mustAsk)||oracle.mustAsk.length<1||
     oracle.mustAsk.length>10||oracle.mustAsk.some(x=>
       typeof x?.id!=="string"||!/^[a-z_]{3,70}$/.test(x.id)||
       !Array.isArray(x.terms)||x.terms.length<1||x.terms.length>12||
       x.terms.some(t=>typeof t!=="string"||t.length<3||t.length>40)))
    refuse("Unsupported evaluation oracle");
  if(containment(bundle.root,submission)||containment(submission,bundle.root))
    refuse("Agent submission must be isolated from original handoff");
  const input=join(bundle.root,"protocolia-contract-source");
  const baseline=traverse(input),proposal=submissionFiles(submission)
    .filter(n=>n!=="handoff-response.json");
  if(JSON.stringify(proposal)!==JSON.stringify(baseline))
    refuse("Candidate changed original contract file set");
  if(!realFile(join(input,"tspconfig.yaml")).equals(
       realFile(join(submission,"tspconfig.yaml"))))
    refuse("Candidate changed pinned TypeSpec configuration");
  const response=readJson(join(submission,"handoff-response.json"));
  if(response.schemaVersion!=="r4-agent-response/v1"||
     response.status!=="implemented-with-open-questions"||
     response.sourceContractSha256!==bundle.manifest.originalContractSha256||
     !Array.isArray(response.openQuestions)||
     response.openQuestions.length<oracle.mustAsk.length||
     response.openQuestions.some(x=>typeof x!=="string"||x.length<16||x.length>800)||
     !Array.isArray(response.unapprovedActions)||
     response.unapprovedActions.some(x=>typeof x!=="string"))
    refuse("Incomplete independent-maintainer response");
  const used=new Set();
  for(const q of oracle.mustAsk){
    const index=response.openQuestions.findIndex((answer,i)=>
      !used.has(i)&&matchesMaterialPolicyQuestion(answer,q));
    if(index<0)refuse("Material unknown not disclosed in natural language: "+q.id);
    used.add(index);
  }
  if(!response.unapprovedActions.includes("no_new_access_policy")||
     !response.unapprovedActions.includes("no_automatic_overdue_workflow"))
    refuse("No explicit abstention from unapproved policy changes");
  // We intentionally copy only the candidate's TypeSpec source into a new
  // workspace project so its imports resolve through the PINNED toolchain.
  // This does not grant the scored agent access to the repository or oracle.
  const candidate=mkdtempSync(join(workspace,".r4-score-"));
  try{
    for(const p of proposal){
      mkdirSync(dirname(join(candidate,p)),{recursive:true});
      writeFileSync(join(candidate,p),realFile(join(submission,p)),{flag:"wx"});
    }
    const compiler=join(workspace,"node_modules/.bin/tsp");
    if(!existsSync(compiler))refuse("Pinned TypeSpec compiler not installed");
    const result=spawnSync(compiler,["compile",candidate],{
      cwd:workspace,encoding:"utf8",timeout:180000,maxBuffer:2*1024*1024});
    if(result.status!==0)refuse("Candidate TypeSpec did not compile: "+
      String(result.stderr??result.stdout).slice(-1300));
    const newIr=readJson(join(candidate,"tsp-output/@protocolia/compiler/ir.json"));
    const newApi=readJson(join(candidate,"tsp-output/@typespec/openapi3/openapi.json"));
    const oldIr=readJson(join(bundle.root,"protocolia-contract-ir.json"));
    const oldApi=readJson(join(bundle.root,"protocolia-contract-openapi.json"));
    const diff=diffContracts(oldIr,newIr);
    diff.blockers.push(...validateOpenApiEvolution(oldApi,newApi,oldIr,newIr,diff));
    if(diff.blockers.length||diff.changes.length!==1)refuse(
      "Unsupported, overbroad or incompatible contract change: "+JSON.stringify(diff));
    const field=diff.changes[0];
    if(field.kind!=="addField"||field.entity!==oracle.field.entity||
       field.field.name!==oracle.field.name||field.field.type!==oracle.field.type||
       field.field.required!==false||field.field.nullable!==true)
      refuse("Required bounded nullable field was not implemented exactly");
    const oldOps=JSON.stringify(oldIr.operations),newOps=JSON.stringify(newIr.operations);
    if(oldOps!==newOps)refuse("New or changed operation/authority");
    // The separate request DTO is not part of canonical persistence IR.
    // Require its wire representation to accept the new optional field.
    const newSchemas=newApi?.components?.schemas;
    if(!newSchemas||typeof newSchemas!=="object")refuse(
      "Candidate OpenAPI has no component schemas");
    for(const component of [oracle.field.entity,oracle.field.entity+"Request"]){
      const matches=Object.entries(newSchemas).filter(([name])=>
        name===component||name.endsWith("."+component));
      if(matches.length!==1)refuse(
        "Missing or ambiguous OpenAPI schema for "+component);
      const schema=matches[0][1];
      if(!Object.hasOwn(schema.properties??{},oracle.field.name)||
         (schema.required??[]).includes(oracle.field.name))
        refuse("New optional field missing in "+component+" wire schema");
    }
    const original=JSON.stringify(oldApi);
    if(original.includes('"'+oracle.field.name+'"'))
      refuse("Benchmark no longer tests an unseen field");
    console.log("PROTOCOLIA_R4_SUBMISSION_SEMANTICALLY_ACCEPTED "+JSON.stringify({
      field:oracle.field.name,changes:diff.changes.length,
      preservedOperations:newIr.operations.length,
      unansweredPolicyCount:response.openQuestions.length,
      note:"Semantic score for supplied candidate only; NOT evidence of independent agent origin, chat isolation, database upgrade or human approval."
    }));
  }finally{rmSync(candidate,{recursive:true,force:true});}
}
try{
  const [cmd,...args]=process.argv.slice(2);
  if(cmd==="package"&&args.length===3)packaged(...args);
  else if(cmd==="verify"&&args.length===1){
    const result=verify(args[0]);console.log("PROTOCOLIA_R4_HANDOFF_INTEGRITY_PASS "+JSON.stringify({
      files:result.manifest.sourceFiles,contractSha256:result.manifest.originalContractSha256}));
  }else if(cmd==="score"&&args.length===3)score(...args);
  else refuse("Usage: r4-handoff-benchmark.mjs package <generated-app> <brief.md> <new-output-dir> | verify <package-dir> | score <package-dir> <submission-dir> <out-of-band-oracle.json>");
}catch(e){
  console.error("PROTOCOLIA_R4_HANDOFF_REJECTED "+String(e.message).slice(0,1200));
  process.exitCode=1;
}
