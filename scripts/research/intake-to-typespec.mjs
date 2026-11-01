#!/usr/bin/env node
// R2 bounded, provider-neutral draft intake -> compilable TypeSpec profile.
// NO LLM, unchecked business-rule invention, app deployment or privileged effects.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,readdirSync,mkdirSync,lstatSync,existsSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const schema="protocolia-intake-project/v0.1";
const reserved=new Set("alias and array as boolean const dec decorator else enum extends extern false fn for from if import in interface is model namespace never null op scalar service string true type typeof union unknown using value void".split(" "));
const originSet=new Set(["explicit_owner","trusted_existing_contract","approved_policy","agent_assumption"]);
const classes=new Set(["reversible_technical","material_business","security_privilege","external_effect","destructive_change"]);
const kinds=["create","get","list","increment","rename"];
const sha=x=>createHash("sha256").update(x).digest("hex");
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function fail(ok,message){if(!ok)throw Error(message);}
function exactly(x,allowed,required,label){
 fail(obj(x),label+" must be object");
 for(const k of Object.keys(x))fail(allowed.includes(k),label+" unexpected "+k);
 for(const k of required)fail(Object.hasOwn(x,k),label+" missing "+k);
}
function ident(s,label){fail(typeof s==="string"&&/^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(s)&&!reserved.has(s),label+" invalid identifier");return s;}
function text(s,label,max=500){fail(typeof s==="string"&&s.trim().length>0&&s.length<=max&&!/[\u0000-\u001f\u007f]/.test(s),label+" invalid text");return s;}
function integer(n,min,max,label){fail(Number.isSafeInteger(n)&&n>=min&&n<=max,label+" out of bounds");return n;}
function unique(values,label){fail(new Set(values).size===values.length,"duplicate "+label);}
function json(x){return JSON.stringify(x,null,2)+"\n";}
function inputFile(path){const stat=lstatSync(resolve(path));fail(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=262144,"unsafe input file");return readFileSync(resolve(path));}
function field(x,label,kind){
 exactly(x,["name","maxLength","maxValue"],["name",kind==="quantity"?"maxValue":"maxLength"],label);
 ident(x.name,label+" name");
 if(kind==="quantity")integer(x.maxValue,1,2147483647,label+" maxValue");
 else integer(x.maxLength,1,255,label+" maxLength");
}
export function validateDraft(input){
 exactly(input,["schemaVersion","project","requirements","questions"],
   ["schemaVersion","project","requirements","questions"],"intake");
 fail(input.schemaVersion===schema,"unsupported intake schema");
 const p=input.project;
 exactly(p,["namespace","title","entity","view","resource","identity","label","quantity","capabilityRoot"],
  ["namespace","title","entity","view","resource","identity","label","quantity","capabilityRoot"],"project");
 ident(p.namespace,"namespace");ident(p.entity,"entity");
 text(p.title,"title",120);text(p.view,"view",120);
 fail(typeof p.resource==="string"&&/^[a-z][a-z0-9-]{1,49}$/.test(p.resource),"invalid API resource");
 fail(typeof p.capabilityRoot==="string"&&/^[a-z][a-z0-9_.-]{1,49}$/.test(p.capabilityRoot),"invalid capability root");
 field(p.identity,"identity","identity");field(p.label,"label","label");field(p.quantity,"quantity","quantity");
 unique([p.identity.name,p.label.name,p.quantity.name],"field names");
 for(const x of [p.namespace,p.entity,p.entity+"Request",p.entity+"Page",p.entity+"NameChange"])ident(x,"generated symbol");
 fail(Array.isArray(input.requirements)&&input.requirements.length>=1&&input.requirements.length<=100,"invalid requirements");
 const operationIds=Object.fromEntries(kinds.map(k=>[k,
  k==="increment"?"increase"+p.entity+"Quantity":k==="rename"?"rename"+p.entity:k==="list"?"list"+p.entity+"s":k+p.entity]));
 const known=new Set(Object.values(operationIds));
 const ids=[];
 for(const r of input.requirements){
  exactly(r,["id","text","origin","evidenceRefs","scope","operations"],
   ["id","text","origin","evidenceRefs","scope","operations"],"requirement");
  fail(typeof r.id==="string"&&/^[A-Z][A-Z0-9-]{1,50}$/.test(r.id),"invalid requirement id");
  ids.push(r.id);text(r.text,"requirement",1000);
  fail(originSet.has(r.origin),"unknown requirement origin");
  fail(Array.isArray(r.evidenceRefs)&&r.evidenceRefs.length<=20&&r.evidenceRefs.every(v=>typeof v==="string"&&v.length>0&&v.length<=200),"invalid evidence refs");
  fail(["supported","deferred"].includes(r.scope),"invalid requirement scope");
  fail(Array.isArray(r.operations)&&r.operations.length<=5,"invalid operation mapping");
  unique(r.operations,"mapped operation");
  for(const op of r.operations)fail(known.has(op),"unknown mapped operation "+op);
  fail(r.scope!=="deferred"||r.operations.length===0,"deferred requirement cannot claim code");
  fail(r.origin!=="agent_assumption"||r.operations.length===0,"agent assumption cannot claim executable behavior");
  if(r.scope==="supported")fail(r.operations.length>0&&r.origin!=="agent_assumption",
   "supported requirement must have actual operation mapping and declared source");
 }
 unique(ids,"requirement ids");
 fail(Array.isArray(input.questions)&&input.questions.length<=100,"invalid questions");
 const qids=[];
 for(const q of input.questions){
  exactly(q,["id","question","classification","state","affectsSupported","origin","evidenceRefs","decision"],
   ["id","question","classification","state","affectsSupported","origin","evidenceRefs"],"question");
  fail(typeof q.id==="string"&&/^[A-Z][A-Z0-9-]{1,50}$/.test(q.id),"invalid question id");
  qids.push(q.id);text(q.question,"question",1000);
  fail(classes.has(q.classification),"invalid question class");
  fail(["unresolved","provisional","resolved"].includes(q.state),"invalid question state");
  fail(typeof q.affectsSupported==="boolean","affectsSupported must be boolean");
  fail(originSet.has(q.origin),"invalid question origin");
  fail(Array.isArray(q.evidenceRefs)&&q.evidenceRefs.length<=20&&q.evidenceRefs.every(v=>typeof v==="string"&&v.length>0&&v.length<=200),"invalid question refs");
  if(q.decision!==undefined)text(q.decision,"decision",500);
  if(q.state==="resolved"){
   fail(typeof q.decision==="string"&&q.decision.length>0,"resolved question needs decision");
   fail(q.origin!=="agent_assumption"&&q.evidenceRefs.length>0,
    "resolved question needs declared non-agent source with provenance");
  }
  if(q.state==="provisional")fail(q.classification==="reversible_technical"&&q.origin==="agent_assumption",
    "only reversible technical choices may be agent-provisional");
 }
 unique(qids,"question ids");unique([...ids,...qids],"all IDs");
 return {draft:input,operationIds};
}
const tspConfig='kind: project\nentrypoint: contracts/main.tsp\nemit:\n  - "@protocolia/compiler"\n  - "@typespec/openapi3"\noptions:\n  "@typespec/openapi3":\n    "file-type": json\n    "openapi-versions":\n      - 3.1.0\noutput-dir: "{project-root}/tsp-output"\n';
function specFor(p,n){
 const E=p.entity,K=p.identity.name,L=p.label.name,Q=p.quantity.name;
 const typ=s=>JSON.stringify(s);
 const entityFields=[
  "    @publicIdentity @unique @minLength(1) @maxLength("+p.identity.maxLength+") "+K+": string;",
  "    @minLength(1) @maxLength("+p.label.maxLength+") "+L+": string;",
  "    @minValue(0) @maxValue("+p.quantity.maxValue+") "+Q+": int32;"
 ];
 const requestFields=entityFields.map(s=>s.replace("    @publicIdentity @unique ","    "));
 const route="/api/"+p.resource, name=p.entity[0].toLowerCase()+p.entity.slice(1);
 const lines=[
  'import "@typespec/http";','import "@protocolia/domain";',
  "using TypeSpec.Http;","using ProtocolIA.Domain;","",
  "@service(#{ title: "+typ(p.title)+" })","namespace "+p.namespace+" {",
  "  @entity","  @view("+typ(p.view)+")","  model "+E+" {",...entityFields,"  }","",
  "  model "+E+"Request {",...requestFields,"  }","",
  "  model QuantityAdjustment {","    @minValue(1) @maxValue(1000) delta: int32;","  }","",
  "  model "+E+"NameChange {","    @minLength(1) @maxLength("+p.label.maxLength+") "+L+": string;","  }","",
  "  model "+E+"Page {","    items: "+E+"[];","    @minValue(1) @maxValue(50) limit: int32;",
  "    @minValue(0) offset: int32;","    @minValue(0) total: int32;","  }",
  "  model Health { status: string; }","",
  ...[["NotFound",404],["Conflict",409],["BadRequest",400],["Unauthorized",401],["Forbidden",403]]
    .map(([x,code])=>"  @error model "+x+" { @statusCode _: "+code+"; message: string; }"),"",
  "  @route("+typ(route)+")","  @post","  @behavior("+typ("create")+", "+typ(E)+")",
  "  @capability("+typ(p.capabilityRoot+".write")+")",
  "  op "+n.create+"(@body input: "+E+"Request):",
  "      { @statusCode _: 201; @body "+name+": "+E+"; }",
  "    | Conflict | BadRequest | Unauthorized | Forbidden;","",
  "  @route("+typ(route+"/{"+K+"}")+")","  @get","  @behavior("+typ("get")+", "+typ(E)+")",
  "  @capability("+typ(p.capabilityRoot+".read")+")",
  "  op "+n.get+"(@path "+K+": string): "+E+" | NotFound | Unauthorized | Forbidden;","",
  "  @route("+typ(route)+")","  @get","  @behavior("+typ("listPage")+", "+typ(E)+")",
  "  @capability("+typ(p.capabilityRoot+".read")+")",
  "  op "+n.list+"(",
  "    @query @minValue(1) @maxValue(50) limit?: int32 = 25,",
  "    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0",
  "  ): "+E+"Page | BadRequest | Unauthorized | Forbidden;","",
  "  @route("+typ(route+"/{"+K+"}/"+Q)+")","  @patch",
  "  @behavior("+typ("atomicIncrement")+", "+typ(E)+", "+typ(Q)+", "+typ("delta")+")",
  "  @capability("+typ(p.capabilityRoot+".write")+")",
  "  op "+n.increment+"(@path "+K+": string, @body input: QuantityAdjustment):",
  "      "+E+" | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;","",
  "  @route("+typ(route+"/{"+K+"}/"+L)+")","  @patch",
  "  @behavior("+typ("patchFields")+", "+typ(E)+", "+typ(L)+", "+typ(L)+")",
  "  @capability("+typ(p.capabilityRoot+".write")+")",
  "  op "+n.rename+"(@path "+K+": string, @body input: "+E+"NameChange):",
  "      "+E+" | NotFound | BadRequest | Unauthorized | Forbidden;","",
  '  @route("/health")','  @get','  @behavior("health", '+typ(E)+')',
  '  @capability("public")','  op health(): Health;',"}",""
 ];
 return lines.join("\n");
}
function prepare(input,inputBytes){
 const {draft,operationIds:n}=validateDraft(input);
 const blockers=draft.questions.filter(q=>q.affectsSupported&&
  (q.state!=="resolved"||q.classification!=="reversible_technical"));
 fail(blockers.length===0,"unresolved or material question affects generated profile: "+blockers.map(q=>q.id).join(","));
 const details=draft.questions.filter(q=>q.state!=="resolved"||q.classification!=="reversible_technical");
 const report={schemaVersion:"protocolia-intake-report/v0.1",status:details.length||draft.requirements.some(r=>r.scope==="deferred")?
  "PARTIAL_DRAFT_UNVERIFIED":"DRAFT_UNVERIFIED",sourceSha256:sha(inputBytes),
  generatedOperations:Object.values(n),deferredRequirements:draft.requirements.filter(r=>r.scope==="deferred").map(r=>r.id),
  questions:details.map(q=>({id:q.id,state:q.state,classification:q.classification,affectsSupported:q.affectsSupported})),
  limitations:["No AI agent or customer evidence was authenticated","Only one 3-field administrative profile with 5 operations was generated",
   "Unimplemented or unresolved requirements remain visible","No app execution or production authorization is implied"]};
 const mapping={schemaVersion:"protocolia-requirements/v1",requirements:draft.requirements.map(r=>({
  id:r.id,text:r.text,origin:r.origin,evidenceRefs:r.evidenceRefs,operations:r.operations
 }))};
 const files=new Map([
  ["contracts/main.tsp",specFor(draft.project,n)],["tspconfig.yaml",tspConfig],
  ["requirements.json",json(mapping)],["protocolia-intake-report.json",json(report)]
 ]);
 const lock={schemaVersion:"protocolia-intake-lock/v0.1",generator:"protocolia-structured-intake@0.1.0",
  sourceSha256:sha(inputBytes),files:Object.fromEntries([...files].map(([p,v])=>[p,sha(v)]).sort((a,b)=>a[0].localeCompare(b[0])))};
 files.set("protocolia-intake.lock.json",json(lock));
 return {files,report};
}
function filesAt(root){const r=[];function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
 fail(!e.isSymbolicLink(),"symlink in output");const p=join(dir,e.name);if(e.isDirectory())walk(p);
 else{fail(e.isFile(),"unexpected output item");r.push(p.slice(root.length+1).replaceAll("\\","/"));}}}walk(root);return r.sort();}
