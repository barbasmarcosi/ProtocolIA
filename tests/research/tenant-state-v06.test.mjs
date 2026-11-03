import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {composeStateOnlyGraph,emitStateOnlyTypeSpec} from "../../scripts/research/state-only-operator-grammar.mjs";
import {compileStateOnlyOperators} from "../../scripts/research/state-only-operator-intake.mjs";
import {auditedTenantStatePolicy,tenantStateSchemaDdl,verifiedTenantId}
 from "../../packages/adapters/tenant-state-policy.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const file=(domain,version)=>join(root,"research/autonomous-engineering/samples",
 "state-only-"+domain+"-"+version+".json");
const read=(domain,version)=>JSON.parse(readFileSync(file(domain,version),"utf8"));
const compiled=graph=>({...graph,operations:graph.operations.map(op=>({
 name:op.name,entity:op.entity,method:["get","listPage","health"].includes(op.kind)?"GET":"POST",
 capability:op.capability,path:op.path,behavior:{kind:op.kind,
  ...(op.kind==="transition"?{field:op.field,from:op.from,to:op.to,audit:op.audit}:{})}
}))});
test("v0.6 source adds only reviewed read/write tenant grants without exposing tenant in TypeSpec",()=>{
 for(const name of ["service-ticket","review"]){
  const legacy=composeStateOnlyGraph(read(name,"v03"));
  const tenant=composeStateOnlyGraph(read(name,"v06"));
  const prefix=tenant.entities[0].name.toLowerCase();
  assert.equal(tenant.schemaVersion,"protocolia-state-operator-ir/v0.6");
  assert.equal(tenant.grammarSource.authorizationProfile,"tenant-state/v1");
  assert.deepEqual(tenant.entities,legacy.entities);
  assert.deepEqual(tenant.graphProperties,legacy.graphProperties);
  assert.deepEqual(tenant.operatorCatalog,legacy.operatorCatalog);
  assert.deepEqual(tenant.operations.map(op=>[op.name,op.path,op.kind,op.from,op.to]),
   legacy.operations.map(op=>[op.name,op.path,op.kind,op.from,op.to]));
  assert.deepEqual(tenant.operations.filter(op=>op.kind!=="health")
   .map(op=>op.capability),[
    prefix+".write.tenant",prefix+".read.tenant",prefix+".read.tenant",
    prefix+".write.tenant",prefix+".write.tenant",prefix+".write.tenant"]);
  const spec=emitStateOnlyTypeSpec(tenant);
  assert.doesNotMatch(spec,/protocolia_tenant_id|@owner|@reserve|@release/);
  assert.match(spec,new RegExp(prefix+"\\.read\\.tenant"));
  assert.match(spec,new RegExp(prefix+"\\.write\\.tenant"));
  const ir=compiled(tenant);
  const p=auditedTenantStatePolicy(ir,ir.entities[0]);
  assert.equal(p.entity,tenant.entities[0].name);
  assert.equal(tenantStateSchemaDdl(ir,ir.entities[0]).length,4);
  const sql=tenantStateSchemaDdl(ir,ir.entities[0]).join("\n");
  assert.match(sql,/protocolia_tenant_id VARCHAR\(64\) NOT NULL/);
  assert.match(sql,/Tenant reassignment forbidden/);
  assert.match(sql,/BEFORE UPDATE/);
  assert.match(sql,/CREATE INDEX/);
 }
});
test("strict tenant lexical policy rejects missing, path, SQL, header and spoofed claims",()=>{
 for(const x of [undefined,null,42,"","AOrg","a", "org+1","org.alpha",
  "org alpha","..","a;drop table","á", "a".repeat(65),{},["org_alpha"]]){
  assert.throws(()=>verifiedTenantId(x),/UNSAFE_TENANT_PROFILE/);
 }
 for(const s of ["org_alpha","org-beta","a1","tenant_99"])
  assert.equal(verifiedTenantId(s),s);
});
test("old v0.3, v0.4 and v0.5 contracts do not get new columns or scopes",()=>{
 for(const version of ["v03","v04","v05"]){
  for(const domain of ["service-ticket","review"]){
   const ir=compiled(composeStateOnlyGraph(read(domain,version)));
   assert.equal(auditedTenantStatePolicy(ir,ir.entities[0]),null);
   assert.deepEqual(tenantStateSchemaDdl(ir,ir.entities[0]),[]);
  }
 }
});
test("a generic operator cannot use mixed public/global authorization to defeat tenant scope",()=>{
 const ir=compiled(composeStateOnlyGraph(read("service-ticket","v06")));
 const mutations=[
  x=>x.operations.find(o=>o.behavior.kind==="get").capability="serviceticket.read",
  x=>x.operations.find(o=>o.behavior.kind==="listPage").capability="public",
  x=>x.operations.find(o=>o.behavior.kind==="create").capability="serviceticket.write",
  x=>x.operations.find(o=>o.behavior.kind==="transition").capability="public",
  x=>x.operations.find(o=>o.behavior.kind==="transition").behavior.audit=[],
  x=>x.operations.find(o=>o.behavior.kind==="transition").behavior.reserve={stockEntity:"Cash"},
  x=>x.operations.find(o=>o.behavior.kind==="transition").behavior.from="nonexistent",
  x=>x.entities.push({...x.entities[0],name:"SecondTenantRecord"}),
  x=>x.operations.push({entity:"ServiceTicket",behavior:{kind:"delete"},capability:"public"})
 ];
 for(const edit of mutations){
  const x=structuredClone(ir);edit(x);
  assert.throws(()=>tenantStateSchemaDdl(x,x.entities[0]),/UNSAFE_TENANT_PROFILE/);
 }
});
test("source-bound v0.6 intake pins review type and records the missing IdP proof explicitly",()=>{
 const dir=mkdtempSync(join(tmpdir(),"protocolia-tenant-"));
 const input=join(dir,"source.json"),out=join(dir,"generated");
 try{
  writeFileSync(input,readFileSync(file("service-ticket","v06")));
  assert.equal(compileStateOnlyOperators(input,out).files,8);
  assert.equal(compileStateOnlyOperators(input,out,"verify").status,
   "CONSISTENT_DRAFT_NOT_ATTESTED");
  const report=JSON.parse(readFileSync(join(out,"protocolia-intake-report.json")));
  const lock=JSON.parse(readFileSync(join(out,"protocolia-intake.lock.json")));
  assert.equal(report.generatorProfile,"state-only-operator-grammar/v0.6");
  assert.equal(report.authorizationProfile,"tenant-state/v1");
  assert.equal(lock.schemaVersion,"protocolia-state-operator-lock/v0.6");
  const ir=JSON.parse(readFileSync(join(out,"semantic-ir.json")));
  assert.equal(ir.schemaVersion,"protocolia-state-operator-ir/v0.6");
  assert.ok(report.limitations.some(x=>/does not include DB RLS/.test(x)));
  const attack=JSON.parse(readFileSync(input));
  attack.authorizationProfile="tenant-client-header/v1";
  writeFileSync(input,JSON.stringify(attack,null,2));
  assert.throws(()=>compileStateOnlyOperators(input,out,"verify"),/STATE_OPERATOR_INVALID/);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
test("unreviewed tenant source code, extra effects and authorizations fail before output",()=>{
 for(const domain of ["service-ticket","review"]){
  const original=read(domain,"v06");
  const alters=[
   x=>x.authorizationProfile="tenant-from-http-header",
   x=>x.tenantId="org_alpha",
   x=>x.entity.tenant="org_beta",
   x=>x.operatorVersions.transition="state.transition-audited@2",
   x=>x.operators[0].capability="public",
   x=>x.operators[1].release=true,
   x=>x.operators[2].from="unreachable",
   x=>x.schemaVersion="protocolia-operator-assembly/v0.7"
  ];
  for(const alter of alters){
   const draft=structuredClone(original);alter(draft);
   assert.throws(()=>composeStateOnlyGraph(draft),
    /STATE_OPERATOR_INVALID|OPERATOR_ASSEMBLY_INVALID/);
  }
 }
});
