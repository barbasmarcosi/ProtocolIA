import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildQueryPlan} from "../../packages/adapters/query-plan.mjs";
import {generate as spring} from "../../packages/adapters/modular/generate.mjs";
import {generate as nest} from "../../packages/adapters/nest/generate.mjs";

const tmp=()=>mkdtempSync(join(tmpdir(),"pia-a142-"));
const id=name=>({name,type:"string",unique:true,required:true,nullable:false,minLength:1,maxLength:40});
const textField=name=>({name,type:"string",unique:false,required:true,nullable:false,minLength:1,maxLength:60});
const ir={irVersion:"vnext-a0.1",namespace:"FacilitySearch",entities:[
 {name:"Site",publicIdentity:"code",fields:[id("code"),textField("name")]},
 {name:"Machine",publicIdentity:"tag",fields:[id("tag"),
  {...textField("siteCode"),maxLength:40,reference:{target:"Site",onDelete:"restrict"}}]},
 {name:"Ticket",publicIdentity:"number",fields:[id("number"),
  {...textField("machineTag"),maxLength:40,reference:{target:"Machine",onDelete:"restrict"}},
  textField("status"),{name:"dueAt",type:"utcDateTime",unique:false,required:false,nullable:true}]}
],operations:[]};
for(const e of ir.entities){
 const base="/api/"+e.name.toLowerCase()+"s",key=e.publicIdentity;
 for(const [kind,name,method,path,cap,status] of [
  ["create","create"+e.name,"POST",base,"write",201],
  ["get","get"+e.name,"GET",base+"/{"+key+"}","read",200],
  ["listPage","list"+e.name,"GET",base,"read",200]]){
  ir.operations.push({name,entity:e.name,method,path,capability:e.name.toLowerCase()+"s."+cap,
    statuses:[status],behavior:{kind}});
 }
}
const filters=[
 {parameter:"siteCode",via:"machineTag",field:"siteCode",operator:"eq",type:"string"},
 {parameter:"status",field:"status",operator:"eq",type:"string"},
 {parameter:"dueFrom",field:"dueAt",operator:"gte",type:"utcDateTime"},
 {parameter:"dueTo",field:"dueAt",operator:"lte",type:"utcDateTime"}
];
ir.operations.push({name:"searchTickets",entity:"Ticket",method:"GET",path:"/api/tickets/query/filtered",
 capability:"tickets.read",statuses:[200,400,401,403],
 behavior:{kind:"queryPage",filters,sort:{field:"dueAt",direction:"asc"}}});
ir.operations.push({name:"health",entity:"Site",method:"GET",path:"/health",
 capability:"public",statuses:[200],behavior:{kind:"health"}});
const limits={parameters:[
 {name:"limit",in:"query",schema:{type:"integer",minimum:1,maximum:50,default:25}},
 {name:"offset",in:"query",schema:{type:"integer",minimum:0,maximum:1000000,default:0}}
]};
const openapi={paths:Object.fromEntries(ir.operations.filter(o=>["listPage","queryPage"].includes(o.behavior.kind))
 .map(o=>[o.path,{get:limits}]))};

test("A14.2 independently compiles one-hop FK/equality/date-range search, sorted pagination and indexes for both targets",()=>{
 const a=tmp(),b=tmp();spring(ir,openapi,a);nest(ir,openapi,b);
 const java=readFileSync(join(a,"src/main/java/dev/protocolia/modular/Manifest.java"),"utf8");
 const nestManifest=JSON.parse(readFileSync(join(b,"src/manifest.json"),"utf8"));
 const query=nestManifest.operations.find(o=>o.name==="searchTickets");
 assert.equal(query.kind,"queryPage");
 assert.match(java,/QuerySpec/);
 assert.match(java,/j_machine_tag/);
 assert.match(query.query.source,/INNER JOIN "machine" j_machine_tag/);
 assert.match(query.query.order,/due_at.*NULLS LAST.*number/);
 assert.deepEqual(query.query.filters.map(f=>f.comparator),["=","=",">=","<="]);
 const springSql=readFileSync(join(a,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
 const nestSql=readFileSync(join(b,"src/schema.sql"),"utf8");
 for(const sql of [springSql,nestSql]){
   assert.match(sql,/CREATE INDEX IF NOT EXISTS idx_pia_/);
   assert.match(sql,/ON "machine" \("site_code"\)/);
   assert.match(sql,/ON "ticket" \("due_at"\)/);
 }
 const ui=JSON.parse(readFileSync(join(b,"dist/static/protocolia-ui.json"),"utf8"));
 const ticket=ui.resources.find(r=>r.entity.name==="Ticket");
 assert.equal(ticket.operations.queryPage.path,"/api/tickets/query/filtered");
 assert.equal(ticket.operations.queryPage.behavior.filters.length,4);
});
test("A14.2 declarative plan refuses injection, unsupported joins, unsafe sort, invalid types and privilege bypass",()=>{
 const mutations=[
  b=>{b.filters[0].via="status";},
  b=>{b.filters[0].field="badColumn";},
  b=>{b.filters[0].parameter="siteCode; DROP TABLE ticket";},
  b=>{b.filters[0].operator="OR TRUE";},
  b=>{b.filters[0].type="utcDateTime";},
  b=>{b.filters[1].parameter="siteCode";},
  b=>{b.sort.field="doesNotExist";},
  b=>{b.sort.direction="RANDOM()";},
  b=>{b.filters=[];}
 ];
 for(const mutation of mutations){
  const altered=structuredClone(ir),b=altered.operations.find(o=>o.behavior.kind==="queryPage").behavior;
  mutation(b);
  assert.throws(()=>buildQueryPlan(altered,altered.operations.find(o=>o.behavior.kind==="queryPage")));
  assert.throws(()=>spring(altered,openapi,tmp()));
  assert.throws(()=>nest(altered,openapi,tmp()));
 }
 const wrong=structuredClone(ir);wrong.operations.find(o=>o.behavior.kind==="queryPage").capability="tickets.write";
 assert.throws(()=>spring(wrong,openapi,tmp()));assert.throws(()=>nest(wrong,openapi,tmp()));
 const unbounded=structuredClone(ir);unbounded.operations.find(o=>o.behavior.kind==="queryPage").statuses=[200];
 assert.throws(()=>spring(unbounded,openapi,tmp()));assert.throws(()=>nest(unbounded,openapi,tmp()));
});
