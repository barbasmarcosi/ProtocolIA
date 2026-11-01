import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {admitProposal,checkBrief,gateway,promptForBrief} from "../../scripts/research/agent-intake-gateway.mjs";
import {compileDraft} from "../../scripts/research/intake-to-typespec.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const source=join(root,"research/autonomous-engineering/samples/kiosk-owner-brief.json");
const template=join(root,"research/autonomous-engineering/samples/kiosk-agent-proposal-template.json");
const sha=x=>createHash("sha256").update(x).digest("hex");
function data(){
 const original=readFileSync(source);
 const brief=JSON.parse(original);
 const p=JSON.parse(readFileSync(template,"utf8"));
 p.briefSha256=sha(original);
 return {brief,proposal:p,briefSha:sha(original),proposalSha:sha(JSON.stringify(p))};
}
function harness(fn){
 const dir=mkdtempSync(join(tmpdir(),"protocolia-agent-gateway-"));
 const briefPath=join(dir,"brief.json"),proposalPath=join(dir,"proposal.json"),out=join(dir,"admitted"),contracts=join(dir,"contracts");
 const a=data();writeFileSync(briefPath,readFileSync(source));writeFileSync(proposalPath,JSON.stringify(a.proposal));
 try{return fn({...a,dir,briefPath,proposalPath,out,contracts,writeProposal:p=>writeFileSync(proposalPath,JSON.stringify(p))});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
test("operator-supplied source brief and sample proposal validate",()=>{
 const {brief,proposal,briefSha,proposalSha}=data();
 assert.equal(checkBrief(brief),brief);
 const x=admitProposal(brief,proposal,briefSha,proposalSha);
 assert.equal(x.intake.requirements.length,5);
 assert.equal(x.intake.questions.length,3);
 assert.equal(x.intake.requirements.find(r=>r.id==="K-01").text,brief.facts[0].text);
 assert.equal(x.intake.requirements.find(r=>r.id==="K-05").origin,"agent_assumption");
 assert.deepEqual(x.intake.requirements.find(r=>r.id==="K-05").operations,[]);
 assert.equal(x.intake.questions.find(q=>q.id==="K-Q01").state,"unresolved");
 assert.equal(x.intake.questions.find(q=>q.id==="K-Q03").state,"provisional");
 assert.equal(x.provenance.status,"SOURCE_ANCHORED_DRAFT_UNVERIFIED");
});
test("full bridge: source -> candidate -> admitted draft -> existing TypeSpec generator",()=>harness(x=>{
 assert.equal(gateway(x.briefPath,x.proposalPath,x.out).status,"SOURCE_ANCHORED_DRAFT_UNVERIFIED");
 assert.equal(gateway(x.briefPath,x.proposalPath,x.out,"verify").status,"CONSISTENT_SOURCE_ANCHORED_DRAFT_NOT_ATTESTED");
 const normalized=join(x.out,"intake.json");
 assert.equal(compileDraft(normalized,x.contracts).status,"PARTIAL_DRAFT_UNVERIFIED");
 assert.equal(compileDraft(normalized,x.contracts,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
 const decisions=JSON.parse(readFileSync(join(x.contracts,"decisions.json"),"utf8"));
 assert.equal(decisions.authority,"SELF_DECLARED_UNVERIFIED");
 assert.match(decisions.decisions.find(q=>q.id==="K-Q02").question,/return/);
 const report=JSON.parse(readFileSync(join(x.contracts,"protocolia-intake-report.json"),"utf8"));
 assert.deepEqual(report.deferredRequirements,["K-04","K-05"]);
}));
test("source owner facts cannot be rewritten or replaced through agent output",()=>harness(x=>{
 x.proposal.mappings[0].text="Unauthorized changed requirement";
 x.writeProposal(x.proposal);
 assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out),/unexpected field/);
 assert.equal(existsSync(x.out),false);
}));
test("source mutation invalidates proposal binding even when names are unchanged",()=>harness(x=>{
 x.brief.facts[0].text="A different requirement";
 writeFileSync(x.briefPath,JSON.stringify(x.brief));
 assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out),/hash mismatch/);
}));
test("agent cannot silently downgrade, expand or omit frozen mapped behaviors",()=>harness(x=>{
 x.proposal.mappings[0].operations=["createProduct"];
 x.writeProposal(x.proposal);assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out),/differs from independently frozen/);
 x.proposal.mappings[0].operations=["createProduct","getProduct","listProducts","deleteProduct"];
 x.writeProposal(x.proposal);assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out),/differs from independently frozen/);
 x.proposal.mappings.splice(1,1);x.writeProposal(x.proposal);
 assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out),/cover each source fact/);
}));
test("agent cannot forge approval, origin, action requests, or overwrite known questions",()=>harness(x=>{
 x.proposal.origin="explicit_owner";
 x.writeProposal(x.proposal);assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out),/unexpected field/);
 delete x.proposal.origin;
 x.proposal.discoveredQuestions[0].id="K-Q01";
 x.writeProposal(x.proposal);assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out),/duplicate or overwritten/);
 x.proposal.discoveredQuestions[0].id="K-Q03";
 x.proposal.discoveredQuestions[0].classification="external_effect";
 x.writeProposal(x.proposal);assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out),/only reversible technical/);
}));
test("new material business uncertainty affecting generated behavior blocks downstream compiler",()=>harness(x=>{
 x.proposal.discoveredQuestions.push({id:"K-Q04",question:"Can stock drop below zero after sale?",
  classification:"material_business",affectsSupported:true});
 x.writeProposal(x.proposal);
 gateway(x.briefPath,x.proposalPath,x.out);
 assert.throws(()=>compileDraft(join(x.out,"intake.json"),x.contracts),/material question affects/);
 assert.equal(existsSync(x.contracts),false);
}));
test("required source business question cannot be omitted by agent",()=>harness(x=>{
 x.proposal.discoveredQuestions=[];
 x.writeProposal(x.proposal);
 gateway(x.briefPath,x.proposalPath,x.out);
 const normalized=JSON.parse(readFileSync(join(x.out,"intake.json"),"utf8"));
 assert.ok(normalized.questions.some(q=>q.id==="K-Q01"&&q.state==="unresolved"));
 assert.ok(normalized.questions.some(q=>q.id==="K-Q02"&&q.state==="unresolved"));
}));
test("gateway refuses overwritten files and detects input/output drift",()=>harness(x=>{
 gateway(x.briefPath,x.proposalPath,x.out);
 assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out),/must be empty/);
 const edited=join(x.out,"intake.json");
 writeFileSync(edited,readFileSync(edited,"utf8")+"\n");
 assert.throws(()=>gateway(x.briefPath,x.proposalPath,x.out,"verify"),/drift/);
}));
test("prompt is deterministic and does not claim owner attestation or agent execution",()=>{
 const first=promptForBrief(source);
 assert.equal(first,promptForBrief(source));
 assert.match(first,/Return ONLY one strict JSON/);
 assert.match(first,/not authenticated human consent/);
 assert.match(first,/K-01/);
});
test("CLI prompt and reject missing/forged proposal by exit status",()=>harness(x=>{
 const cli=join(root,"scripts/research/agent-intake-gateway.mjs");
 const p=spawnSync(process.execPath,[cli,"prompt",x.briefPath],{encoding:"utf8"});
 assert.equal(p.status,0,p.stderr);
 assert.match(p.stdout,/briefSha256/);
 x.proposal.briefSha256="0".repeat(64);x.writeProposal(x.proposal);
 const r=spawnSync(process.execPath,[cli,"admit",x.briefPath,x.proposalPath,x.out],{encoding:"utf8"});
 assert.equal(r.status,1);assert.match(r.stderr,/hash mismatch/);
}));
