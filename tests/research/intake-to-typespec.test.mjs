import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {compileDraft,validateDraft} from "../../scripts/research/intake-to-typespec.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const original=JSON.parse(readFileSync(join(root,"research/autonomous-engineering/samples/kiosk-profile-draft.json"),"utf8"));
const clone=()=>structuredClone(original);
function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),"protocolia-intake-r2-")),file=join(dir,"draft.json"),out=join(dir,"out");
 try{return fn({dir,file,out,write:x=>writeFileSync(file,JSON.stringify(x))});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
test("frozen kiosk profile validates and explicitly defers unknown domain policy",()=>{
 const {operationIds}=validateDraft(original);
 assert.deepEqual(Object.values(operationIds),["createProduct","getProduct","listProducts","increaseProductQuantity","renameProduct"]);
 assert.equal(original.requirements.find(x=>x.scope==="deferred").operations.length,0);
});
test("outputs compilable TypeSpec, diffable requirement map and explicit partial report",()=>fixture(({file,out,write})=>{
 write(original);const r=compileDraft(file,out);
 assert.equal(r.status,"PARTIAL_DRAFT_UNVERIFIED");
 const tsp=readFileSync(join(out,"contracts/main.tsp"),"utf8");
 for(const token of ['@publicIdentity','@unique','@behavior("atomicIncrement", "Product", "quantity", "delta")',
  'op increaseProductQuantity','op renameProduct','@capability("inventory.write")'])
   assert.ok(tsp.includes(token),token);
 assert.ok(!/discount|refund/i.test(tsp),"unsupported business logic must not be silently generated");
 const report=JSON.parse(readFileSync(join(out,"protocolia-intake-report.json"),"utf8"));
 assert.deepEqual(report.deferredRequirements,["K-04"]);
 assert.ok(report.questions.some(q=>q.id==="K-Q01"&&q.state==="unresolved"));
 const map=JSON.parse(readFileSync(join(out,"requirements.json"),"utf8"));
 assert.equal(map.schemaVersion,"protocolia-requirements/v1");
 assert.equal(map.requirements.find(x=>x.id==="K-04").operations.length,0);
 assert.equal(compileDraft(file,out,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
}));
test("determinism and overwrite protection",()=>fixture(({dir,file,out,write})=>{
 write(original);compileDraft(file,out);
 const second=join(dir,"again");compileDraft(file,second);
 assert.deepEqual(readFileSync(join(out,"protocolia-intake.lock.json")),
  readFileSync(join(second,"protocolia-intake.lock.json")));
 assert.throws(()=>compileDraft(file,out),/empty directory/);
 const tsp=join(out,"contracts/main.tsp");
 writeFileSync(tsp,readFileSync(tsp,"utf8")+"\n// unauthorised manual change\n");
 assert.throws(()=>compileDraft(file,out,"verify"),/drift/);
}));
test("manual modifications to draft invalidate code and metadata",()=>fixture(({file,out,write})=>{
 write(original);compileDraft(file,out);
 const updated=clone();updated.project.quantity.maxValue=900;
 write(updated);
 assert.throws(()=>compileDraft(file,out,"verify"),/drift/);
}));
test("a required open material business question blocks any code generation",()=>fixture(({file,out,write})=>{
 const bad=clone();bad.questions[0].affectsSupported=true;
 write(bad);
 assert.throws(()=>compileDraft(file,out),/material question affects/);
 assert.equal(existsSync(out),false);
}));
test("unsafe privileges are not treated as reversible by a candidate",()=>fixture(({file,out,write})=>{
 const bad=clone();bad.questions[2].classification="security_privilege";
 write(bad);
 assert.throws(()=>compileDraft(file,out),/only reversible technical/);
}));
test("unknown operation or deferred requirement claiming coverage is rejected",()=>fixture(({file,out,write})=>{
 const bad=clone();bad.requirements[0].operations=["chargeCustomer"];
 write(bad);assert.throws(()=>compileDraft(file,out),/unknown mapped operation/);
 bad.requirements[0].operations=["createProduct"];bad.requirements[3].operations=["createProduct"];
 write(bad);assert.throws(()=>compileDraft(file,out),/deferred requirement cannot/);
}));
test("AI assumptions cannot assert implemented behavior even on otherwise valid profiles",()=>fixture(({file,out,write})=>{
 const bad=clone();bad.requirements[0].origin="agent_assumption";
 write(bad);assert.throws(()=>compileDraft(file,out),/agent assumption cannot/);
}));
test("injection and unsupported contract model names fail closed",()=>fixture(({file,out,write})=>{
 const bad=clone();bad.project.entity="Product\n@capability(\"public\")";
 write(bad);assert.throws(()=>compileDraft(file,out),/invalid identifier/);
 bad.project.entity="Product";bad.project.identity.name="name";
 write(bad);assert.throws(()=>compileDraft(file,out),/duplicate field names/);
}));
test("CLI generate then verify in a new directory",()=>fixture(({file,out,write})=>{
 write(original);const cli=join(root,"scripts/research/intake-to-typespec.mjs");
 const g=spawnSync(process.execPath,[cli,"generate",file,out],{encoding:"utf8"});
 assert.equal(g.status,0,g.stderr);assert.equal(JSON.parse(g.stdout).status,"PARTIAL_DRAFT_UNVERIFIED");
 const v=spawnSync(process.execPath,[cli,"verify",file,out],{encoding:"utf8"});
 assert.equal(v.status,0,v.stderr);
}));
