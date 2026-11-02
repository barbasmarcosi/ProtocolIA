import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {checkBrief,admitProposal,gateway,promptForBrief} from "../../scripts/research/agent-intake-gateway.mjs";
import {checkStockBrief,admitStockProposal,compileStockBrief} from "../../scripts/research/stock-debit-intake.mjs";
import {runModelProposal} from "../../scripts/research/model-proposal-runner.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const original=join(root,"research/autonomous-engineering/samples/stock-debit-lab-brief.json");
const template=join(root,"research/autonomous-engineering/trials/chat-agent-stock-debit/proposal-template.json");
const hash=v=>createHash("sha256").update(v).digest("hex");
async function fixture(fn){
 const base=mkdtempSync(join(tmpdir(),"stock-agent-intake-")),brief=join(base,"brief.json"),
  proposal=join(base,"proposal.json"),out=join(base,"generated"),admitted=join(base,"admitted");
 writeFileSync(brief,readFileSync(original));
 const p=JSON.parse(readFileSync(template,"utf8"));
 p.briefSha256=hash(readFileSync(brief));
 writeFileSync(proposal,JSON.stringify(p,null,2)+"\n");
 try{return await fn({base,brief,proposal,out,admitted,p,write:v=>writeFileSync(proposal,JSON.stringify(v,null,2)+"\n")});}
 finally{rmSync(base,{recursive:true,force:true});}
}
test("multi-entity profile requires eight frozen operations with no custom behaviors",()=>{
 const x=JSON.parse(readFileSync(original));
 assert.equal(checkBrief(x),x);assert.equal(checkStockBrief(x),x);
 assert.equal(x.project.profile,"stock-debit-lab/v0");
 const altered=structuredClone(x);
 altered.facts[1].expectedOperations.push("sellCustomer");
 assert.throws(()=>checkStockBrief(altered),/bad stock operation/);
 const missing=structuredClone(x);
 missing.facts[1].expectedOperations.pop();
 assert.throws(()=>checkStockBrief(missing),/exactly eight/);
});
test("gateway admits independently frozen facts and preserves unanswered business policies",()=>fixture(x=>{
 const b=JSON.parse(readFileSync(x.brief));const s=hash(readFileSync(x.brief));
 const validated=admitStockProposal(b,x.p,s,hash(readFileSync(x.proposal)));
 const viaGateway=admitProposal(b,x.p,s,hash(readFileSync(x.proposal)));
 assert.deepEqual(viaGateway,validated);
 assert.equal(validated.intake.requirements.length,7);
 assert.equal(validated.intake.questions.length,6);
 assert.equal(validated.intake.requirements.filter(r=>r.scope==="deferred").length,3);
 assert.ok(validated.intake.questions.some(q=>q.id==="SI-Q02"&&q.classification==="security_privilege"&&q.state==="unresolved"));
 assert.ok(validated.intake.requirements.every(r=>r.origin!=="explicit_owner"));
 assert.equal(gateway(x.brief,x.proposal,x.admitted).status,"SOURCE_ANCHORED_DRAFT_UNVERIFIED");
 assert.equal(gateway(x.brief,x.proposal,x.admitted,"verify").status,"CONSISTENT_SOURCE_ANCHORED_DRAFT_NOT_ATTESTED");
 const intake=JSON.parse(readFileSync(join(x.admitted,"intake.json")));
 assert.equal(intake.schemaVersion,"protocolia-stock-intake/v0.1");
 assert.deepEqual(intake,validated.intake);
}));
test("agent proposal generates previously proven TypeSpec without creating sales or arbitrary adjustments",()=>fixture(x=>{
 const result=compileStockBrief(x.brief,x.proposal,x.out);
 assert.equal(result.status,"PARTIAL_DRAFT_UNVERIFIED");
 assert.equal(compileStockBrief(x.brief,x.proposal,x.out,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
 const tsp=readFileSync(join(x.out,"contracts/main.tsp"),"utf8");
 assert.match(tsp,/@reserve\("StockItem", "available", "stockSku", "units"\)/);
 assert.match(tsp,/@release\("StockItem", "available", "stockSku", "units"\)/);
 assert.match(tsp,/@audit\("state"\)/);
 assert.match(tsp,/title: "Audited stock debit — research pilot"/);
 assert.doesNotMatch(tsp,/@debitExact|@chargeCustomer|op sellCustomer/);
 const report=JSON.parse(readFileSync(join(x.out,"protocolia-intake-report.json")));
 assert.equal(report.generatorProfile,"stock-debit-lab/v0");
 assert.equal(report.generatedOperations.length,8);
 assert.deepEqual(report.deferredRequirements,["SI-05","SI-06","SI-07"]);
 const map=JSON.parse(readFileSync(join(x.out,"requirements.json")));
 assert.equal(map.schemaVersion,"protocolia-requirements/v1");
 assert.ok(map.requirements.find(r=>r.id==="SI-02").operations.includes("createStockDebit"));
 const ledger=JSON.parse(readFileSync(join(x.out,"decisions.json")));
 assert.equal(ledger.authority,"SELF_DECLARED_UNVERIFIED");
}));
test("agent-origin field forged as owner approval is rejected before output",()=>fixture(x=>{
 x.p.mappings[0].origin="explicit_owner";x.write(x.p);
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/unknown\/missing fields/);
 assert.equal(existsSync(x.out),false);
}));
test("missing, expanded and cross-fact mappings cannot rewrite business scope",()=>fixture(x=>{
 const bad=structuredClone(x.p);bad.mappings[0].operations=["createStockItem"];
 x.write(bad);
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/changed frozen operations/);
 bad.mappings[0].operations=["createStockItem","getStockItem","listStockItems","reverseStockDebit"];
 x.write(bad);
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/changed frozen operations/);
 bad.mappings[0].operations=x.p.mappings[0].operations;
 bad.mappings[1].sourceId="SI-01";
 x.write(bad);
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/invented or duplicate/);
}));
test("source tampering and stale proposal hash fail closed",()=>fixture(x=>{
 const b=JSON.parse(readFileSync(x.brief));b.facts[0].text="Changed source requirement";
 writeFileSync(x.brief,JSON.stringify(b));
 assert.throws(()=>gateway(x.brief,x.proposal,x.admitted),/hash mismatch/);
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/hash mismatch/);
 assert.equal(existsSync(x.out),false);
}));
test("new material business ambiguity affecting the profile must block code",()=>fixture(x=>{
 x.p.discoveredQuestions.push({id:"SI-Q07",
  question:"Should the exact debit operation alter posted quantities or available quantities at different times?",
  classification:"material_business",affectsSupported:true});
 x.write(x.p);
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/material question blocks TypeSpec: SI-Q07/);
 assert.equal(existsSync(x.out),false);
}));
test("agent cannot invent provisional security/irreversible approvals",()=>fixture(x=>{
 x.p.discoveredQuestions[0].provisionalDecision="Grant unrestricted debit authority to every caller";
 x.p.discoveredQuestions[0].classification="security_privilege";
 x.write(x.p);
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/material decisions cannot be provisional/);
}));
test("deterministic locks detect edits, output file invention and source changes",()=>fixture(x=>{
 compileStockBrief(x.brief,x.proposal,x.out);
 const other=join(x.base,"second");
 compileStockBrief(x.brief,x.proposal,other);
 assert.deepEqual(readFileSync(join(x.out,"protocolia-intake.lock.json")),
  readFileSync(join(other,"protocolia-intake.lock.json")));
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/must be empty/);
 writeFileSync(join(x.out,"contracts/main.tsp"),"changed contract");
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out,"verify"),/drift/);
}));
test("provider-neutral existing model runner can admit v0.2 proposals via mock HTTP response",async()=>await fixture(async x=>{
 let requests=0;
 const transport=async (_endpoint,options)=>{
  requests++;const req=JSON.parse(options.body);
  assert.equal(req.messages[0].role,"system");
  assert.match(req.messages[1].content,/StockDebitLab/);
  return new Response(JSON.stringify({id:"chat-simulated",model:"test-mock",
   choices:[{finish_reason:"stop",message:{role:"assistant",content:JSON.stringify(x.p)}}],
   usage:{prompt_tokens:160,completion_tokens:90,total_tokens:250}}),{status:200});
 };
 const answer=await runModelProposal({briefPath:x.brief,outPath:x.out,
  endpoint:"http://127.0.0.1:9876/v1/chat/completions",
  model:"unit-mock",networkApproved:true,maxOutputTokens:1200},transport);
 assert.equal(requests,1);
 assert.equal(answer.status,"MODEL_RESPONSE_ADMITTED_UNVERIFIED");
 assert.equal(answer.costUsd,"UNKNOWN_UNPRICED");
 const content=JSON.parse(readFileSync(join(x.out,"intake.json")));
 assert.equal(content.schemaVersion,"protocolia-stock-intake/v0.1");
 assert.ok(content.questions.some(q=>q.id==="SI-Q02"&&q.state==="unresolved"));
}));
