import test from "node:test";
import assert from "node:assert/strict";
import {diffContracts,additiveSql,validateOpenApiEvolution} from "../../packages/cli/regeneration.mjs";
const field=(name,type="string",extra={})=>({name,type,required:true,nullable:false,...extra});
function pair(){
 const next={irVersion:"vnext-a0.1",namespace:"IndependentMigration",entities:[
  {name:"Member",publicIdentity:"badge",recipientIdentity:true,fields:[field("badge","string",{unique:true})]},
  {name:"Task",publicIdentity:"id",fields:[field("id","string",{unique:true}),field("memberBadge","string",{reference:{target:"Member",onDelete:"restrict"}}),field("state","string",{initial:"open"}),field("deadline","utcDateTime",{required:false,nullable:true})],overdueAlert:{dueField:"deadline",stateField:"state",terminalState:"closed",recipientField:"memberBadge",channel:"inbox"}}
 ],operations:[
  {name:"createTask",entity:"Task",method:"POST",path:"/api/task",capability:"task.write",statuses:[201],behavior:{kind:"create"}},
  {name:"closeTask",entity:"Task",method:"POST",path:"/api/task/{id}/close",capability:"task.write",statuses:[200,409],behavior:{kind:"transition",field:"state",from:"open",to:"closed"}},
  {name:"memberNotifications",entity:"Member",method:"GET",path:"/api/notifications/member",capability:"notify.read",statuses:[200,400,401,403],behavior:{kind:"inboxPage"}},
  {name:"ackMemberNotification",entity:"Member",method:"POST",path:"/api/notifications/member/{notificationId}/ack",capability:"notify.ack",statuses:[200,400,401,403,404],behavior:{kind:"ackNotification"}}
 ]};
 const old=structuredClone(next);delete old.entities[0].recipientIdentity;delete old.entities[1].overdueAlert;old.operations=old.operations.slice(0,2);
 return {old,next};
}
test("A14.3 isolated first-time notification evolution emits safe, complete PostgreSQL DDL",()=>{
 const {old,next}=pair(),plan=diffContracts(old,next);
 assert.equal(plan.compatible,true,plan.blockers.join(";"));
 assert.deepEqual(plan.changes.map(x=>x.kind).sort(),["addRecipientIdentity","addOverdueRule","addOperation","addOperation"].sort());
 const sql=additiveSql(plan,next);
 for(const token of ["CREATE TABLE protocolia_notification_outbox","CREATE TABLE protocolia_notification_inbox",
  "CREATE TABLE protocolia_identity_member","CREATE OR REPLACE FUNCTION protocolia_tick_notifications",
  "CREATE OR REPLACE FUNCTION protocolia_inbox_member_page","CREATE OR REPLACE FUNCTION protocolia_inbox_member_ack",
  "REVOKE ALL ON TABLE protocolia_identity_member FROM PUBLIC"])
  assert.ok(sql.includes(token),token);
 assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM|TRUNCATE TABLE/i);
 assert.throws(()=>additiveSql(plan),/requires verified new canonical IR/);
 assert.equal(diffContracts(next,next).compatible,true);
 assert.equal(additiveSql(diffContracts(next,next),next),"");
});
test("A14.3 forbids partial policies, privilege drift, unrelated changes and rule rewrites",()=>{
 for(const mutate of [
  p=>delete p.next.entities[0].recipientIdentity,
  p=>delete p.next.entities[1].overdueAlert,
  p=>p.next.entities[1].overdueAlert.channel="email",
  p=>delete p.next.entities[1].fields[1].reference,
  p=>p.next.entities[0].fields[0].maxLength=17,
  p=>p.next.operations[0].capability="public",
  p=>p.next.operations[2].capability="task.write",
  p=>p.next.operations.pop(),
  p=>p.next.operations.push({name:"deleteTask",entity:"Task",method:"DELETE",path:"/api/task/{id}",statuses:[204],capability:"task.write",behavior:{kind:"delete"}}),
  p=>p.old.entities[1].overdueAlert=p.next.entities[1].overdueAlert,
  p=>p.old.entities[0].recipientIdentity=true
 ]){const p=pair();mutate(p);const plan=diffContracts(p.old,p.next);assert.equal(plan.compatible,false,JSON.stringify(plan));}
 const {next}=pair(),other=structuredClone(next);other.entities[1].overdueAlert.terminalState="archived";
 assert.equal(diffContracts(next,other).compatible,false);
});
test("A14.3 evolution accepts new HTTP schemas but rejects existing API drift or new query extras",()=>{
 const {old,next}=pair(),plan=diffContracts(old,next);
 const base={openapi:"3.1.0",paths:{"/api/task":{post:{operationId:"createTask"}},"/api/task/{id}/close":{post:{operationId:"closeTask"}}},components:{schemas:{}}};
 const api=structuredClone(base);
 api.components.schemas.Notification={type:"object",properties:{id:{type:"string"}}};
 api.components.schemas.NotificationPage={type:"object",properties:{items:{type:"array",items:{$ref:"#/components/schemas/Notification"}}}};
 api.paths["/api/notifications/member"]={get:{parameters:[
  {name:"limit",in:"query",schema:{type:"integer",minimum:1,maximum:50,default:25}},
  {name:"offset",in:"query",schema:{type:"integer",minimum:0,maximum:1000000,default:0}}
 ],responses:{"200":{content:{"application/json":{schema:{$ref:"#/components/schemas/NotificationPage"}}}}}}};
 api.paths["/api/notifications/member/{notificationId}/ack"]={post:{parameters:[{name:"notificationId",in:"path",schema:{type:"string"}}],responses:{"200":{content:{"application/json":{schema:{$ref:"#/components/schemas/Notification"}}}}}}};
 assert.deepEqual(validateOpenApiEvolution(base,api,old,next,plan),[]);
 const drift=structuredClone(api);drift.paths["/api/task"].post.operationId="replaced";
 assert.match(validateOpenApiEvolution(base,drift,old,next,plan).join(";"),/Undeclared OpenAPI/);
 const extra=structuredClone(api);extra.paths["/api/notifications/member"].get.parameters.push({name:"identity",in:"query",schema:{type:"string"}});
 assert.match(validateOpenApiEvolution(base,extra,old,next,plan).join(";"),/Unsafe inbox OpenAPI/);
});
