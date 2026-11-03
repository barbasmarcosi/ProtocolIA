import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {composeStateOnlyGraph,emitStateOnlyTypeSpec,validateStateOnlyGraph}
 from "../../scripts/research/state-only-operator-grammar.mjs";
import {compileStateOnlyOperators}
 from "../../scripts/research/state-only-operator-intake.mjs";
import {auditedTransitionAuthority}
 from "../../packages/adapters/transition-authority.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const filename=name=>join(root,"research/autonomous-engineering/samples/state-only-"+name+".json");
const read=name=>JSON.parse(readFileSync(filename(name),"utf8"));
function artifact(fn){
 const dir=mkdtempSync(join(tmpdir(),"p2-operation-auth-"));
 const input=join(dir,"source.json"),out=join(dir,"out");
 writeFileSync(input,readFileSync(filename("service-ticket-v04")));
 try{return fn({dir,input,out,update:s=>writeFileSync(input,JSON.stringify(s,null,2)+"\n")});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
const compileShape=graph=>({
 entities:graph.entities,
 operations:graph.operations.map(op=>({
  name:op.name,entity:op.entity,path:op.path,capability:op.capability,
  method:["get","listPage","health"].includes(op.kind)?"GET":"POST",
  behavior:{kind:op.kind,
   ...(op.kind==="transition"?{field:op.field,from:op.from,to:op.to,audit:op.audit}:{})}
 }))
});
test("v0.4 pins approved submit/decide role policy while preserving v0.3 contract byte for byte",()=>{
 for(const domain of ["review","service-ticket"]){
  const previous=composeStateOnlyGraph(read(domain+"-v03"));
  const current=composeStateOnlyGraph(read(domain+"-v04"));
  assert.equal(previous.schemaVersion,"protocolia-state-operator-ir/v0.3");
  assert.equal(current.schemaVersion,"protocolia-state-operator-ir/v0.4");
  assert.equal(validateStateOnlyGraph(current),current);
  assert.deepEqual(previous.entities,current.entities);
  assert.deepEqual(previous.graphProperties,current.graphProperties);
  assert.deepEqual(previous.operatorCatalog,current.operatorCatalog);
  assert.deepEqual(previous.operations.map(op=>[op.name,op.path,op.kind,op.from,op.to]),
   current.operations.map(op=>[op.name,op.path,op.kind,op.from,op.to]));
  const prefix=current.entities[0].name.toLowerCase();
  const transitions=current.operations.filter(o=>o.kind==="transition");
  assert.deepEqual(transitions.map(o=>o.capability),
   [prefix+".submit",prefix+".decide",prefix+".decide"]);
  assert.deepEqual(previous.operations.filter(o=>o.kind==="transition").map(o=>o.capability),
   [prefix+".write",prefix+".write",prefix+".write"]);
  const tsp=emitStateOnlyTypeSpec(current);
  assert.ok(tsp.includes('@capability("'+prefix+'.submit")'));
  assert.equal(tsp.match(new RegExp('@capability\\("'+prefix+'\\.decide"\\)','g')).length,2);
  assert.doesNotMatch(tsp,/@release|@reserve|@delete|@payment/);
 }
});
test("two backend generators share a fail-closed operation authority policy",()=>{
 const current=composeStateOnlyGraph(read("review-v04"));
 const ir=compileShape(current);
 const e=ir.entities[0],readCap="reviewcase.read",writeCap="reviewcase.write";
 const approved=auditedTransitionAuthority(ir,e,readCap,writeCap);
 assert.equal(approved.submit,"reviewcase.submit");
 assert.equal(approved.decide,"reviewcase.decide");
 assert.deepEqual([...approved.allowed.values()].sort(),
  ["reviewcase.decide","reviewcase.decide","reviewcase.submit"].sort());
 assert.equal(auditedTransitionAuthority(compileShape(composeStateOnlyGraph(read("review-v03"))),
  e,readCap,writeCap),null);
 const changes=[
  x=>x.operations.find(o=>o.behavior.kind==="transition").capability="public",
  x=>x.operations.find(o=>o.behavior.kind==="transition").capability=readCap,
  x=>x.operations.find(o=>o.capability==="reviewcase.decide").capability=writeCap,
  x=>x.operations.find(o=>o.capability==="reviewcase.submit").behavior.audit=[],
  x=>x.operations.find(o=>o.capability==="reviewcase.submit").behavior.reserve={stockEntity:"Cash"},
  x=>x.operations.find(o=>o.capability==="reviewcase.submit").behavior.from="approved",
  x=>x.operations.find(o=>o.capability==="reviewcase.decide").behavior.to="in_review",
  x=>x.operations.push({entity:e.name,capability:"public",behavior:{kind:"delete"}}),
  x=>x.entities.push({...e,name:"Injected"})
 ];
 for(const change of changes){
  const x=structuredClone(ir);change(x);
  assert.throws(()=>auditedTransitionAuthority(x,x.entities[0],readCap,writeCap),
   /UNSAFE_TRANSITION_AUTHORITY/);
 }
});
test("generating v0.4 produces a locked, provenance-bound policy without asserting owner consent",()=>artifact(x=>{
 const first=compileStateOnlyOperators(x.input,x.out);
 assert.equal(first.files,8);
 assert.equal(compileStateOnlyOperators(x.input,x.out,"verify").status,
  "CONSISTENT_DRAFT_NOT_ATTESTED");
 const ir=JSON.parse(readFileSync(join(x.out,"semantic-ir.json"),"utf8"));
 const report=JSON.parse(readFileSync(join(x.out,"protocolia-intake-report.json"),"utf8"));
 const lock=JSON.parse(readFileSync(join(x.out,"protocolia-intake.lock.json"),"utf8"));
 assert.equal(ir.schemaVersion,"protocolia-state-operator-ir/v0.4");
 assert.equal(report.authorizationProfile,"submit-decide/v1");
 assert.equal(report.generatorProfile,"state-only-operator-grammar/v0.4");
 assert.equal(lock.schemaVersion,"protocolia-state-operator-lock/v0.4");
 assert.equal(JSON.parse(readFileSync(join(x.out,"decisions.json"),"utf8")).authority,
  "SELF_DECLARED_UNVERIFIED");
 assert.equal(readFileSync(join(x.out,"contracts/main.tsp"),"utf8"),emitStateOnlyTypeSpec(ir));
}));
test("the source cannot invent extra authority, bypass graph or downgrade version",()=>artifact(x=>{
 const original=JSON.parse(readFileSync(x.input,"utf8"));
 const attacks=[
  s=>s.authorizationProfile="everyone-decides",
  s=>s.authorizationProfile={submit:"public",decide:"public"},
  s=>s.operatorVersions.transition="state.transition-audited@2",
  s=>s.operators[0].capability="public",
  s=>s.operators[1].from="reported",
  s=>s.operators[1].to=s.operators[2].to,
  s=>s.operators.push({kind:"transition",name:"adminOverwrite",suffix:"overwrite",from:"completed",to:"deleted"}),
  s=>s.profile="user-provided-code",
  s=>s.schemaVersion="protocolia-operator-assembly/v0.5",
  s=>delete s.authorizationProfile
 ];
 for(const attack of attacks){
  const src=structuredClone(original);attack(src);x.update(src);
  assert.throws(()=>compileStateOnlyOperators(x.input,x.out),
   /STATE_OPERATOR_INVALID|OPERATOR_ASSEMBLY_INVALID/);
  assert.equal(existsSync(x.out),false);
 }
}));
test("changing source or authorizations invalidates v0.4 generated artifacts",()=>artifact(x=>{
 compileStateOnlyOperators(x.input,x.out);
 const different=JSON.parse(readFileSync(x.input,"utf8"));
 different.entity.label.maxLength=140;x.update(different);
 assert.throws(()=>compileStateOnlyOperators(x.input,x.out,"verify"),/artifact drift/);
 x.update(read("service-ticket-v04"));
 const tsp=join(x.out,"contracts/main.tsp");
 writeFileSync(tsp,readFileSync(tsp,"utf8").replace("serviceticket.decide","public"));
 assert.throws(()=>compileStateOnlyOperators(x.input,x.out,"verify"),/artifact drift/);
}));
