#!/usr/bin/env node
// R2 agent-facing gateway. Source facts supplied independently from agent output.
// This is a provider-neutral FILE protocol, NOT an LLM runtime or authority oracle.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateDraft} from "./intake-to-typespec.mjs";

const hash=b=>createHash("sha256").update(b).digest("hex");
const schema="protocolia-agent-brief/v0.1";
const propSchema="protocolia-agent-proposal/v0.1";
const idPattern=/^[A-Z][A-Z0-9-]{1,50}$/;
const classes=new Set(["reversible_technical","material_business","security_privilege","external_effect","destructive_change"]);
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const deep=x=>JSON.parse(JSON.stringify(x));
const sorted=x=>[...x].sort((a,b)=>a.localeCompare(b,"en"));
function enforce(ok,message){if(!ok)throw new Error(message);}
function shape(x,allowed,required,label){
 enforce(object(x),label+" must be an object");
 for(const k of Object.keys(x))enforce(allowed.includes(k),label+" unexpected field "+k);
 for(const k of required)enforce(Object.hasOwn(x,k),label+" missing field "+k);
}
function phrase(x,label){enforce(typeof x==="string"&&x.trim().length>0&&x.length<=1000&&!/[\u0000-\u001f\u007f]/.test(x),label+" invalid text");return x;}
function identifier(x,label){enforce(typeof x==="string"&&idPattern.test(x),label+" invalid ID");}
function unique(xs,label){enforce(new Set(xs).size===xs.length,"duplicate "+label);}
function raw(path){
 const stat=lstatSync(resolve(path));
 enforce(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=262144,"unsafe gateway input");
 return readFileSync(resolve(path));
}
function stringify(x){return JSON.stringify(x,null,2)+"\n";}
export function checkBrief(brief){
 shape(brief,["schemaVersion","project","facts","knownQuestions"],["schemaVersion","project","facts","knownQuestions"],"brief");
 enforce(brief.schemaVersion===schema,"unsupported brief schema");
 enforce(Array.isArray(brief.facts)&&brief.facts.length>0&&brief.facts.length<=100,"brief requires 1-100 facts");
 enforce(Array.isArray(brief.knownQuestions)&&brief.knownQuestions.length<=100,"invalid knownQuestions");
 const ids=[];
 for(const f of brief.facts){
  shape(f,["id","text","scope","expectedOperations"],["id","text","scope","expectedOperations"],"source fact");
  identifier(f.id,"source fact");ids.push(f.id);phrase(f.text,"source fact");
  enforce(["supported","deferred"].includes(f.scope),"invalid source fact scope");
  enforce(Array.isArray(f.expectedOperations)&&f.expectedOperations.length<=5&&f.expectedOperations.every(x=>typeof x==="string"),"invalid independent expected operations");
  unique(f.expectedOperations,"expected operations");
  enforce(f.scope!=="deferred"||f.expectedOperations.length===0,"deferred source fact cannot claim operations");
  enforce(f.scope!=="supported"||f.expectedOperations.length>0,"supported fact needs independent expected operations");
 }
 for(const q of brief.knownQuestions){
  shape(q,["id","question","classification","affectsSupported"],["id","question","classification","affectsSupported"],"known question");
  identifier(q.id,"known question");ids.push(q.id);phrase(q.question,"known question");
  enforce(classes.has(q.classification),"unknown known-question classification");
  enforce(typeof q.affectsSupported==="boolean","known-question affectsSupported invalid");
 }
 unique(ids,"source IDs");
 // Reuse R2's exact project schema and TypeSpec naming constraints without accepting agent claims.
 const probe={schemaVersion:"protocolia-intake-project/v0.1",project:deep(brief.project),
  requirements:brief.facts.map(f=>({id:f.id,text:f.text,origin:"explicit_owner",evidenceRefs:["source:brief:"+f.id],
    scope:f.scope,operations:[...f.expectedOperations]})),
  questions:brief.knownQuestions.map(q=>({...q,state:"unresolved",origin:"agent_assumption",evidenceRefs:[]}))};
 validateDraft(probe);
 return brief;
}
export function admitProposal(brief,proposal,briefSha,proposalSha){
 checkBrief(brief);
 shape(proposal,["schemaVersion","briefSha256","mappings","discoveredQuestions","hypotheses"],
  ["schemaVersion","briefSha256","mappings","discoveredQuestions","hypotheses"],"agent proposal");
 enforce(proposal.schemaVersion===propSchema,"unsupported agent proposal version");
 enforce(typeof briefSha==="string"&&/^[0-9a-f]{64}$/.test(briefSha),"invalid brief hash");
 enforce(typeof proposalSha==="string"&&/^[0-9a-f]{64}$/.test(proposalSha),"invalid proposal hash");
 enforce(proposal.briefSha256===briefSha,"proposal brief hash mismatch");
 enforce(Array.isArray(proposal.mappings)&&proposal.mappings.length===brief.facts.length,"proposal must cover each source fact exactly once");
 const facts=new Map(brief.facts.map(f=>[f.id,f])),mapping=new Map();
 for(const m of proposal.mappings){
  shape(m,["sourceId","operations"],["sourceId","operations"],"mapping");
  identifier(m.sourceId,"mapping source");
  enforce(facts.has(m.sourceId),"agent cites nonexistent source fact");
  enforce(!mapping.has(m.sourceId),"duplicate fact mapping");
  enforce(Array.isArray(m.operations)&&m.operations.length<=5&&m.operations.every(v=>typeof v==="string"),"invalid mapped operations");
  unique(m.operations,"mapped operations");
  const expected=facts.get(m.sourceId).expectedOperations;
  enforce(JSON.stringify(sorted(m.operations))===JSON.stringify(sorted(expected)),
    "agent mapping differs from independently frozen capability profile: "+m.sourceId);
  mapping.set(m.sourceId,[...m.operations]);
 }
 enforce(Array.isArray(proposal.discoveredQuestions)&&proposal.discoveredQuestions.length<=100,"invalid discoveredQuestions");
 enforce(Array.isArray(proposal.hypotheses)&&proposal.hypotheses.length<=100,"invalid hypotheses");
 const known=new Set(brief.knownQuestions.map(q=>q.id));
 const ids=new Set([...facts.keys(),...known]);
 const questions=brief.knownQuestions.map(q=>({...q,state:"unresolved",origin:"agent_assumption",evidenceRefs:[]}));
 for(const q of proposal.discoveredQuestions){
  shape(q,["id","question","classification","affectsSupported","provisionalDecision"],
    ["id","question","classification","affectsSupported"],"discovered question");
  identifier(q.id,"discovered question");enforce(!ids.has(q.id),"duplicate or overwritten source question");ids.add(q.id);
  phrase(q.question,"discovered question");enforce(classes.has(q.classification),"unknown discovered question classification");
  enforce(typeof q.affectsSupported==="boolean","invalid discovered-question scope");
  if(q.provisionalDecision!==undefined){
   phrase(q.provisionalDecision,"provisional decision");
   enforce(q.classification==="reversible_technical","only reversible technical choices can be provisional");
  }
  questions.push({id:q.id,question:q.question,classification:q.classification,
   affectsSupported:q.affectsSupported,origin:"agent_assumption",evidenceRefs:[],
   state:q.provisionalDecision?"provisional":"unresolved",
   ...(q.provisionalDecision?{decision:q.provisionalDecision}:{})});
 }
 const requirements=brief.facts.map(f=>({id:f.id,text:f.text,origin:"explicit_owner",
   evidenceRefs:["brief-sha256:"+briefSha+"#"+f.id],scope:f.scope,operations:mapping.get(f.id)}));
 for(const h of proposal.hypotheses){
  shape(h,["id","text"],["id","text"],"hypothesis");
  identifier(h.id,"hypothesis");enforce(!ids.has(h.id),"duplicate hypothesis ID");ids.add(h.id);
  phrase(h.text,"hypothesis");
  requirements.push({id:h.id,text:h.text,origin:"agent_assumption",evidenceRefs:[],scope:"deferred",operations:[]});
 }
 const intake={schemaVersion:"protocolia-intake-project/v0.1",
   project:deep(brief.project),requirements,questions};
 validateDraft(intake);
 const provenance={schemaVersion:"protocolia-agent-provenance/v0.1",status:"SOURCE_ANCHORED_DRAFT_UNVERIFIED",
   sourceSha256:briefSha,agentProposalSha256:proposalSha,sourceFactIds:brief.facts.map(f=>f.id),
   agentHypothesisIds:proposal.hypotheses.map(h=>h.id),knownQuestionIds:brief.knownQuestions.map(q=>q.id),
   limitations:["Brief origin chosen by caller is not authenticated as owner consent",
    "Agent was not executed by this gateway; no performance measurements",
    "Facts and exact supported operation sets come from an independent input, not agent assertion",
    "Provisional technical choices and deferred business requirements are NOT implemented",
    "Business interpretation, execution, security, customer sign-off and production readiness NOT verified"]};
 return {intake,provenance};
}
function prepared(briefPath,proposalPath){
 const bb=raw(briefPath),pb=raw(proposalPath);
 const brief=JSON.parse(bb.toString("utf8")),proposal=JSON.parse(pb.toString("utf8"));
 const artifacts=admitProposal(brief,proposal,hash(bb),hash(pb));
 return new Map([["intake.json",stringify(artifacts.intake)],
  ["source-provenance.json",stringify(artifacts.provenance)]]);
}
export function gateway(briefPath,proposalPath,outPath,mode="admit"){
 enforce(["admit","verify"].includes(mode),"invalid mode");
 const files=prepared(briefPath,proposalPath),out=resolve(outPath);
 enforce(out!==resolve(briefPath)&&out!==resolve(proposalPath),"output aliases input");
 if(mode==="admit"){
  if(existsSync(out))enforce(lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink()&&
    readdirSync(out).length===0,"gateway output must be empty");
  else mkdirSync(out,{recursive:true,mode:0o700});
  for(const [name,content] of files)writeFileSync(join(out,name),content,{flag:"wx",mode:0o600});
  return {status:"SOURCE_ANCHORED_DRAFT_UNVERIFIED",sourceSha256:JSON.parse(files.get("source-provenance.json")).sourceSha256};
 }
 enforce(existsSync(out)&&lstatSync(out).isDirectory()&&!lstatSync(out).isSymbolicLink(),"gateway output missing");
 const entries=readdirSync(out);enforce(JSON.stringify(sorted(entries))===JSON.stringify(sorted([...files.keys()])),
  "gateway output has missing or unexpected files");
 for(const [name,content] of files)enforce(hash(raw(join(out,name)))===hash(content),"gateway artifact drift: "+name);
 return {status:"CONSISTENT_SOURCE_ANCHORED_DRAFT_NOT_ATTESTED"};
}
export function promptForBrief(briefPath){
 const bb=raw(briefPath),brief=checkBrief(JSON.parse(bb.toString("utf8")));
 return [
  "# ProtocolIA — bounded requirements extraction task",
  "",
  "This is an untrusted-data-only specification exercise. Do not execute tools, deploy, install, charge, modify credentials or make external calls.",
  "Return ONLY one strict JSON object with schemaVersion protocolia-agent-proposal/v0.1.",
  "Use briefSha256 exactly as given. Cover every fact ID once in mappings; do not rewrite source facts, invent permission or claim an AI hypothesis came from the owner.",
  "Operations must match the fact's independently supplied expectedOperations exactly. Do not silently drop any fact.",
  "Known questions are preserved automatically and cannot be deleted by you. In discoveredQuestions identify ADDITIONAL unknowns with new IDs.",
  "Only reversible_technical questions may include provisionalDecision. A new business, security, external or destructive question MUST remain unresolved.",
  "Additional requirements can appear only in hypotheses and are always deferred until separately established.",
  "If an ambiguity affects a supported operation, set affectsSupported true; the downstream TypeSpec generator will block that profile.",
  "A valid proposal is neither approved requirements nor proof of an implemented application.",
  "",
  "Required JSON keys: schemaVersion, briefSha256, mappings, discoveredQuestions, hypotheses.",
  "Mappings: array of {sourceId, operations}. Discovered question: {id, question, classification, affectsSupported, provisionalDecision?}. Hypothesis: {id,text}.",
  "",
  "## Frozen source brief (authoritative as source text, not authenticated human consent)",
  "",
  JSON.stringify({briefSha256:hash(bb),brief},null,2),
  ""
 ].join("\n");
}
export function main(argv){
 if(argv[0]==="prompt"&&argv.length===2){
  process.stdout.write(promptForBrief(argv[1]));return 0;
 }
 enforce(["admit","verify"].includes(argv[0])&&argv.length===4,
  "usage: agent-intake-gateway.mjs prompt <brief.json> | admit|verify <brief.json> <agent-proposal.json> <output-dir>");
 process.stdout.write(stringify(gateway(argv[1],argv[2],argv[3],argv[0])));return 0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=main(process.argv.slice(2));}
 catch(e){process.stderr.write("AGENT_GATEWAY_REJECTED: "+String(e.message).slice(0,210)+"\n");process.exitCode=1;}
}
