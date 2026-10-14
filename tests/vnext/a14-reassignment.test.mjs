import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generate as spring} from "../../packages/adapters/modular/generate.mjs";
import {generate as nest} from "../../packages/adapters/nest/generate.mjs";

const tmp=()=>mkdtempSync(join(tmpdir(),"protocolia-a14-"));
const id=(name)=>({name,type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:40});
const field=(name)=>({name,type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:40});
const entities=[
 {name:"Technician",publicIdentity:"badge",fields:[id("badge"),field("name")]},
 {name:"WorkItem",publicIdentity:"number",fields:[id("number"),
  {...field("assignedBadge"),reference:{target:"Technician",onDelete:"restrict"}}]}
];
const op=(entity,kind,name,method,path,cap,status,extras={})=>({
 entity,name,method,path,capability:cap,statuses:status,behavior:{kind,...extras}
});
const ops=[];
for(const e of entities){
 const key=e.publicIdentity,resource=e.name.toLowerCase()+"s",base="/api/"+resource;
 ops.push(op(e.name,"create","create"+e.name,"POST",base,resource+".write",[201]));
 ops.push(op(e.name,"get","get"+e.name,"GET",base+"/{"+key+"}",resource+".read",[200]));
 ops.push(op(e.name,"listPage","list"+e.name,"GET",base,resource+".read",[200]));
}
ops.push(op("WorkItem","reassignReference","reassignWorkItem","PATCH",
 "/api/workitems/{number}/assignee","workitems.assign",[200,400,404,409],
 {field:"assignedBadge",input:"assignedBadge",audit:["assignedBadge"]}));
ops.push(op("WorkItem","auditPage","history","GET",
 "/api/workitems/{number}/audit","workitems.audit",[200,400,404]));
ops.push(op("WorkItem","health","health","GET","/health","public",[200]));
const ir={irVersion:"vnext-a0.1",namespace:"A14Independent",entities,operations:ops};
const paging={parameters:[
 {name:"limit",in:"query",schema:{minimum:1,maximum:50,default:25}},
 {name:"offset",in:"query",schema:{minimum:0,maximum:1000000,default:0}}
]};
const api={paths:Object.fromEntries(ops.filter(x=>["listPage","auditPage"].includes(x.behavior.kind))
 .map(x=>[x.path,{get:paging}]))};

test("A14 independent two-entity contract: both generators emit audited CAS FK reassignment, UI and separate capability",()=>{
 const a=tmp(),b=tmp();spring(ir,api,a);nest(ir,api,b);
 const java=readFileSync(join(a,"src/main/java/dev/protocolia/modular/Manifest.java"),"utf8");
 const javaRuntime=readFileSync(join(a,"src/main/java/dev/protocolia/modular/DomainRuntime.java"),"utf8");
 const javaSecurity=readFileSync(join(a,"src/main/java/dev/protocolia/modular/SecurityConfig.java"),"utf8");
 const nestRuntime=readFileSync(join(b,"src/main.ts"),"utf8");
 const manifest=JSON.parse(readFileSync(join(b,"src/manifest.json"),"utf8"));
 assert.match(java,/ASSIGN_CAPABILITIES=List.of\\("workitems.assign"\\)/);
 assert.match(javaSecurity,/ASSIGN_CAPABILITIES/);
 assert.deepEqual(manifest.assignmentCapabilities,["workitems.assign"]);
 assert.ok(!manifest.writeCapabilities.includes("workitems.assign"));
 assert.ok(!manifest.readCapabilities.includes("workitems.assign"));
 assert.match(javaRuntime,/case "reassignReference"/);
 assert.match(javaRuntime,/Reference changed concurrently/);
 assert.match(nestRuntime,/case "reassignReference"/);
 assert.match(nestRuntime,/Reference changed or resource not found/);
 const ui=JSON.parse(readFileSync(join(a,"src/main/resources/static/protocolia-ui.json"),"utf8"));
 const work=ui.resources.find(x=>x.entity.name==="WorkItem");
 assert.equal(work.operations.reassignReference.path,"/api/workitems/{number}/assignee");
 assert.equal(work.operations.reassignReference.capability,"workitems.assign");
 const react=readFileSync(join(a,"src/main/resources/static/protocolia-ui.json"),"utf8");
 assert.ok(react.includes("reassignReference"));
 for(const out of [a,b]){
  const sql=readFileSync(join(out,out===a?"src/main/resources/db/migration/V1__contract_baseline.sql":"src/schema.sql"),"utf8");
  assert.match(sql,/FOREIGN KEY/);
  assert.match(sql,/protocolia_audit_event/);
 }
});

test("A14 reject reassignment without FK, audit, protected capability, safe status and valid binding in both targets",()=>{
 const mutations=[
  x=>{delete x.entities[1].fields[1].reference;},
  x=>{delete x.operations[7].behavior.audit;},
  x=>{x.operations[7].capability="workitems.write";},
  x=>{x.operations[7].capability="workitems.read";},
  x=>{x.operations[7].capability="workitems.audit";},
  x=>{x.operations[7].capability="public";},
  x=>{x.operations[7].statuses=[200,400,404];},
  x=>{x.operations[7].behavior.input="number";},
  x=>{x.operations[7].behavior.field="number";},
  x=>{x.operations[7].method="POST";},
  x=>{x.operations[7].behavior.audit=["number"];},
 ];
 for(const mutate of mutations){
  const broken=structuredClone(ir);mutate(broken);
  assert.throws(()=>spring(broken,api,tmp()));
  assert.throws(()=>nest(broken,api,tmp()));
 }
});
