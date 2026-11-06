import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {composeStateOnlyGraph} from "../../scripts/research/state-only-operator-grammar.mjs";
import {subjectRoleGuardCandidateSql} from "../../packages/adapters/subject-role-guard-candidate.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=path=>readFileSync(join(root,path),"utf8");
const graph=(name,version)=>{
  const source=JSON.parse(read("research/autonomous-engineering/samples/state-only-"+name+"-"+version+".json"));
  const canonical=composeStateOnlyGraph(source);
  return {...canonical,operations:canonical.operations.map(o=>({
    name:o.name,entity:o.entity,capability:o.capability,
    method:["get","listPage","health"].includes(o.kind)?"GET":"POST",
    behavior:{kind:o.kind,...(o.kind==="transition"?{
      field:o.field,from:o.from,to:o.to,audit:o.audit}:{})}
  }))};
};

test("S2 candidate uses authenticated SQL session_user, not a user-controlled GUC",()=>{
  for(const name of ["service-ticket","review"]){
    const ir=graph(name,"v07");
    const sql=subjectRoleGuardCandidateSql(ir);
    assert.equal(typeof sql,"string");
    assert.equal(sql,subjectRoleGuardCandidateSql(ir));
    for(const expected of [
      "session_user::name","SECURITY DEFINER","public.protocolia_s2_principal_subject",
      "REVOKE ALL ON public.protocolia_s2_principal_subject FROM PUBLIC",
      "REVOKE ALL ON FUNCTION public.protocolia_s2_session_subject() FROM PUBLIC",
      "public.protocolia_rls_session_tenant()",
      "protocolia.s2_alpha_checker","protocolia.s2_beta_checker",
      "protocolia.s2_alpha_maker_subject","protocolia.s2_alpha_checker_subject",
      "protocolia.s2_beta_maker_subject","protocolia.s2_beta_checker_subject",
      "SQL login not authorized as maker or independent checker",
      "Audit actor must equal authenticated SQL subject",
      "ALTER POLICY protocolia_rls_update",
      "ALTER POLICY protocolia_rls_audit_insert",
      "CREATE TRIGGER protocolia_s2_audit_actor_trigger",
      "UNIQUE (tenant_id,subject)",
      "active BOOLEAN NOT NULL DEFAULT TRUE",
      "active IS TRUE",
      "ALTER POLICY protocolia_rls_read",
      "ALTER POLICY protocolia_rls_insert",
      "WITH CHECK (protocolia_tenant_id=public.protocolia_rls_session_tenant()",
      "S2 must extend only reviewed installed S1 and maker guard"
    ])assert.ok(sql.includes(expected),"Missing S2 principal-binding guarantee "+expected);
    assert.doesNotMatch(sql,/GRANT UPDATE ON public\.protocolia_audit_event/);
    assert.doesNotMatch(sql,/GRANT SELECT ON public\.protocolia_s2_principal_subject/);
    assert.match(sql,/RETURNS trigger LANGUAGE plpgsql/);
    assert.match(sql,new RegExp("BEFORE UPDATE ON public\\."+(name==="service-ticket"?"service_ticket":"review_case")));
    assert.doesNotMatch(sql,/current_setting\('protocolia\.subject'/);
  }
});
test("S2 cannot silently expand the unsupported source profiles",()=>{
  for(const v of ["v03","v04","v05","v06"])
    for(const n of ["service-ticket","review"])
      assert.equal(subjectRoleGuardCandidateSql(graph(n,v)),null);
  assert.equal(subjectRoleGuardCandidateSql({entities:[],operations:[]}),null);
});
test("both generators emit operator-only human identity SQL but never install it",()=>{
  const nest=read("packages/adapters/nest/generate.mjs");
  const spring=read("packages/adapters/modular/generate.mjs");
  for(const s of [nest,spring]){
    assert.match(s,/subjectRoleGuardCandidateSql\(ir\)/);
    assert.match(s,/write\("protocolia-subject-role-guard-candidate.sql",identitySql\)/);
  }
  const candidate=read("packages/adapters/subject-role-guard-candidate.mjs");
  assert.match(candidate,/Not a production migration/);
  assert.match(read("scripts/research/subject-role-guard-e2e.sh"),/FORGED_CHECKER_GUC_WAS_ACCEPTED/);
});
