import test from "node:test";
import assert from "node:assert/strict";
import {compileOverduePolicies,overdueSchemaSql} from "../../packages/adapters/overdue-policy.mjs";
import {diffContracts} from "../../packages/cli/regeneration.mjs";

const field=(name,type="string",extra={})=>({name,type,required:true,nullable:false,...extra});
function sample(){
 const ir={irVersion:"vnext-a0.1",namespace:"OtherDomain",entities:[
  {name:"Person",publicIdentity:"badge",fields:[field("badge","string",{unique:true})]},
  {name:"Issue",publicIdentity:"number",fields:[
   field("number","string",{unique:true}),
   field("personBadge","string",{reference:{target:"Person",onDelete:"restrict"}}),
   field("status","string",{initial:"reported"}),
   field("dueAt","utcDateTime",{required:false,nullable:true}),
  ],overdueAlert:{dueField:"dueAt",stateField:"status",
     terminalState:"completed",recipientField:"personBadge",channel:"inbox"}}
 ],operations:[{name:"completeIssue",entity:"Issue",behavior:{
   kind:"transition",field:"status",from:"reported",to:"completed"}}]};
 return ir;
}
test("A14.3 independent contract produces portable durable deduplicated inbox DDL",()=>{
 const rules=compileOverduePolicies(sample());
 assert.equal(rules.length,1);
 assert.equal(rules[0].key,"Issue.overdue");
 assert.equal(rules[0].functionName,"protocolia_materialize_issue_overdue");
 assert.match(rules[0].ddl,/INSERT INTO protocolia_notification_outbox/);
 assert.match(rules[0].ddl,/ON CONFLICT \(rule_key,resource_id\) DO NOTHING/);
 assert.match(rules[0].ddl,/e\.due_at <= as_of/);
 assert.match(rules[0].ddl,/e\.status <> 'completed'/);
 assert.match(rules[0].ddl,/e\.person_badge/);
 const sql=overdueSchemaSql(rules).join("\n");
 assert.match(sql,/UNIQUE\(rule_key,resource_id\)/);
 assert.match(sql,/CHECK \(attempts >= 0\)/);
 assert.match(sql,/WHERE status='pending'/);
 assert.doesNotMatch(sql,/DELETE FROM|DROP TABLE|GRANT /);
});
test("A14.3 rejects invalid due, state, identity binding, terminal, audience and SQL injection",()=>{
 const mutations=[
  a=>a.entities[1].overdueAlert.dueField="status",
  a=>a.entities[1].overdueAlert.stateField="dueAt",
  a=>a.entities[1].fields[1].reference=undefined,
  a=>a.entities[1].overdueAlert.recipientField="number",
  a=>a.entities[1].overdueAlert.terminalState="completed'; DROP TABLE issue; --",
  a=>a.entities[1].overdueAlert.terminalState="missing",
  a=>a.entities[1].overdueAlert.channel="email",
  a=>a.entities[1].overdueAlert.dueField="dueAt); --",
  a=>a.entities[1].name="Issue;drop",
  a=>a.entities[1].overdueAlert.stateField="personBadge",
  a=>a.operations[0].behavior.to="planned",
  a=>a.operations.push({entity:"Issue",behavior:{kind:"transition",field:"status",from:"completed",to:"reported"}})
 ];
 for(const mutate of mutations){
  const ir=sample();mutate(ir);
  assert.throws(()=>compileOverduePolicies(ir),undefined,JSON.stringify(ir.entities[1].overdueAlert));
 }
});
test("A14.3 is opt-in and deterministic across repeated projections",()=>{
 const ir=sample();
 const prior=structuredClone(ir);delete prior.entities[1].overdueAlert;
 assert.deepEqual(compileOverduePolicies(prior),[]);
 assert.deepEqual(overdueSchemaSql([]),[]);
 assert.deepEqual(compileOverduePolicies(ir),compileOverduePolicies(ir));
});

test("A14.3 rejects silent policy introduction during legacy populated-app evolution",()=>{
 const before=sample(),after=structuredClone(before);
 delete before.entities[1].overdueAlert;
 const plan=diffContracts(before,after);
 assert.equal(plan.compatible,false);
 assert.match(plan.blockers.join(" "),/Overdue policy migration needs a dedicated additive evolution profile/);
 assert.equal(diffContracts(after,after).compatible,true);
});

test("A14.3 tick is bounded, atomic and explicitly not executable by PUBLIC",()=>{
 const sql=overdueSchemaSql(compileOverduePolicies(sample())).join("\n");
 assert.match(sql,/CREATE OR REPLACE FUNCTION protocolia_tick_notifications\(as_of TIMESTAMPTZ, batch_size INTEGER\)/);
 assert.match(sql,/RETURNS TABLE\(enqueued INTEGER,dispatched INTEGER\)/);
 assert.match(sql,/as_of IS NULL OR batch_size IS NULL OR batch_size < 1 OR batch_size > 100/);
 assert.match(sql,/SELECT protocolia_materialize_issue_overdue\(as_of\) INTO step_count/);
 assert.match(sql,/SELECT protocolia_dispatch_inbox\(batch_size\) INTO dispatched/);
 for(const fn of ["protocolia_tick_notifications(TIMESTAMPTZ,INTEGER)",
                   "protocolia_dispatch_inbox(INTEGER)",
                   "protocolia_materialize_issue_overdue(TIMESTAMPTZ)"])
  assert.ok(sql.includes("REVOKE ALL ON FUNCTION "+fn+" FROM PUBLIC;"));
 assert.doesNotMatch(sql,/SECURITY DEFINER/);
});