export function compileDraft(draftPath,outPath,mode="generate"){
 const path=resolve(draftPath),out=resolve(outPath);
 fail(out!==path&&!out.startsWith(path+"/"),"output aliases input");
 const raw=inputFile(path),{files,report}=prepare(JSON.parse(raw.toString("utf8")),raw);
 if(mode==="generate"){
  if(existsSync(out))fail(lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink()&&readdirSync(out).length===0,"output must be an empty directory");
  else mkdirSync(out,{recursive:true});
  for(const [name,body] of files){const file=join(out,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body,{flag:"wx"});}
  return {status:report.status,files:files.size,sourceSha256:report.sourceSha256};
 }
 fail(mode==="verify","unknown mode");
 fail(existsSync(out)&&lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink(),"output missing");
 fail(JSON.stringify(filesAt(out))===JSON.stringify([...files.keys()].sort()),"output file inventory changed");
 for(const [name,body] of files)fail(sha(inputFile(join(out,name)))===sha(body),"generated draft drift: "+name);
 return {status:"CONSISTENT_DRAFT_NOT_ATTESTED",files:files.size,sourceSha256:report.sourceSha256};
}
export function main(args){
 fail(["generate","verify"].includes(args[0]),"usage: intake-to-typespec.mjs generate|verify <draft.json> <new-output-dir>");
 fail(args.length===3,"expected draft and output");
 const x=compileDraft(args[1],args[2],args[0]);process.stdout.write(json(x));return 0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=main(process.argv.slice(2));}
 catch(e){process.stderr.write("INTAKE_REJECTED: "+String(e.message).slice(0,220)+"\n");process.exitCode=1;}
}
