#!/usr/bin/env node
// R3: deterministic portable documentation derived ONLY from canonical ProtocolIA IR.
// No LLM calls, source edits, external effects or implied business approval.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,lstatSync} from "node:fs";
import {join,dirname,resolve,relative,sep} from "node:path";
import {fileURLToPath} from "node:url";
const VALID_ID=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const KINDS=new Set("lookupExactAdjustment adjustExact create get listPage auditPage inboxPage ackNotification queryPage sumRelated sumDetails reconcileExact replaceDetails patchFields patchTogether atomicIncrement transition reassignReference delete health".split(" "));
const TYPES=new Set(["string","int32","utcDateTime","decimal"]);
const ORIGINS=new Set(["explicit_owner","approved_policy","trusted_existing_contract","agent_assumption"]);
const sha=v=>createHash("sha256").update(v).digest("hex");
const obj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
function check(x,message){if(!x)throw Error(message);}
function id(x,kind){check(typeof x==="string"&&VALID_ID.test(x),"unsafe "+kind);}
function ordered(xs,key="name"){return [...xs].sort((a,b)=>a[key].localeCompare(b[key],"en"));}
function unique(xs,thing){check(new Set(xs).size===xs.length,"duplicate "+thing);}
function json(x){const canonical=x=>Array.isArray(x)?x.map(canonical):obj(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;return JSON.stringify(canonical(x),null,2)+"\n";}
function read(path){const s=lstatSync(resolve(path));check(s.isFile()&&!s.isSymbolicLink()&&s.size<4194304,"unsafe file input");return readFileSync(resolve(path));}
export function validateIr(ir){
 check(obj(ir)&&ir.irVersion==="vnext-a0.1","unsupported IR version");id(ir.namespace,"namespace");
 check(Array.isArray(ir.entities)&&ir.entities.length>0&&ir.entities.length<=100,"invalid entities");
 check(Array.isArray(ir.operations)&&ir.operations.length<=600,"invalid operations");
 for(const e of ir.entities){
  id(e.name,"entity");id(e.publicIdentity,"identity");check(Array.isArray(e.fields)&&e.fields.length>0&&e.fields.length<=150,"invalid fields");
  for(const f of e.fields){id(f.name,"field");check(TYPES.has(f.type),"unsupported field type");
   check(typeof f.required==="boolean"&&typeof f.nullable==="boolean","invalid required/nullable");
   if(f.reference){id(f.reference.target,"FK target");check(f.reference.onDelete==="restrict","unsupported FK behavior");}
   if(f.initial!==undefined)check(typeof f.initial==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(f.initial),"invalid state");
  }
  unique(e.fields.map(f=>f.name),"fields");check(e.fields.some(f=>f.name===e.publicIdentity),"missing public identity");
 }
 unique(ir.entities.map(e=>e.name),"entities");const names=new Set(ir.entities.map(e=>e.name));
 for(const e of ir.entities)for(const f of e.fields)if(f.reference)check(names.has(f.reference.target),"unresolved FK");
 for(const op of ir.operations){
  id(op.name,"operation");id(op.entity,"operation entity");check(names.has(op.entity),"unknown operation entity");
  check(obj(op.behavior)&&KINDS.has(op.behavior.kind),"unsupported behavior");
  check(["GET","POST","PUT","PATCH","DELETE"].includes(op.method),"invalid method");
  check(typeof op.path==="string"&&/^\/[A-Za-z0-9_{}\/.-]*$/.test(op.path),"unsafe path");
  check(typeof op.capability==="string"&&/^[A-Za-z][A-Za-z0-9._-]{0,100}$/.test(op.capability),"invalid capability");
  if(op.behavior.kind==="transition")check([op.behavior.from,op.behavior.to].every(s=>typeof s==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(s)),"invalid transition");
 }
 unique(ir.operations.map(op=>op.name),"operations");return ir;
}
function claims(map,ir){
 if(map===undefined)return [];
 check(obj(map)&&map.schemaVersion==="protocolia-requirements/v1"&&Array.isArray(map.requirements)&&map.requirements.length<=1000,"invalid requirements");
 const known=new Set(ir.operations.map(o=>o.name));const all=[];
 for(const r of map.requirements){
  check(obj(r)&&typeof r.id==="string"&&/^[A-Z][A-Z0-9-]{1,50}$/.test(r.id),"invalid requirement ID");all.push(r.id);
  check(typeof r.text==="string"&&r.text.length>0&&r.text.length<=1000,"invalid requirement text");
  check(ORIGINS.has(r.origin),"invalid origin");
  check(Array.isArray(r.evidenceRefs)&&r.evidenceRefs.length<=20&&r.evidenceRefs.every(x=>typeof x==="string"&&x.length>0&&x.length<256),"invalid evidence");
  check(Array.isArray(r.operations)&&r.operations.length<=100,"invalid mapped operations");unique(r.operations,"mapped operations");
  for(const op of r.operations)check(known.has(op),"unknown mapped operation");
  if(r.origin==="agent_assumption")check(r.operations.length===0,"AI assumption cannot claim executable coverage");
 }
 unique(all,"requirements");return ordered(map.requirements,"id");
}
function decisionClaims(doc){
 if(doc===undefined)return [];
 check(obj(doc)&&doc.schemaVersion==="protocolia-decision-ledger/v0.1"&&doc.authority==="SELF_DECLARED_UNVERIFIED"&&
   typeof doc.sourceSha256==="string"&&/^[0-9a-f]{64}$/.test(doc.sourceSha256)&&
   Array.isArray(doc.decisions)&&doc.decisions.length<=100,"invalid decision ledger");
 const types=new Set(["reversible_technical","material_business","security_privilege","external_effect","destructive_change"]);
 const states=new Set(["resolved","unresolved","provisional"]);
 const ids=[];
 for(const d of doc.decisions){
  check(obj(d)&&typeof d.id==="string"&&/^[A-Z][A-Z0-9-]{1,50}$/.test(d.id),"invalid decision ID");ids.push(d.id);
  check(typeof d.question==="string"&&d.question.trim().length>0&&d.question.length<=1000,"invalid decision question");
  check(types.has(d.classification)&&states.has(d.state),"unknown classification/state");
  check(typeof d.affectsSupported==="boolean"&&ORIGINS.has(d.origin),"invalid decision origin/scope");
  check(Array.isArray(d.evidenceRefs)&&d.evidenceRefs.length<=20&&d.evidenceRefs.every(x=>typeof x==="string"&&x.length>0&&x.length<=200),"invalid decision references");
  if(d.decision!==undefined)check(typeof d.decision==="string"&&d.decision.trim().length>0&&d.decision.length<=500,"invalid proposed decision");
  if(d.state==="resolved")check(typeof d.decision==="string"&&d.origin!=="agent_assumption"&&d.evidenceRefs.length>0,"resolved decision lacks declared evidence");
  if(d.state==="provisional")check(d.classification==="reversible_technical"&&d.origin==="agent_assumption","unsafe provisional decision");
 }
 unique(ids,"decisions");return ordered(doc.decisions,"id");
}
function plain(v){return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/[\r\n]/g," ").replace(/\x60/g,"\\x60").replace(/\|/g,"\\|");}
function filesFor(ir,h,rs,rh,ds,dh){
 const entities=ordered(ir.entities),ops=ordered(ir.operations);
 const er=["erDiagram"],edges=[];
 for(const e of entities)for(const f of ordered(e.fields))if(f.reference)edges.push("  "+f.reference.target+" "+(f.required&&!f.nullable?"||--o{":"o|--o{")+" "+e.name+" : \""+f.name+"\"");
 er.push(...edges.sort());
 for(const e of entities){er.push("  "+e.name+" {");for(const f of ordered(e.fields))er.push("    "+f.type+" "+f.name+(f.name===e.publicIdentity?" PK":f.reference?" FK":f.unique?" UK":""));er.push("  }");}
 const states=["stateDiagram-v2"],trans=ops.filter(op=>op.behavior.kind==="transition");
 if(!trans.length)states.push("  %% No declared finite-state transitions.");
 for(const op of trans)states.push("  "+op.entity+"_"+op.behavior.from.replaceAll("-","_")+" --> "+op.entity+"_"+op.behavior.to.replaceAll("-","_")+": "+op.name);
 const intro=[
  "# Project Passport — "+ir.namespace,"",
  "> Generated from TypeSpec canonical IR. No deployment, tests or owner intentions are certified.","",
  "## Model","","- IR SHA-256: "+h,"- IR schema: "+ir.irVersion,
  "- Requirements map: "+(rh?"provided, assertions not independently verified":"absent"),
  "- Decision ledger: "+(dh?"provided (self-declared only)":"absent (rationale UNKNOWN)"),
  "- Entities: "+entities.length+"; operations: "+ops.length+".",
  "- Public identities: "+entities.map(e=>e.name+"."+e.publicIdentity).join(", "),"",
  "## Read next","","- [Domain entities](docs/domain/entities.md)","- [Operations and permissions](docs/domain/operations.md)",
  "- [ER diagram](docs/architecture/data-model.mmd)","- [State diagram](docs/architecture/states.mmd)",
  "- [Traceability](docs/traceability.json)","- [Decision ledger](docs/domain/decisions.md)","- [Operations and limitations](docs/operations/README.md)",
  "- [Agent handoff](AGENTS.md)","",
  "## Not recoverable solely from IR","","- Business rationale and human decision history.",
  "- Actual DB/HTTP/browser test outcomes, deployed IAM, backups, migrations or bank settlement.",
  "- Verified C4 container/deployment topology. Do not invent it.",""];
 const entityDoc=["# Entities","","These declarations describe intent in IR, not observed production enforcement.",""];
 for(const e of entities){entityDoc.push("## "+e.name,"","Identity: "+e.publicIdentity,"",
  "| Field | Type | Required | Nullable | Constraints |","|---|---|---|---|---|");
  for(const f of ordered(e.fields)){
   const c=[];if(f.unique)c.push("unique");if(f.reference)c.push("FK "+f.reference.target+" (restrict)");
   if(f.initial!==undefined)c.push("initial "+f.initial);
   for(const n of ["min","max","minLength","maxLength"])if(f[n]!==undefined)c.push(n+" "+f[n]);
   if(f.decimal)c.push("exact decimal "+f.decimal.precision+","+f.decimal.scale);
   if(f.computedSum)c.push("computed sum");if(f.ownerManaged)c.push("owner-managed");
   entityDoc.push("| "+f.name+" | "+f.type+" | "+(f.required?"yes":"no")+" | "+(f.nullable?"yes":"no")+" | "+c.join("; ")+" |");
  }entityDoc.push("");
 }
 const operationDoc=["# Operations","","Declared routes and capabilities, not verified HTTP results.","",
  "| Name | Route | Entity | Behavior | Capability |","|---|---|---|---|---|"];
 for(const op of ops)operationDoc.push("| "+op.name+" | "+op.method+" "+op.path+" | "+op.entity+" | "+op.behavior.kind+(op.behavior.kind==="transition"?" ("+op.behavior.from+" → "+op.behavior.to+")":"")+" | "+op.capability+" |");
 operationDoc.push("");
 const decisionsDoc=["# Domain decisions and unresolved questions","","Candidate-supplied assertions; NOT authenticated owner intent or automatically implemented features.",""];
 if(!dh)decisionsDoc.push("No decision ledger supplied. Business rationale remains UNKNOWN.","");
 for(const d of ds)decisionsDoc.push("## "+plain(d.id)+" — "+plain(d.state),"",
   "**Question:** "+plain(d.question),"","**Classification:** "+plain(d.classification),"",
   "**Affects supported slice:** "+(d.affectsSupported?"yes":"no"),"",
   "**Declared origin, unverified:** "+plain(d.origin),"",
   "**Candidate decision:** "+(d.decision?plain(d.decision):"UNKNOWN / unresolved"),"",
   "**Evidence references, unauthenticated:** "+(d.evidenceRefs.length?d.evidenceRefs.map(plain).join(", "):"none"),"");
 const trace={schemaVersion:"protocolia-passport-trace/v0.1",irSha256:h,traceAuthority:"DECLARED_UNVERIFIED",requirementMappingProvided:!!rh,
  requirements:rs.map(r=>({id:r.id,text:r.text,origin:r.origin,evidenceRefs:r.evidenceRefs,operations:[...r.operations].sort(),verification:"NOT_RUN"})),
  unmappedOperations:ops.filter(o=>!rs.some(r=>r.operations.includes(o.name))).map(o=>o.name),
  caveat:"Mappings are assertions, not authenticated owner approval or independent test evidence."};
 const operationGuide=["# Operating and evolving the application","","This Passport does not certify production readiness.","",
  "1. Locate the TypeSpec sources, generated app and build metadata; compare IR hashes.",
  "2. Follow the generated app runbook; hostnames, secrets, infrastructure and credentials are not inferred here.",
  "3. Execute independent DB, HTTP and browser conformance on the appropriate target.",
  "4. Rehearse checkpoint/restore and safe migration before modifying a populated database.",
  "5. Regenerate Passport in a fresh empty folder. Verify refuses source or documentation drift.",
  "6. When reasons for a decision are missing, record UNKNOWN; do not infer them from code.",""];
 const agents=["# Agent handoff","","Begin at PROJECT_PASSPORT.md and docs/traceability.json. Then read TypeSpec/IR and independent test results.","",
  "TypeSpec is authoritative for supported executable behavior; generated docs are projections, not proof.",
  "No conversation transcript is required to navigate these files, but unknown rationale remains unknown.",
  "Before edits: review domain constraints, permissions, regression and migration risks.",
  "Never deploy, export private data, process real payments or destructively migrate without scoped permission.",""];
 return new Map([
  ["PROJECT_PASSPORT.md",intro.join("\n")+"\n"],
  ["docs/domain/entities.md",entityDoc.join("\n")+"\n"],
  ["docs/domain/operations.md",operationDoc.join("\n")+"\n"],
  ["docs/domain/decisions.md",decisionsDoc.join("\n")+"\n"],
  ["docs/architecture/data-model.mmd",er.join("\n")+"\n"],
  ["docs/architecture/states.mmd",states.join("\n")+"\n"],
  ["docs/traceability.json",json(trace)],
  ["docs/operations/README.md",operationGuide.join("\n")+"\n"],
  ["AGENTS.md",agents.join("\n")+"\n"]
 ]);
}
function expected(irPath,mappingPath,decisionsPath){
 const bytes=read(irPath),ir=validateIr(JSON.parse(bytes.toString("utf8")));
 const mbytes=mappingPath?read(mappingPath):null;
 const dbytes=decisionsPath?read(decisionsPath):null;
 const req=mbytes?claims(JSON.parse(mbytes.toString("utf8")),ir):[];
 const dec=dbytes?decisionClaims(JSON.parse(dbytes.toString("utf8"))):[];
 const h=sha(bytes),mh=mbytes?sha(mbytes):null,dh=dbytes?sha(dbytes):null,files=filesFor(ir,h,req,mh,dec,dh);
 const lock={schemaVersion:"protocolia-passport/v0.1",generator:"protocolia-passport@0.1.0",
  source:{irSha256:h,requirementsSha256:mh,decisionsSha256:dh},
  files:Object.fromEntries([...files].map(([p,s])=>[p,sha(s)]).sort((a,b)=>a[0].localeCompare(b[0]))),
  limitations:["Unsigned local hash consistency only","No approval or production attestation inferred"]};
 return {files,lock};
}
function location(out,ir,req){const d=resolve(out);check(d!==resolve(ir)&&d!==resolve(req||"__missing__"),"output aliases input");if(existsSync(d))check(lstatSync(d).isDirectory()&&!lstatSync(d).isSymbolicLink(),"unsafe output directory");return d;}
function enumerate(root){const found=[];function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){check(!e.isSymbolicLink(),"symlink artifact");const p=join(dir,e.name);if(e.isDirectory())walk(p);else{check(e.isFile(),"invalid artifact");found.push(relative(root,p).split(sep).join("/"));}}}walk(root);return found.sort();}
export function generatePassport(ir,out,map,decisions){
 const {files,lock}=expected(ir,map,decisions),dest=location(out,ir,map);
 check(!existsSync(dest)||readdirSync(dest).length===0,"output directory must be empty");
 if(!existsSync(dest))mkdirSync(dest,{recursive:true});
 for(const [p,s] of files){const file=join(dest,p);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,s,{flag:"wx"});}
 writeFileSync(join(dest,"protocolia-passport.lock.json"),json(lock),{flag:"wx"});
 return {status:"GENERATED_NOT_ATTESTED",files:files.size,irSha256:lock.source.irSha256};
}
export function verifyPassport(ir,out,map,decisions){
 const {files,lock}=expected(ir,map,decisions),dest=location(out,ir,map);
 check(existsSync(dest)&&lstatSync(dest).isDirectory(),"Passport missing");
 check(JSON.stringify(enumerate(dest))===JSON.stringify([...files.keys(),"protocolia-passport.lock.json"].sort()),"missing or unexpected artifact");
 for(const [p,s] of files)check(sha(read(join(dest,p)))===sha(s),"Passport drift: "+p);
 check(read(join(dest,"protocolia-passport.lock.json")).toString("utf8")===json(lock),"stale Passport manifest");
 return {status:"PASS_PORTABLE_INTEGRITY_ONLY",files:files.size,irSha256:lock.source.irSha256};
}
export function main(argv){
 check(["generate","verify"].includes(argv[0]),"usage: project-passport.mjs generate|verify --ir <ir.json> --out <dir> [--requirements <map.json>] [--decisions <ledger.json>]");
 const a={};for(let i=1;i<argv.length;i+=2){check(["--ir","--out","--requirements","--decisions"].includes(argv[i])&&argv[i+1]&&!a[argv[i]],"unexpected option");a[argv[i]]=argv[i+1];}
 check(a["--ir"]&&a["--out"],"missing --ir or --out");
 const result=argv[0]==="generate"?generatePassport(a["--ir"],a["--out"],a["--requirements"],a["--decisions"]):verifyPassport(a["--ir"],a["--out"],a["--requirements"],a["--decisions"]);
 process.stdout.write(json(result));return 0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=main(process.argv.slice(2));}
 catch(e){process.stderr.write("PROJECT_PASSPORT_REJECTED: "+String(e.message).slice(0,180)+"\n");process.exitCode=1;}
}
