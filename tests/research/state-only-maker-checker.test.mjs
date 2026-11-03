import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {composeStateOnlyGraph,validateStateOnlyGraph,emitStateOnlyTypeSpec}
 from "../../scripts/research/state-only-operator-grammar.mjs";
import {compileStateOnlyOperators} from "../../scripts/research/state-only-operator-intake.mjs";
import {auditedTransitionAuthority} from "../../packages/adapters/transition-authority.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const source=(domain,v)=>join(root,"research/autonomous-engineering/samples/state-only-"+domain+"-"+v+".json");
const parse=p=>JSON.parse(readFileSync(p,"utf8"));
const canonical=ir=>({
 entities:ir.entities,
 operations:ir.operations.map(o=>({
  name:o.name,entity:o.entity,capability:o.capability,path:o.path,
  method:["get","listPage","health"].includes(o.kind)?"GET":"POST",
  behavior:{kind:o.kind,...(o.kind==="transition"?{
   field:o.field,from:o.from,to:o.to,audit:o.audit
  }:{})}
 }))
});
function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),"protocolia-maker-checker-"));
 const input=join(dir,"source.json"),out=join(dir,"out");
 writeFileSync(input,readFileSync(source("service-ticket","v05")));
 try{return fn({input,out,change:mutate=>{
  const obj=parse(input);mutate(obj);writeFileSync(input,JSON.stringify(obj,null,2)+"\n");
 }});}
 finally{rmSync(dir,{force:true,recursive:true});}
}
test("v0.5 enforces checked decision grant for two independently named domains",()=>{
 for(const domain of ["review","service-ticket"]){
  const v03=composeStateOnlyGraph(parse(source(domain,"v03")));
  const v04=composeStateOnlyGraph(parse(source(domain,"v04")));
  const v05=composeStateOnlyGraph(parse(source(domain,"v05")));
  assert.equal(v05.schemaVersion,"protocolia-state-operator-ir/v0.5");
  assert.equal(validateStateOnlyGraph(v05),v05);
  assert.deepEqual(v05.entities,v04.entities);
  assert.deepEqual(v05.graphProperties,v04.graphProperties);
  assert.deepEqual(v05.operatorCatalog,v04.operatorCatalog);
  assert.deepEqual(v05.operations.map(o=>[o.name,o.path,o.kind,o.from,o.to]),
   v04.operations.map(o=>[o.name,o.path,o.kind,o.from,o.to]));
  const prefix=v05.entities[0].name.toLowerCase();
  assert.deepEqual(v05.operations.filter(o=>o.kind==="transition").map(o=>o.capability),[
   prefix+".submit",prefix+".decide.checked",prefix+".decide.checked"]);
  const policy=auditedTransitionAuthority(canonical(v05),canonical(v05).entities[0],
   prefix+".read",prefix+".write");
  assert.equal(policy.makerChecker,true);
  assert.equal(policy.submit,prefix+".submit");
  assert.equal(policy.decide,prefix+".decide.checked");
  assert.equal(auditedTransitionAuthority(canonical(v04),canonical(v04).entities[0],
   prefix+".read",prefix+".write").makerChecker,false);
  assert.equal(auditedTransitionAuthority(canonical(v03),canonical(v03).entities[0],
   prefix+".read",prefix+".write"),null);
  const spec=emitStateOnlyTypeSpec(v05);
  assert.equal((spec.match(new RegExp("@capability\\(\""+prefix+"\\.decide\\.checked\"\\)","g"))??[]).length,2);
  assert.doesNotMatch(spec,/@reserve|@release|@payment|@delete/);
 }
});
test("cannot turn checked terminal decisions into legacy unchecked operation or public grant",()=>{
 const graph=composeStateOnlyGraph(parse(source("review","v05")));
 const shape=canonical(graph);
 const read="reviewcase.read",write="reviewcase.write";
 for(const change of [
  x=>x.operations.find(o=>o.capability==="reviewcase.decide.checked").capability="reviewcase.decide",
  x=>x.operations.find(o=>o.capability==="reviewcase.decide.checked").capability="public",
  x=>x.operations.find(o=>o.capability==="reviewcase.submit").capability=write,
  x=>x.operations.find(o=>o.capability==="reviewcase.submit").behavior.audit=[],
  x=>x.operations.find(o=>o.capability==="reviewcase.submit").behavior.reserve={stockEntity:"Wallet"},
  x=>x.operations.find(o=>o.capability==="reviewcase.decide.checked").behavior.from="drafted",
  x=>x.operations.push({entity:"ReviewCase",capability:"public",behavior:{kind:"delete"}})
 ]){
  const changed=structuredClone(shape);change(changed);
  assert.throws(()=>auditedTransitionAuthority(changed,changed.entities[0],read,write),
   /UNSAFE_TRANSITION_AUTHORITY/);
 }
});
test("v0.5 report and lock are bound to authenticated-principal rule (not owner consent)",()=>fixture(f=>{
 const done=compileStateOnlyOperators(f.input,f.out);
 assert.equal(done.files,8);
 assert.equal(compileStateOnlyOperators(f.input,f.out,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
 const ir=parse(join(f.out,"semantic-ir.json"));
 const report=parse(join(f.out,"protocolia-intake-report.json"));
 const lock=parse(join(f.out,"protocolia-intake.lock.json"));
 assert.equal(ir.schemaVersion,"protocolia-state-operator-ir/v0.5");
 assert.equal(report.authorizationProfile,"maker-checker/v1");
 assert.equal(report.generatorProfile,"state-only-operator-grammar/v0.5");
 assert.equal(lock.schemaVersion,"protocolia-state-operator-lock/v0.5");
 assert.equal(parse(join(f.out,"decisions.json")).authority,"SELF_DECLARED_UNVERIFIED");
 assert.equal(readFileSync(join(f.out,"contracts/main.tsp"),"utf8"),emitStateOnlyTypeSpec(ir));
}));
test("source injection, profile downgrade, alternate effects and graph bypass are rejected",()=>fixture(f=>{
 const original=parse(f.input);
 for(const edit of [
  x=>x.authorizationProfile="submit-decide/v1",
  x=>x.authorizationProfile="public-checker",
  x=>x.schemaVersion="protocolia-operator-assembly/v0.4",
  x=>x.operators[1].capability="public",
  x=>x.operators[1].release=true,
  x=>x.operators[2].from="reported",
  x=>x.operators[0].to="dismissed",
  x=>x.entity.status.initial='reported"\n@capability("public")',
  x=>x.operators.push({kind:"transition",name:"resetCase",suffix:"reset",from:"dismissed",to:"reported"}),
  x=>x.operatorVersions.transition="state.transition-audited@2",
  x=>delete x.authorizationProfile
 ]){
  f.change(()=>{});
  writeFileSync(f.input,JSON.stringify(original,null,2)+"\n");
  f.change(edit);
  assert.throws(()=>compileStateOnlyOperators(f.input,f.out),
   /STATE_OPERATOR_INVALID|OPERATOR_ASSEMBLY_INVALID/);
  assert.equal(existsSync(f.out),false);
 }
}));
test("generator keeps checked-maker field out of source-contract public properties",()=>{
 const graph=composeStateOnlyGraph(parse(source("service-ticket","v05")));
 assert.equal(graph.entities[0].fields.some(f=>f.name==="protocolia_submitted_by"),false);
 const tsp=emitStateOnlyTypeSpec(graph);
 assert.doesNotMatch(tsp,/protocolia_submitted_by|submittedBy|makerSubject/);
 // Generated servers hold the only transport-specific implementation of this
 // hidden server-managed column: no user input gets to nominate the maker.
});
