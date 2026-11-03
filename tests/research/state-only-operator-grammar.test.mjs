import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {requireStateOnlyOperatorVersions,validateAuditedStateGraph,OPERATOR_VERSIONS,operatorCatalogDigest}
 from "../../scripts/research/operator-catalog-v1.mjs";
import {composeStateOnlyGraph,validateStateOnlyGraph,emitStateOnlyTypeSpec}
 from "../../scripts/research/state-only-operator-grammar.mjs";
import {compileStateOnlyOperators} from "../../scripts/research/state-only-operator-intake.mjs";
import {reviewSemanticIr} from "../../scripts/research/typed-review-workflow.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const old=join(root,"research/autonomous-engineering/samples/review-workflow-source.json");
const a=join(root,"research/autonomous-engineering/samples/state-only-review-v03.json");
const b=join(root,"research/autonomous-engineering/samples/state-only-service-ticket-v03.json");
const parse=p=>JSON.parse(readFileSync(p,"utf8"));
function fixture(source,fn){
 const dir=mkdtempSync(join(tmpdir(),"protocolia-state-only-"));
 const input=join(dir,"source.json"),out=join(dir,"out");
 writeFileSync(input,readFileSync(source));
 try{return fn({dir,input,out,update:value=>writeFileSync(input,JSON.stringify(value,null,2)+"\n")});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
test("v0.3 needs only the approved audited transition pin",()=>{
 const graph=composeStateOnlyGraph(parse(a));
 assert.equal(validateStateOnlyGraph(graph),graph);
 assert.equal(graph.schemaVersion,"protocolia-state-operator-ir/v0.3");
 assert.deepEqual(graph.operatorCatalog.pins,{transition:OPERATOR_VERSIONS.transition});
 assert.equal(graph.operatorCatalog.catalogSha256,operatorCatalogDigest());
 assert.equal(requireStateOnlyOperatorVersions({transition:OPERATOR_VERSIONS.transition}).catalogSha256,
  operatorCatalogDigest());
 assert.equal(graph.entities.length,1);
 assert.equal(graph.operations.length,7);
 assert.equal(graph.operations.filter(o=>o.kind==="transition").length,3);
 assert.ok(graph.operations.every(o=>!o.reserve&&!o.release));
});
test("review case carries same constraints and source-state arcs as original sealed ReviewCase",()=>{
 const legacy=reviewSemanticIr(parse(old)),ir=composeStateOnlyGraph(parse(a));
 assert.deepEqual(ir.entities[0].fields.map(f=>({name:f.name,type:f.type,initial:f.initial,maxLength:f.maxLength})),
  legacy.entities[0].fields.map(f=>({name:f.name,type:f.type,initial:f.initial,maxLength:f.maxLength})));
 assert.deepEqual(ir.operations.map(o=>[o.name,o.kind,o.path,o.from,o.to]),
  legacy.operations.map(o=>[o.name,o.kind,o.path,o.from,o.to]));
 const tsp=emitStateOnlyTypeSpec(ir);
 for(const x of ['@transition("drafted", "in_review")','@transition("in_review", "approved")',
  '@transition("in_review", "rejected")','@audit("state")',
  '@capability("reviewcase.write")'])
  assert.ok(tsp.includes(x),x);
 assert.doesNotMatch(tsp,/@reserve|@release|@delete|@charge|@payment/);
});
test("an independently named ServiceTicket uses exactly the same source-typed operator",()=>fixture(b,x=>{
 const result=compileStateOnlyOperators(x.input,x.out);
 assert.equal(result.files,8);
 assert.equal(compileStateOnlyOperators(x.input,x.out,"verify").status,
  "CONSISTENT_DRAFT_NOT_ATTESTED");
 const ir=parse(join(x.out,"semantic-ir.json"));
 assert.equal(ir.entities[0].name,"ServiceTicket");
 assert.equal(ir.entities[0].publicIdentity,"ticketCode");
 assert.equal(ir.entities[0].fields[2].name,"phase");
 assert.equal(ir.graphProperties.terminals.length,2);
 assert.deepEqual(ir.operations.filter(o=>o.kind==="transition").map(o=>[o.from,o.to]),[
  ["reported","triaged"],["triaged","completed"],["triaged","dismissed"]]);
 const text=readFileSync(join(x.out,"contracts/main.tsp"),"utf8");
 assert.equal(text,emitStateOnlyTypeSpec(ir));
 assert.match(text,/@transition\("triaged", "dismissed"\)/);
 assert.match(text,/@capability\("serviceticket.write"\)/);
 assert.doesNotMatch(text,/ReviewCase|review-cases|cases.write/);
 const ledger=parse(join(x.out,"decisions.json"));
 assert.equal(ledger.authority,"SELF_DECLARED_UNVERIFIED");
 assert.ok(ledger.decisions.every(d=>d.state==="unresolved"));
 const pin=parse(join(x.out,"operator-catalog.json"));
 assert.deepEqual(pin.pins,{transition:OPERATOR_VERSIONS.transition});
 assert.equal(pin.catalogSha256,operatorCatalogDigest());
}));
test("state-only grammar rejects SQL, unreviewed ops, impossible edges and privilege escalation",()=>fixture(a,x=>{
 const source=parse(x.input);
 const mutations=[
  v=>v.operatorVersions.transition="state.transition-audited@2",
  v=>v.operatorVersions.reserve="capacity.reserve@1",
  v=>delete v.operatorVersions,
  v=>v.operators[0].release=true,
  v=>v.operators[1].to=v.operators[2].to,
  v=>v.operators[1].from="nonexistent",
  v=>v.operators[0].to="drafted",
  v=>v.operators[1].suffix=v.operators[2].suffix,
  v=>v.operators[2].name="createReviewCase",
  v=>v.operators.push({kind:"sql",command:"DROP TABLE x"}),
  v=>v.entity.status.initial="bad\n@capability(\"public\")",
  v=>v.entity.status.name=v.entity.identity.name,
  v=>v.entity.name="Health",
  v=>v.entity.identity.maxLength=5,
  v=>v.capability="public",
  v=>v.entity.route="../secrets"
 ];
 for(const mutate of mutations){
  const changed=structuredClone(source);mutate(changed);x.update(changed);
  assert.throws(()=>compileStateOnlyOperators(x.input,x.out),
   /STATE_OPERATOR_INVALID|OPERATOR_ASSEMBLY_INVALID/);
  assert.equal(existsSync(x.out),false);
 }
}));
test("state-only operator refuses changed graph, roles, audit and foreign operations",()=>{
 const ir=composeStateOnlyGraph(parse(a));
 for(const mutate of [
  o=>o.operatorCatalog.pins.transition="state.transition-audited@2",
  o=>o.operations.find(x=>x.kind==="transition").capability="public",
  o=>o.operations.find(x=>x.kind==="transition").audit=[],
  o=>o.operations.find(x=>x.kind==="transition").release={stockEntity:"Cash"},
  o=>o.entities[0].fields[2].initial="approved",
  o=>o.operations.push({kind:"delete",name:"eraseAll"}),
  o=>o.grammarSource.operators[0].to="rejected"
 ]){
  const bad=structuredClone(ir);mutate(bad);
  assert.throws(()=>emitStateOnlyTypeSpec(bad),/STATE_OPERATOR_INVALID|OPERATOR_ASSEMBLY_INVALID/);
 }
});
test("direct graph validation rejects ambiguous joins, cycles and unreachable states",()=>{
 const good=parse(a).operators;
 for(const transitions of [
  [good[0],{...good[1],to:"rejected"},good[2]],
  [good[0],{...good[1],from:"nonexistent"},good[2]],
  [good[0],{...good[1],to:"drafted"},good[2]],
  [good[0],{...good[1],from:"approved",to:"approved"},good[2]],
  [good[0],{...good[1],name:"submitReviewCase"},good[2]],
 ]){
  assert.throws(()=>validateAuditedStateGraph(transitions,"drafted"),/OPERATOR_ASSEMBLY_INVALID/);
 }
 assert.deepEqual(validateAuditedStateGraph(good,"drafted").terminals,["approved","rejected"]);
});
test("integrity check detects changed source, modified generated files or unreviewed catalog",()=>fixture(a,x=>{
 compileStateOnlyOperators(x.input,x.out);
 const changed=parse(x.input);
 changed.entity.identity.maxLength=90;x.update(changed);
 assert.throws(()=>compileStateOnlyOperators(x.input,x.out,"verify"),/artifact drift/);
 x.update(parse(a));
 writeFileSync(join(x.out,"operator-catalog.json"),"{}");
 assert.throws(()=>compileStateOnlyOperators(x.input,x.out,"verify"),/artifact drift/);
 writeFileSync(join(x.out,"unknown.sql"),"SELECT * FROM users;");
 assert.throws(()=>compileStateOnlyOperators(x.input,x.out,"verify"),/inventory drift/);
}));
