import test from "node:test";
import assert from "node:assert/strict";
import {diffContracts,additiveSql,validateOpenApiEvolution} from "../../packages/cli/regeneration.mjs";

const base={
 irVersion:"vnext-a0.1",namespace:"Cases",
 entities:[{name:"Ticket",publicIdentity:"id",fields:[
  {name:"id",type:"string",required:true,unique:true,nullable:false},
  {name:"status",type:"string",required:true,unique:false,nullable:false,initial:"draft"}
 ]}],
 operations:[
  {name:"createTicket",entity:"Ticket",method:"POST",path:"/api/tickets",capability:"ticket.write",statuses:[201,400,409],behavior:{kind:"create",audit:["status"]}},
  {name:"getTicket",entity:"Ticket",method:"GET",path:"/api/tickets/{id}",capability:"ticket.read",statuses:[200,404],behavior:{kind:"get"}},
  {name:"listTickets",entity:"Ticket",method:"GET",path:"/api/tickets",capability:"ticket.read",statuses:[200,400],behavior:{kind:"listPage"}},
  {name:"approveTicket",entity:"Ticket",method:"POST",path:"/api/tickets/{id}/approve",capability:"ticket.write",statuses:[200,409],behavior:{kind:"transition",field:"status",from:"draft",to:"approved",audit:["status"]}},
  {name:"health",entity:"Ticket",method:"GET",path:"/health",capability:"public",statuses:[200],behavior:{kind:"health"}}
 ]
};
const read={name:"listTicketAudit",entity:"Ticket",method:"GET",path:"/api/tickets/{id}/audit",capability:"ticket.audit",
 statuses:[200,400,401,403,404],behavior:{kind:"auditPage"}};
const next=()=>{const ir=structuredClone(base);ir.operations.push(structuredClone(read));return ir;};
const api={openapi:"3.1.0",info:{title:"Cases",version:"1"},paths:{
 "/api/tickets":{get:{responses:{"200":{description:"ok"}}}},
 "/api/tickets/{id}":{get:{responses:{"200":{description:"ok"}}}}
},components:{schemas:{Ticket:{type:"object",properties:{id:{type:"string"}}}}}};
const upgraded=()=>{
 const after=structuredClone(api);
 after.paths["/api/tickets/{id}/audit"]={get:{responses:{
  "200":{content:{"application/json":{schema:{$ref:"#/components/schemas/AuditPage"}}}},
  "400":{description:"bad"},
  "401":{description:"unauthenticated"},
  "403":{description:"no access"},
  "404":{description:"not found"}
 }}};
 after.components.schemas.AuditPage={type:"object",properties:{
  items:{type:"array",items:{$ref:"#/components/schemas/AuditEntry"}},total:{type:"integer"}}};
 after.components.schemas.AuditEntry={type:"object",properties:{
  id:{type:"string"},actor:{type:"string"},resourceId:{type:"string"}}};
 return after;
};
test("A12 pure audit-query contract evolution adds a route without touching PostgreSQL DDL",()=>{
 const plan=diffContracts(base,next());
 assert.equal(plan.compatible,true,JSON.stringify(plan));
 assert.deepEqual(plan.changes.map(x=>x.kind),["addOperation"]);
 assert.equal(plan.changes[0].operation.behavior.kind,"auditPage");
 assert.equal(additiveSql(plan),"");
 assert.deepEqual(validateOpenApiEvolution(api,upgraded(),base,next(),plan),[]);
});
test("A12 evolution fails closed for old audit writes, capability escalation, new mutations, route mismatch and duplicate readers",()=>{
 const mutants=[
  ir=>{ir.operations[0].behavior.audit=["id"];},
  ir=>{ir.operations.find(x=>x.name==="listTicketAudit").capability="ticket.read";},
  ir=>{ir.operations.find(x=>x.name==="listTicketAudit").capability="ticket.write";},
  ir=>{ir.operations.find(x=>x.name==="listTicketAudit").capability="public";},
  ir=>{ir.operations.find(x=>x.name==="listTicketAudit").path="/api/tickets/audit";},
  ir=>{ir.operations.find(x=>x.name==="listTicketAudit").method="POST";},
  ir=>{ir.operations.find(x=>x.name==="listTicketAudit").behavior={kind:"auditPage",field:"status"};},
  ir=>{ir.operations.push({...read,name:"readAgain",path:"/api/tickets/{id}/history"});},
  ir=>{ir.operations.find(x=>x.name==="listTicketAudit").statuses=[200];},
  ir=>{ir.operations.push({name:"clearTicket",entity:"Ticket",method:"DELETE",path:"/api/tickets/{id}",capability:"ticket.write",statuses:[204],behavior:{kind:"delete"}});}
 ];
 for(const mutant of mutants){
  const altered=next();mutant(altered);
  const diff=diffContracts(base,altered);
  assert.equal(diff.compatible,false,JSON.stringify(diff));
  assert.throws(()=>additiveSql(diff),/Refusing destructive migration/);
 }
 const missingSource=structuredClone(base);missingSource.operations[0].behavior.audit=undefined;
 missingSource.operations[3].behavior.audit=undefined;
 assert.equal(diffContracts(missingSource,next()).compatible,false);
});
test("A12 OpenAPI permits only operation-reachable response schemas; old models and hidden routes cannot drift",()=>{
 const plan=diffContracts(base,next()),candidate=upgraded();
 for(const change of [
  x=>{x.components.schemas.Ticket.properties.id.maxLength=7;},
  x=>{x.components.schemas.UnauthorizedOrphan={type:"object"};},
  x=>{x.paths["/api/tickets/{id}/forged"]={get:{responses:{"200":{description:"bad"}}}};},
  x=>{x.paths["/api/tickets/{id}/audit"].get.responses["200"].content["application/json"].schema={$ref:"#/components/schemas/Ticket"};},
  x=>{x.info.version="2";}
 ]){
  const modified=structuredClone(candidate);change(modified);
  const result=validateOpenApiEvolution(api,modified,base,next(),plan);
  assert.ok(result.length>0,JSON.stringify(modified));
 }
});
