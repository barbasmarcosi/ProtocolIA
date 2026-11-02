#!/usr/bin/env node
// R2.5: fixed multi-entity stock profile driven by untrusted agent proposals.
// Deliberately NOT an arbitrary natural-language domain compiler.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,lstatSync,readdirSync,mkdirSync,existsSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const template=join(repoRoot,"examples/vnext/stock-debit/contracts/main.tsp");
const configFile=join(repoRoot,"examples/vnext/stock-debit/tspconfig.yaml");
const json=v=>JSON.stringify(v,null,2)+"\n";
const sha=v=>createHash("sha256").update(v).digest("hex");
function check(v,s){if(!v)throw Error(s);}
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function exact(x,keys,label){check(obj(x)&&Object.keys(x).length===keys.length&&Object.keys(x).every(k=>keys.includes(k)),label+" has unknown/missing fields");}
function phrase(x,label){check(typeof x==="string"&&x.length>0&&x.length<=1000&&x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x),label+" invalid text");}
function id(x){check(typeof x==="string"&&/^[A-Z][A-Z0-9-]{1,50}$/.test(x),"invalid stock ID");}
function unique(x,label){check(new Set(x).size===x.length,"duplicate "+label);}
function raw(path){const s=lstatSync(resolve(path));check(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=262144,"unsafe source file");return readFileSync(resolve(path));}
const profile="stock-debit-lab/v0";
const operations=["createStockItem","getStockItem","listStockItems","createStockDebit","getStockDebit","listStockDebits","reverseStockDebit","health"];
const classes=new Set(["reversible_technical","material_business","security_privilege","external_effect","destructive_change"]);
const eq=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function checkStockBrief(brief){
 exact(brief,["schemaVersion","project","facts","knownQuestions"],"stock brief");
 check(brief.schemaVersion==="protocolia-agent-brief/v0.2","unsupported stock brief");
 exact(brief.project,["profile","namespace","title"],"stock project");
 check(brief.project.profile===profile&&brief.project.namespace==="StockDebitLab","unknown stock profile");
 phrase(brief.project.title,"project title");check(brief.project.title.length<=120,"project title too long");
 check(Array.isArray(brief.facts)&&brief.facts.length>0&&brief.facts.length<=30,"invalid stock facts");
 check(Array.isArray(brief.knownQuestions)&&brief.knownQuestions.length<=40,"invalid known questions");
 const allIds=[],claimed=[];
 for(const f of brief.facts){
  exact(f,["id","text","scope","expectedOperations"],"stock fact");
  id(f.id);phrase(f.text,"stock fact");
  check(["supported","deferred"].includes(f.scope),"bad fact scope");
  check(Array.isArray(f.expectedOperations)&&f.expectedOperations.length<=8&&
   f.expectedOperations.every(op=>typeof op==="string"&&operations.includes(op)),"bad stock operation");
  unique(f.expectedOperations,"stock operations per fact");
  check(f.scope==="supported"?f.expectedOperations.length>0:f.expectedOperations.length===0,"unsupported fact coverage");
  claimed.push(...f.expectedOperations);allIds.push(f.id);
 }
 unique(claimed,"stock operations across facts");
 check(eq(claimed,operations),"stock profile must cover exactly eight frozen operations");
 for(const q of brief.knownQuestions){
  exact(q,["id","question","classification","affectsSupported"],"known question");
  id(q.id);phrase(q.question,"known question");
  check(classes.has(q.classification)&&typeof q.affectsSupported==="boolean","invalid known question");
  allIds.push(q.id);
 }
 unique(allIds,"stock source IDs");
 return brief;
}
export function admitStockProposal(brief,proposal,briefSha,proposalSha){
 checkStockBrief(brief);
 exact(proposal,["schemaVersion","briefSha256","mappings","discoveredQuestions","hypotheses"],"stock proposal");
 check(proposal.schemaVersion==="protocolia-agent-proposal/v0.1"&&
  /^[a-f0-9]{64}$/.test(briefSha)&&/^[a-f0-9]{64}$/.test(proposalSha)&&
  proposal.briefSha256===briefSha,"stock proposal hash mismatch");
 check(Array.isArray(proposal.mappings)&&proposal.mappings.length===brief.facts.length,"missing stock mappings");
 const sources=new Map(brief.facts.map(f=>[f.id,f])),mapped=new Map();
 for(const m of proposal.mappings){
  exact(m,["sourceId","operations"],"mapping");id(m.sourceId);
  check(sources.has(m.sourceId)&&!mapped.has(m.sourceId),"invented or duplicate stock mapping");
  check(Array.isArray(m.operations)&&m.operations.every(x=>typeof x==="string")&&
   eq(m.operations,sources.get(m.sourceId).expectedOperations),"agent changed frozen operations: "+m.sourceId);
  mapped.set(m.sourceId,[...m.operations]);
 }
 check(Array.isArray(proposal.discoveredQuestions)&&proposal.discoveredQuestions.length<=40,"bad discovered questions");
 check(Array.isArray(proposal.hypotheses)&&proposal.hypotheses.length<=40,"bad hypotheses");
 const seen=new Set([...sources.keys(),...brief.knownQuestions.map(q=>q.id)]);
 const questions=brief.knownQuestions.map(q=>({...q,state:"unresolved",origin:"source_brief_unverified",
  evidenceRefs:["brief-sha256:"+briefSha+"#"+q.id]}));
 for(const q of proposal.discoveredQuestions){
  check(obj(q)&&["id","question","classification","affectsSupported"].every(k=>Object.hasOwn(q,k))&&
   Object.keys(q).every(k=>["id","question","classification","affectsSupported","provisionalDecision"].includes(k)),
   "unexpected discovered question field");
  id(q.id);check(!seen.has(q.id),"duplicate or modified question");seen.add(q.id);
  phrase(q.question,"question");check(classes.has(q.classification)&&typeof q.affectsSupported==="boolean","bad question metadata");
  if(q.provisionalDecision!==undefined){
   phrase(q.provisionalDecision,"provisional decision");
   check(q.classification==="reversible_technical","material decisions cannot be provisional");
  }
  questions.push({id:q.id,question:q.question,classification:q.classification,
   affectsSupported:q.affectsSupported,origin:"agent_assumption",evidenceRefs:[],
   state:q.provisionalDecision===undefined?"unresolved":"provisional",
   ...(q.provisionalDecision===undefined?{}:{decision:q.provisionalDecision})});
 }
 const requirements=brief.facts.map(f=>({id:f.id,text:f.text,origin:"source_brief_unverified",
  evidenceRefs:["brief-sha256:"+briefSha+"#"+f.id],scope:f.scope,operations:mapped.get(f.id)}));
 for(const h of proposal.hypotheses){
  exact(h,["id","text"],"hypothesis");id(h.id);check(!seen.has(h.id),"duplicate hypothesis ID");
  seen.add(h.id);phrase(h.text,"hypothesis");
  requirements.push({id:h.id,text:h.text,origin:"agent_assumption",evidenceRefs:[],
   scope:"deferred",operations:[]});
 }
 return {
  intake:{schemaVersion:"protocolia-stock-intake/v0.1",project:brief.project,requirements,questions},
  provenance:{schemaVersion:"protocolia-agent-provenance/v0.1",status:"SOURCE_ANCHORED_DRAFT_UNVERIFIED",
   sourceSha256:briefSha,agentProposalSha256:proposalSha,
   sourceFactIds:brief.facts.map(f=>f.id),agentHypothesisIds:proposal.hypotheses.map(h=>h.id),
   knownQuestionIds:brief.knownQuestions.map(q=>q.id),
   limitations:["Source brief is not authenticated owner approval",
    "Frozen two-entity template, not arbitrary domain synthesis",
    "Unresolved questions and agent hypotheses never gain automatic authority",
    "No real agent execution or cost evidence is proven by this file gateway"]}
 };
}
function planned(briefPath,proposalPath){
 const bb=raw(briefPath),pb=raw(proposalPath);
 const {intake,provenance}=admitStockProposal(JSON.parse(bb),JSON.parse(pb),sha(bb),sha(pb));
 const blockers=intake.questions.filter(q=>q.affectsSupported&&
  (q.state!=="resolved"||q.classification!=="reversible_technical"));
 check(blockers.length===0,"stock intake material question blocks TypeSpec: "+blockers.map(q=>q.id).join(","));
 const tpl=raw(template).toString("utf8"),config=raw(configFile).toString("utf8");
 for(const required of ["namespace StockDebitLab",
  '@reserve("StockItem", "available", "stockSku", "units")',
  '@release("StockItem", "available", "stockSku", "units")',
  '@audit("state")','@transition("posted", "reversed")'])
  check(tpl.includes(required),"audited stock TypeSpec template drift: "+required);
 const label=JSON.stringify(intake.project.title);
 check(tpl.includes('title: "Stock Debit Laboratory"'),"unexpected audited template service title");
 const tsp=tpl.replace('title: "Stock Debit Laboratory"','title: '+label);
 const sourceSha256=sha(bb),agentProposalSha256=sha(pb);
 const report={schemaVersion:"protocolia-intake-report/v0.1",status:"PARTIAL_DRAFT_UNVERIFIED",
  sourceSha256,agentProposalSha256,generatorProfile:profile,templateSha256:sha(tpl),
  generatedOperations:operations,
  deferredRequirements:intake.requirements.filter(x=>x.scope==="deferred").map(x=>x.id),
  questions:intake.questions,
  limitations:["The generator selects a frozen, previously verified two-entity TypeSpec",
   "Not a sales/payment system, not SKU normalization or authenticated business approval",
   "Agent text cannot alter SQL, FKs, roles, mutation or reversal policies"]};
 const files=new Map([
  ["contracts/main.tsp",tsp],["tspconfig.yaml",config],
  ["requirements.json",json({schemaVersion:"protocolia-requirements/v1",requirements:intake.requirements})],
  ["decisions.json",json({schemaVersion:"protocolia-decision-ledger/v0.1",
    authority:"SELF_DECLARED_UNVERIFIED",sourceSha256,decisions:intake.questions})],
  ["protocolia-intake-report.json",json(report)],
  ["source-provenance.json",json(provenance)]
 ]);
 const lock={schemaVersion:"protocolia-stock-intake-lock/v0.1",sourceSha256,
  agentProposalSha256,templateSha256:sha(tpl),generator:"protocolia-stock-agent-intake@0.1.0",
  files:Object.fromEntries([...files].map(([path,body])=>[path,sha(body)]).sort((a,b)=>a[0].localeCompare(b[0])))};
 files.set("protocolia-intake.lock.json",json(lock));
 return files;
}
export function compileStockBrief(briefPath,proposalPath,outPath,mode="generate"){
 check(["generate","verify"].includes(mode),"invalid stock generator command");
 const out=resolve(outPath),brief=resolve(briefPath),proposal=resolve(proposalPath);
 check(out!==brief&&out!==proposal&&!brief.startsWith(out+"/")&&!proposal.startsWith(out+"/"),
  "output directory contains source input");
 const files=planned(briefPath,proposalPath);
 if(mode==="generate"){
  if(existsSync(out))check(lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink()&&
   readdirSync(out).length===0,"stock output must be empty");
  else mkdirSync(out,{recursive:true,mode:0o700});
  for(const [name,body] of files){const p=join(out,name);
   mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body,{flag:"wx",mode:0o600});}
 }else{
  check(existsSync(out)&&lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink(),"output missing");
  const found=[];function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
   check(e.isFile()||e.isDirectory(),"invalid output node");
   const p=join(dir,e.name);if(e.isDirectory())walk(p);else found.push(p.slice(out.length+1).replaceAll("\\","/"));
  }}walk(out);
  check(eq(found,[...files.keys()]),"stock generated inventory drift");
  for(const [name,body] of files)check(sha(raw(join(out,name)))===sha(body),"stock artifact drift: "+name);
 }
 return {status:mode==="generate"?"PARTIAL_DRAFT_UNVERIFIED":"CONSISTENT_DRAFT_NOT_ATTESTED",
  files:files.size,sourceSha256:JSON.parse(files.get("protocolia-intake.lock.json")).sourceSha256};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  check(process.argv.length===6,
   "usage: stock-debit-intake.mjs generate|verify <brief.json> <agent-proposal.json> <out>");
  process.stdout.write(json(compileStockBrief(...process.argv.slice(3),process.argv[2])));
 }catch(e){process.stderr.write("STOCK_INTAKE_REJECTED: "+String(e.message).slice(0,200)+"\n");process.exitCode=1;}
}
