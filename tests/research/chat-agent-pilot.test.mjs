import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, mkdtempSync, existsSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {admitProposal, gateway} from "../../scripts/research/agent-intake-gateway.mjs";
import {compileDraft} from "../../scripts/research/intake-to-typespec.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const trial="research/autonomous-engineering/trials/chat-agent-kiosk/";
const source=join(root,"research/autonomous-engineering/samples/kiosk-owner-brief.json");
const proposal=join(root,trial,"proposal.json");
const metadata=join(root,trial,"trial.json");
const h=x=>createHash("sha256").update(x).digest("hex");
const load=x=>JSON.parse(readFileSync(x,"utf8"));
test("live conversation-authored proposal points at the exact pre-existing brief",()=>{
 const p=load(proposal),trial=load(metadata),bytes=readFileSync(source);
 assert.equal(h(bytes),p.briefSha256);
 assert.equal(trial.expectedDisposition,"BLOCKED_BY_UNRESOLVED_SUPPORTED_DOMAIN_QUESTIONS");
 assert.equal(trial.independentGradingPerformed,false);
 assert.equal(trial.modelApiCallPerformed,false);
 assert.equal(trial.providerBilledCostMeasured,false);
 assert.equal(trial.score,null);
 assert.equal(trial.sourceProvider,"existing-synthetic-git-fixture");
 assert.equal(p.discoveredQuestions.length,6);
 assert.equal(p.hypotheses.length,3);
});
test("live agent preserves source facts, records two material blockers, and MUST NOT generate a contract",()=>{
 const tmp=mkdtempSync(join(tmpdir(),"protocolia-chat-agent-trial-"));
 try{
  const admitted=join(tmp,"admitted"),contracts=join(tmp,"contracts");
  const returned=gateway(source,proposal,admitted);
  assert.equal(returned.status,"SOURCE_ANCHORED_DRAFT_UNVERIFIED");
  assert.equal(gateway(source,proposal,admitted,"verify").status,
   "CONSISTENT_SOURCE_ANCHORED_DRAFT_NOT_ATTESTED");
  const input=load(join(admitted,"intake.json"));
  const frozen=load(source);
  for(const fact of frozen.facts){
   const actual=input.requirements.find(r=>r.id===fact.id);
   assert.equal(actual.text,fact.text);
   assert.equal(actual.origin,"source_brief_unverified");
   assert.deepEqual(actual.operations,fact.expectedOperations);
   assert.ok(actual.evidenceRefs[0].includes("brief-sha256:"));
  }
  const questions=input.questions.filter(q=>q.affectsSupported&&q.state==="unresolved");
  assert.deepEqual(questions.map(q=>q.id),["K-Q03","K-Q04"]);
  assert.ok(input.questions.some(q=>q.id==="K-Q01"));
  assert.ok(input.questions.some(q=>q.id==="K-Q02"));
  for(const assumption of input.requirements.filter(r=>r.origin==="agent_assumption")){
   assert.equal(assumption.scope,"deferred");
   assert.deepEqual(assumption.operations,[]);
  }
  assert.throws(()=>compileDraft(join(admitted,"intake.json"),contracts),
   /unresolved or material question affects generated profile: K-Q03,K-Q04/);
  assert.equal(existsSync(contracts),false);
 }finally{rmSync(tmp,{recursive:true,force:true});}
});
test("cannot fabricate source-owner approval by altering agent response",()=>{
 const b=load(source),p=load(proposal);
 const admitted=admitProposal(b,p,h(readFileSync(source)),h(readFileSync(proposal)));
 for(const req of admitted.intake.requirements.filter(r=>["K-01","K-02","K-03","K-04"].includes(r.id))){
  assert.equal(req.origin,"source_brief_unverified");
 }
 const injected=structuredClone(p);injected.mappings[0].origin="explicit_owner";
 assert.throws(()=>admitProposal(b,injected,h(readFileSync(source)),h(Buffer.from(JSON.stringify(injected)))),/unexpected field/);
});
test("critical classifications remain self-reported, not independent oracle results",()=>{
 const t=load(metadata);
 assert.equal(t.agentCouldSeePreviousFixtureAndGateway,true);
 assert.equal(t.notBlinded,true);
 assert.equal(t.independentGradingPerformed,false);
 assert.equal(t.expectedBlockingQuestionIds.length,2);
});
