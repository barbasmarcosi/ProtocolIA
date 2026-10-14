import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRecipientInboxes,recipientInboxSql} from '../../packages/adapters/recipient-inbox.mjs';
import {generate as spring} from '../../packages/adapters/modular/generate.mjs';
import {generate as nest} from '../../packages/adapters/nest/generate.mjs';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export function fixture(){
 const f=(name,extra={})=>({name,type:'string',required:true,nullable:false,unique:false,minLength:1,maxLength:40,...extra});
 const ir={irVersion:'vnext-a0.1',namespace:'IndependentReminder',entities:[
  {name:'Member',publicIdentity:'code',recipientIdentity:true,fields:[f('code',{unique:true}),f('name')]},
  {name:'Task',publicIdentity:'key',fields:[f('key',{unique:true}),f('memberCode',{reference:{target:'Member',onDelete:'restrict'}}),f('state',{initial:'open'}),f('deadline',{type:'utcDateTime',required:false,nullable:true})],
   overdueAlert:{dueField:'deadline',stateField:'state',terminalState:'closed',recipientField:'memberCode',channel:'inbox'}}
 ],operations:[]};
 for(const e of ir.entities)for(const [kind,method,suffix,status,cap] of [
  ['create','POST','',201,'write'],['get','GET','/{'+e.publicIdentity+'}',200,'read'],['listPage','GET','',200,'read']])
  ir.operations.push({name:kind+e.name,entity:e.name,method,path:'/api/'+e.name.toLowerCase()+suffix,capability:e.name+'.'+cap,statuses:[status],behavior:{kind}});
 ir.operations.push({name:'closeTask',entity:'Task',method:'POST',path:'/api/task/{key}/close',capability:'Task.write',statuses:[200,409],behavior:{kind:'transition',field:'state',from:'open',to:'closed'}});
 ir.operations.push({name:'health',entity:'Member',method:'GET',path:'/health',capability:'public',statuses:[200],behavior:{kind:'health'}});
 for(const [kind,method,path,cap] of [['inboxPage','GET','/api/notifications/member','notice.read'],['ackNotification','POST','/api/notifications/member/{notificationId}/ack','notice.ack']])
  ir.operations.push({name:kind,entity:'Member',method,path,capability:cap,statuses:[200,400,401,403,...(kind==='ackNotification'?[404]:[])],behavior:{kind}});
 const spec={paths:{}};
 for(const o of ir.operations){
  spec.paths[o.path]??={};spec.paths[o.path][o.method.toLowerCase()]={parameters:['listPage','inboxPage'].includes(o.behavior.kind)?[
   {name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:50,default:25}},
   {name:'offset',in:'query',schema:{type:'integer',minimum:0,maximum:1000000,default:0}}
  ]:o.behavior.kind==='ackNotification'?[{name:'notificationId',in:'path',required:true,schema:{type:'string'}}]:[]};
 }
 return {ir,spec};
}
test('recipient contract requires explicit identity binding and separate permissions',()=>{
 const {ir}=fixture();const result=compileRecipientInboxes(ir);
 assert.equal(result.length,1);assert.equal(result[0].entity,'Member');
 assert.equal(result[0].bindingTable,'protocolia_identity_member');
 assert.deepEqual(result[0].rules,['Task.overdue']);
 for(const mutate of [
  a=>delete a.entities[0].recipientIdentity,
  a=>a.entities[0].recipientIdentity='yes',
  a=>a.operations.at(-1).capability='notice.read',
  a=>a.operations.at(-1).capability='Task.write',
  a=>a.operations.at(-2).capability='public',
  a=>a.operations.at(-1).behavior.audit=['name'],
  a=>a.operations.at(-1).path='/api/notifications/member/{code}/ack',
  a=>a.operations.at(-2).statuses=[200],
  a=>a.operations.pop(),
  a=>delete a.entities[1].overdueAlert,
  a=>a.entities[0].name='Member;drop',
 ]){const clone=structuredClone(ir);mutate(clone);assert.throws(()=>compileRecipientInboxes(clone));}
});
test('recipient operations opt in without silently changing historical applications',()=>{
 const {ir}=fixture();delete ir.entities[0].recipientIdentity;
 ir.operations=ir.operations.filter(o=>!['inboxPage','ackNotification'].includes(o.behavior.kind));
 assert.deepEqual(compileRecipientInboxes(ir),[]);assert.deepEqual(recipientInboxSql([]),[]);
});
test('both generators project the same independently named recipient inbox and SQL',()=>{
 const {ir,spec}=fixture();const outputs=[];
 for(const [generate,path] of [[spring,'src/main/resources/db/migration/V1__contract_baseline.sql'],[nest,'src/schema.sql']]){
  const dir=mkdtempSync(join(tmpdir(),'pia-recipient-'));generate(ir,spec,dir);
  const sql=readFileSync(join(dir,path),'utf8');
  assert.match(sql,/REFERENCES member\(code\) ON DELETE RESTRICT/);
  assert.match(sql,/PRIMARY KEY \(issuer,subject\)/);
  assert.match(sql,/REVOKE ALL ON TABLE protocolia_identity_member FROM PUBLIC/);
  assert.match(sql,/FOR SHARE/);
  assert.match(sql,/read_at=COALESCE\(i.read_at,CURRENT_TIMESTAMP\)/);
  assert.match(sql,/recipient_key=recipient/);
  outputs.push(sql.slice(sql.indexOf('CREATE TABLE protocolia_identity_member')));
 }
 assert.equal(outputs[0],outputs[1]);
});
