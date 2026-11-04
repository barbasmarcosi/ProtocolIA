import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {composeStateOnlyGraph} from "../../scripts/research/state-only-operator-grammar.mjs";
import {tenantRlsRoleCandidateSql} from "../../packages/adapters/tenant-rls-role-candidate.mjs";
import {tenantStateSchemaDdl} from "../../packages/adapters/tenant-state-policy.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const file=(name,version)=>join(root,"research/autonomous-engineering/samples",
 "state-only-"+name+"-"+version+".json");
const ir=(name,version)=>{
 const graph=composeStateOnlyGraph(JSON.parse(readFileSync(file(name,version),"utf8")));
 return {...graph,operations:graph.operations.map(o=>({
  name:o.name,entity:o.entity,capability:o.capability,
  method:["get","listPage","health"].includes(o.kind)?"GET":"POST",
  behavior:{kind:o.kind,...(o.kind==="transition"?{
   field:o.field,from:o.from,to:o.to,audit:o.audit}:{})}
 }))};
};
test("operator-only RLS candidate binds both reviewed vocabularies by actual session identity",()=>{
 for(const name of ["service-ticket","review"]){
  const graph=ir(name,"v07");
  const a=tenantRlsRoleCandidateSql(graph),b=tenantRlsRoleCandidateSql(graph);
  assert.equal(a,b,"Candidate must be deterministic for same canonical source");
  assert.match(a,/FORCE ROW LEVEL SECURITY/);
  assert.match(a,/ENABLE ROW LEVEL SECURITY/);
  assert.match(a,/CREATE POLICY protocolia_rls_read/);
  assert.match(a,/CREATE POLICY protocolia_rls_insert/);
  assert.match(a,/CREATE POLICY protocolia_rls_update/);
  assert.match(a,/session_user::name/i);
  assert.match(a,/SECURITY DEFINER/);
  assert.match(a,/pg_has_role/);
  assert.match(a,/has_schema_privilege/);
  assert.match(a,/REVOKE ALL ON public\.protocolia_rls_principal_tenant FROM PUBLIC/);
  assert.match(a,/REVOKE ALL ON FUNCTION public\.protocolia_rls_session_tenant\(\) FROM PUBLIC/);
  assert.match(a,/GRANT SELECT,INSERT,UPDATE/);
  assert.doesNotMatch(a,/GRANT (?:DELETE|TRUNCATE|CREATE) /);
  assert.doesNotMatch(a,/protocolia\.tenant_id|protocolia\.tenant'/);
  assert.match(a,new RegExp("public\\."+
    (name==="review"?"review_case":"service_ticket")+" FOR SELECT"));
  const base=tenantStateSchemaDdl(graph,graph.entities[0]).join("\n");
  assert.doesNotMatch(base,/ROW LEVEL SECURITY|CREATE POLICY/,
   "Candidate must not be silently installed into generated business migrations");
 }
});
test("noncomposite source profiles cannot opt into the role RLS candidate",()=>{
 for(const version of ["v03","v04","v05","v06"]){
  for(const name of ["service-ticket","review"]){
   assert.equal(tenantRlsRoleCandidateSql(ir(name,version)),null);
  }
 }
 assert.equal(tenantRlsRoleCandidateSql({entities:[],operations:[]}),null);
});
test("candidate explicitly denies privilege escalation and schema reapplication",()=>{
 const sql=tenantRlsRoleCandidateSql(ir("service-ticket","v07"));
 for(const item of ["rolbypassrls","rolsuper","rolcreaterole","rolcreatedb",
  "rolreplication","relrowsecurity","relforcerowsecurity",
  "already exist; refusing implicit overwrite","unreviewed preexisting grant",
  "RLS privilege postcondition failed","Two distinct explicit safe tenant SQL principals",
  "Reject *all* extra memberships"]){
  assert.ok(sql.includes(item),"Missing SQL security precondition: "+item);
 }
 assert.doesNotMatch(sql,/ALTER TABLE .*DISABLE ROW LEVEL SECURITY/);
});
