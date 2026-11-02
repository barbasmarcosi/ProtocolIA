#!/usr/bin/env node
// Source-bound construction of TypeSpec from a finite operator grammar.
// A hash verifies file integrity, NOT ownership or permission to change policy.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,lstatSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {composeOperatorGraph,emitOperatorTypeSpec} from "./composable-operator-grammar.mjs";
import {operatorCatalogSnapshot,operatorCatalogDigest} from "./operator-catalog-v1.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const configPath=join(root,"examples/vnext/composable-operators/tspconfig.yaml");
const hash=x=>createHash("sha256").update(x).digest("hex");
const pretty=x=>JSON.stringify(x,null,2)+"\n";
const guard=(v,why)=>{if(!v)throw Error("OPERATOR_INTAKE_REJECTED: "+why);};
function safeFile(p){
 const info=lstatSync(resolve(p));guard(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=262144,"unsafe source");
 return readFileSync(resolve(p));
}
function planned(bytes){
 const source=JSON.parse(bytes);
 const ir=composeOperatorGraph(source),digest=hash(bytes);
 const versioned=ir.schemaVersion==="protocolia-composable-operator-ir/v0.2";
 const evidence=["source-sha256:"+digest];
 const req=[
  {id:"OP-01",text:"Register capacity entities with nonnegative remaining units, typed identity and read/list access.",
   scope:"supported",operations:ir.operations.filter(x=>x.entity===ir.entities[0].name&&x.kind!=="health").map(x=>x.name)},
  {id:"OP-02",text:"Atomically reserve units and create a unique journal record, rejecting oversubscription.",
   scope:"supported",operations:ir.operations.filter(x=>x.entity===ir.entities[1].name&&x.kind!=="transition").map(x=>x.name)},
  {id:"OP-03",text:"Make one terminal state decision, returning the reserved units exactly once on the designated rejecting branch.",
   scope:"supported",operations:ir.operations.filter(x=>x.kind==="transition").map(x=>x.name)},
  {id:"OP-04",text:"Provide read-only public health endpoint.",
   scope:"supported",operations:["health"]},
  {id:"OP-05",text:"Real users, organization-specific approvals, payment, expiry and external effects are not specified.",
   scope:"deferred",operations:[]}
 ].map(item=>({...item,origin:"source_brief_unverified",evidenceRefs:evidence}));
 const questions=[
  {id:"OP-Q01",question:"Which verified business identities may create or decide requests?",
   classification:"security_privilege",affectsSupported:false},
  {id:"OP-Q02",question:"Should an approved request ever be cancelled or its reserved units returned?",
   classification:"material_business",affectsSupported:false},
  {id:"OP-Q03",question:"What expiry, scheduling and actual fulfillment process governs reserved equipment?",
   classification:"material_business",affectsSupported:false}
 ].map(item=>({...item,state:"unresolved",origin:"source_brief_unverified",evidenceRefs:evidence}));
 const files=new Map([
  ["contracts/main.tsp",emitOperatorTypeSpec(ir)],
  ["tspconfig.yaml",safeFile(configPath).toString("utf8")],
  ["semantic-ir.json",pretty(ir)],
  ["requirements.json",pretty({schemaVersion:"protocolia-requirements/v1",requirements:req})],
  ["decisions.json",pretty({schemaVersion:"protocolia-decision-ledger/v0.1",
   authority:"SELF_DECLARED_UNVERIFIED",sourceSha256:digest,decisions:questions})],
  ["protocolia-intake-report.json",pretty({schemaVersion:"protocolia-intake-report/v0.1",
   status:"PARTIAL_DRAFT_UNVERIFIED",generatorProfile:versioned?"composable-operator-grammar/v0.2":"composable-operator-grammar/v0.1",
   ...(versioned?{operatorCatalogSha256:operatorCatalogDigest(),
    operatorPins:ir.operatorCatalog.pins}:{}),
   sourceSha256:digest,semanticIrSha256:hash(pretty(ir)),
   operatorKinds:["reserve","transition","release"],
   generatedOperations:ir.operations.map(x=>x.name),
   limitations:[
    "Only a bounded two-entity reserve plus terminal-branch state composition is allowed",
    "Source authorship, business approval and identity are not authenticated",
    "Payment, external side effects, general branching, deletion and arbitrary domain rules are forbidden",
    "Transitions share entity-level write permission; separation of duties is not implemented"
   ]})]
 ]);
 if(versioned)files.set("operator-catalog.json",pretty({
  schemaVersion:"protocolia-operator-catalog-binding/v1",
  sourceSha256:digest,pins:ir.operatorCatalog.pins,catalogSha256:operatorCatalogDigest(),
  catalog:operatorCatalogSnapshot()
 }));
 files.set("protocolia-intake.lock.json",pretty({schemaVersion:versioned?"protocolia-operator-lock/v0.2":"protocolia-operator-lock/v0.1",
  sourceSha256:digest,semanticIrSha256:hash(files.get("semantic-ir.json")),
  ...(versioned?{operatorCatalogSha256:operatorCatalogDigest()}:{}),
  files:Object.fromEntries([...files].map(([name,body])=>[name,hash(body)]).sort((a,b)=>a[0].localeCompare(b[0])))}));
 return files;
}
export function compileOperators(sourcePath,outPath,mode="generate"){
 guard(["generate","verify"].includes(mode),"invalid command");
 const src=resolve(sourcePath),dest=resolve(outPath);
 guard(src!==dest&&!src.startsWith(dest+"/")&&!dest.startsWith(src+"/"),"source/output alias");
 const files=planned(safeFile(src));
 if(mode==="generate"){
  if(existsSync(dest))guard(lstatSync(dest).isDirectory()&&!lstatSync(dest).isSymbolicLink()&&
   readdirSync(dest).length===0,"directory must be empty");
  else mkdirSync(dest,{recursive:true,mode:0o700});
  for(const [path,body] of files){
   const target=join(dest,path);mkdirSync(dirname(target),{recursive:true});
   writeFileSync(target,body,{flag:"wx",mode:0o600});
  }
 }else{
  guard(existsSync(dest)&&lstatSync(dest).isDirectory()&&!lstatSync(dest).isSymbolicLink(),"output missing");
  const discovered=[];
  function walk(dir){for(const item of readdirSync(dir,{withFileTypes:true})){
   guard(item.isDirectory()||item.isFile(),"symlinks/unsafe generated files");
   const p=join(dir,item.name);if(item.isDirectory())walk(p);
   else discovered.push(p.slice(dest.length+1).replaceAll("\\","/"));
  }}walk(dest);
  guard(JSON.stringify([...files.keys()].sort())===JSON.stringify(discovered.sort()),
   "generated file inventory drift");
  for(const [path,body] of files)guard(hash(safeFile(join(dest,path)))===hash(body),
   "artifact drift: "+path);
 }
 return {status:mode==="generate"?"PARTIAL_DRAFT_UNVERIFIED":"CONSISTENT_DRAFT_NOT_ATTESTED",
  files:files.size,sourceSha256:hash(safeFile(src))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  guard(process.argv.length===5,
   "usage: composable-operator-intake.mjs generate|verify source.json out");
  process.stdout.write(pretty(compileOperators(process.argv[3],process.argv[4],process.argv[2])));
 }catch(e){process.stderr.write(String(e.message).slice(0,250)+"\n");process.exitCode=1;}
}
