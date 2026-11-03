import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {composeStateOnlyGraph,emitStateOnlyTypeSpec} from "../../scripts/research/state-only-operator-grammar.mjs";
import {compileStateOnlyOperators} from "../../scripts/research/state-only-operator-intake.mjs";
import {auditedTransitionAuthority} from "../../packages/adapters/transition-authority.mjs";
import {tenantStateSchemaDdl,tenantStateDbProof,auditedTenantStatePolicy} from "../../packages/adapters/tenant-state-policy.mjs";
import {checkedMakerGuardDdl,checkedMakerGuardProof} from "../../packages/adapters/maker-checker-db-guard.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const sample=(domain,v)=>join(root,"research/autonomous-engineering/samples","state-only-"+domain+"-"+v+".json");
const load=(domain,v)=>JSON.parse(readFileSync(sample(domain,v),"utf8"));
function canonical(graph){
 return {...graph,operations:graph.operations.map(o=>({
  name:o.name,entity:o.entity,capability:o.capability,path:o.path,
  method:["get","listPage","health"].includes(o.kind)?"GET":"POST",
  behavior:{kind:o.kind,...(o.kind==="transition"?{field:o.field,from:o.from,to:o.to,audit:o.audit}:{})}
 }))};
}
test("v0.7 composes tenant scope and maker-checker with hidden database-only fields",()=>{
 for(const domain of ["service-ticket","review"]){
  const graph=composeStateOnlyGraph(load(domain,"v07"));
  const old=composeStateOnlyGraph(load(domain,"v06"));
  assert.equal(graph.schemaVersion,"protocolia-state-operator-ir/v0.7");
  assert.deepEqual(graph.entities,old.entities);
  assert.deepEqual(graph.graphProperties,old.graphProperties);
  assert.deepEqual(graph.operatorCatalog,old.operatorCatalog);
  assert.deepEqual(graph.operations.map(o=>[o.name,o.path,o.kind,o.from,o.to]),
   old.operations.map(o=>[o.name,o.path,o.kind,o.from,o.to]));
  const prefix=graph.entities[0].name.toLowerCase();
  assert.deepEqual(graph.operations.map(o=>o.capability),[
   prefix+".write.tenant",prefix+".read.tenant",prefix+".read.tenant",
   prefix+".submit",prefix+".decide.checked",prefix+".decide.checked","public"]);
  assert.doesNotMatch(emitStateOnlyTypeSpec(graph),/protocolia_tenant_id|protocolia_submitted_by|@reserve|@release/);
  const ir=canonical(graph),e=ir.entities[0];
  assert.equal(auditedTenantStatePolicy(ir,e).composite,true);
  assert.equal(auditedTransitionAuthority(ir,e,prefix+".read.tenant",prefix+".write.tenant").makerChecker,true);
  assert.match(tenantStateSchemaDdl(ir,e).join("\n"),/protocolia_tenant_id VARCHAR\(64\) NOT NULL/);
  assert.match(checkedMakerGuardDdl(ir,e).join("\n"),/protocolia_submitted_by/);
  assert.match(tenantStateDbProof(ir),/Tenant row deletion was accepted/);
  assert.match(checkedMakerGuardProof(ir),/Direct maker-checker truncate accepted/);
 }
});
test("v0.7 rejects tenant and checker downgrade, operation injection and unauthorized effects",()=>{
 const ir=canonical(composeStateOnlyGraph(load("service-ticket","v07")));
 for(const edit of [
  x=>x.operations.find(o=>o.behavior.kind==="get").capability="serviceticket.read",
  x=>x.operations.find(o=>o.behavior.kind==="create").capability="serviceticket.write",
  x=>x.operations.find(o=>o.behavior.kind==="listPage").capability="public",
  x=>x.operations.find(o=>o.capability==="serviceticket.submit").capability="serviceticket.write.tenant",
  x=>x.operations.find(o=>o.capability==="serviceticket.decide.checked").capability="serviceticket.decide",
  x=>x.operations.find(o=>o.capability==="serviceticket.submit").behavior.audit=[],
  x=>x.operations.push({entity:"ServiceTicket",capability:"public",behavior:{kind:"delete"}})
 ]){
  const altered=structuredClone(ir);edit(altered);
  assert.throws(()=>auditedTenantStatePolicy(altered,altered.entities[0]),/UNSAFE_TENANT_PROFILE/);
 }
 for(const edit of [
  x=>x.authorizationProfile="tenant-state/v1",
  x=>x.authorizationProfile="maker-checker/v1",
  x=>x.schemaVersion="protocolia-operator-assembly/v0.6",
  x=>x.operators[0].release=true,
  x=>x.entity.tenantId="org_attack"
 ]){
  const source=load("service-ticket","v07");edit(source);
  assert.throws(()=>composeStateOnlyGraph(source),/STATE_OPERATOR_INVALID|OPERATOR_ASSEMBLY_INVALID/);
 }
});
test("v0.7 intake retains source hash, separate version and nonproduction limitations",()=>{
 const dir=mkdtempSync(join(tmpdir(),"protocolia-v07-")),file=join(dir,"source.json"),out=join(dir,"output");
 try{
  writeFileSync(file,readFileSync(sample("service-ticket","v07")));
  assert.equal(compileStateOnlyOperators(file,out).files,8);
  assert.equal(compileStateOnlyOperators(file,out,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
  const read=name=>JSON.parse(readFileSync(join(out,name),"utf8"));
  assert.equal(read("semantic-ir.json").schemaVersion,"protocolia-state-operator-ir/v0.7");
  assert.equal(read("protocolia-intake.lock.json").schemaVersion,"protocolia-state-operator-lock/v0.7");
  assert.equal(read("protocolia-intake-report.json").authorizationProfile,"tenant-maker-checker/v1");
  assert.ok(read("protocolia-intake-report.json").limitations.some(x=>x.includes("no DB RLS")));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
