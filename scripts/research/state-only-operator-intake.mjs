#!/usr/bin/env node
// Source-bound state-only operator assembly. SHA-256 protects byte integrity,
// never represents authentic human approval or IAM for real case decisions.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,lstatSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {composeStateOnlyGraph,emitStateOnlyTypeSpec} from "./state-only-operator-grammar.mjs";
import {operatorCatalogSnapshot,operatorCatalogDigest} from "./operator-catalog-v1.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const config=join(root,"examples/vnext/state-only-operators/tspconfig.yaml");
const sha=x=>createHash("sha256").update(x).digest("hex");
const json=x=>JSON.stringify(x,null,2)+"\n";
const check=(ok,why)=>{if(!ok)throw Error("STATE_ONLY_INTAKE_REJECTED: "+why);};
function readSafe(p){
 const s=lstatSync(resolve(p));
 check(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=262144,"unsafe file");
 return readFileSync(resolve(p));
}
function build(bytes){
 const input=JSON.parse(bytes),ir=composeStateOnlyGraph(input),sourceHash=sha(bytes);
 const tenantState=ir.schemaVersion==="protocolia-state-operator-ir/v0.6";
 const makerChecker=ir.schemaVersion==="protocolia-state-operator-ir/v0.5";
 const twoRole=makerChecker||ir.schemaVersion==="protocolia-state-operator-ir/v0.4";
 const authorization=tenantState?"tenant-state/v1":makerChecker?"maker-checker/v1":twoRole?"submit-decide/v1":null;
 const evidence=["source-sha256:"+sourceHash];
 const item=(id,text,scope,operations)=>({
  id,text,scope,operations,origin:"source_brief_unverified",evidenceRefs:evidence
 });
 const requirements=[
  item("SO-01","Create, retrieve, and list named workflow items with typed public identity.",
   "supported",ir.operations.filter(o=>["create","get","listPage"].includes(o.kind)).map(o=>o.name)),
  item("SO-02","Execute only permitted CAS state transitions, keeping both terminal outcomes mutually exclusive and auditing state changes.",
   "supported",ir.operations.filter(o=>o.kind==="transition").map(o=>o.name)),
  item("SO-03","Provide a technical health endpoint without revealing business records.",
   "supported",["health"]),
  item("SO-04","Real actor identity, per-transition privileges, notifications, signatures and appeals are deferred.",
   "deferred",[])
 ];
 const decision=(id,question,classification)=>({
  id,question,classification,affectsSupported:false,state:"unresolved",
  origin:"source_brief_unverified",evidenceRefs:evidence
 });
 const decisions=[
  decision("SO-Q01","Which verified actors may submit, approve or reject, and must approver differ from submitter?","security_privilege"),
  decision("SO-Q02","Are appeals, reversals, notifications or business deadlines permitted after a terminal decision?","material_business")
 ];
 const files=new Map([
  ["contracts/main.tsp",emitStateOnlyTypeSpec(ir)],
  ["tspconfig.yaml",readSafe(config).toString("utf8")],
  ["semantic-ir.json",json(ir)],
  ["requirements.json",json({schemaVersion:"protocolia-requirements/v1",requirements})],
  ["decisions.json",json({schemaVersion:"protocolia-decision-ledger/v0.1",
   authority:"SELF_DECLARED_UNVERIFIED",sourceSha256:sourceHash,decisions})],
  ["operator-catalog.json",json({schemaVersion:"protocolia-operator-catalog-binding/v1",
   sourceSha256:sourceHash,pins:ir.operatorCatalog.pins,
   catalogSha256:operatorCatalogDigest(),catalog:operatorCatalogSnapshot()})],
  ["protocolia-intake-report.json",json({schemaVersion:"protocolia-intake-report/v0.1",
   status:"PARTIAL_DRAFT_UNVERIFIED",
   generatorProfile:tenantState?"state-only-operator-grammar/v0.6":makerChecker?"state-only-operator-grammar/v0.5":twoRole?"state-only-operator-grammar/v0.4":"state-only-operator-grammar/v0.3",
   ...(authorization?{authorizationProfile:authorization}:{}),
   sourceSha256:sourceHash,semanticIrSha256:sha(json(ir)),
   operatorCatalogSha256:operatorCatalogDigest(),
   operatorPins:ir.operatorCatalog.pins,
   generatedOperations:ir.operations.map(o=>o.name),
   deferredRequirements:["SO-04"],
   limitations:[
    "A single audited transition operator is admitted; all external effects are forbidden",
    "A finite acyclic one-entity workflow is bounded by reviewed grammar, not arbitrary code",
    "The source is synthetic; no business owner is authenticated",
    tenantState?"Tenant isolation is an opt-in single-entity application scope; it does not include DB RLS or maker-checker":
    makerChecker?"Checked decisions use persisted submitter identity and distinct principal in the generated PostgreSQL runtime, not authenticated owner approval":
    twoRole?"Submit and decide grants are distinct; this is not identity separation-of-duties or owner approval":
      "One entity-level write capability is shared by submit/approve/reject actions"
   ]})]
 ]);
 files.set("protocolia-intake.lock.json",json({
  schemaVersion:tenantState?"protocolia-state-operator-lock/v0.6":makerChecker?"protocolia-state-operator-lock/v0.5":twoRole?"protocolia-state-operator-lock/v0.4":"protocolia-state-operator-lock/v0.3",
  sourceSha256:sourceHash,semanticIrSha256:sha(files.get("semantic-ir.json")),
  operatorCatalogSha256:operatorCatalogDigest(),
  files:Object.fromEntries([...files].map(([name,value])=>[name,sha(value)]).sort((a,b)=>a[0].localeCompare(b[0])))
 }));
 return files;
}
export function compileStateOnlyOperators(sourcePath,outPath,mode="generate"){
 check(["generate","verify"].includes(mode),"unknown command");
 const input=resolve(sourcePath),out=resolve(outPath);
 check(input!==out&&!input.startsWith(out+"/")&&!out.startsWith(input+"/"),"source/output alias");
 const files=build(readSafe(input));
 if(mode==="generate"){
  if(existsSync(out))check(lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink()&&
    readdirSync(out).length===0,"destination must be empty");
  else mkdirSync(out,{recursive:true,mode:0o700});
  for(const [path,contents] of files){
   const target=join(out,path);mkdirSync(dirname(target),{recursive:true});
   writeFileSync(target,contents,{flag:"wx",mode:0o600});
  }
 }else{
  check(existsSync(out)&&lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink(),
   "output missing");
  const actual=[];
  function walk(folder){for(const item of readdirSync(folder,{withFileTypes:true})){
   check(item.isFile()||item.isDirectory(),"symlink or unsafe output");
   const p=join(folder,item.name);
   if(item.isDirectory())walk(p);else actual.push(p.slice(out.length+1).replaceAll("\\","/"));
  }}walk(out);
  check(JSON.stringify(actual.sort())===JSON.stringify([...files.keys()].sort()),
   "generated file inventory drift");
  for(const [path,contents] of files)
   check(sha(readSafe(join(out,path)))===sha(contents),"artifact drift: "+path);
 }
 return {status:mode==="generate"?"PARTIAL_DRAFT_UNVERIFIED":"CONSISTENT_DRAFT_NOT_ATTESTED",
  sourceSha256:sha(readSafe(input)),files:files.size};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  check(process.argv.length===5,
   "usage: state-only-operator-intake.mjs generate|verify SOURCE.json OUT");
  process.stdout.write(json(compileStateOnlyOperators(process.argv[3],process.argv[4],process.argv[2])));
 }catch(err){process.stderr.write(String(err.message).slice(0,260)+"\n");process.exitCode=1;}
}
