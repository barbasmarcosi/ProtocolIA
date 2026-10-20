import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generate as spring} from "../../packages/adapters/modular/generate.mjs";
import {generate as nest} from "../../packages/adapters/nest/generate.mjs";

const entity={name:"Order",publicIdentity:"code",fields:[
  {name:"code",type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:40},
  {name:"title",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:120},
  {name:"status",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:20,initial:"draft"}
]};
const op=(name,method,path,kind,capability,extra={})=>({
  name,method,path,entity:"Order",capability,statuses:kind==="create"?[201]:kind==="transition"?[200,409]:[200],
  behavior:{kind,...extra}
});
const ops=[
  op("create","POST","/api/orders","create","orders.write"),
  op("get","GET","/api/orders/{code}","get","orders.read"),
  op("list","GET","/api/orders","listPage","orders.read"),
  op("approve","POST","/api/orders/{code}/approve","transition","orders.write",
    {field:"status",from:"draft",to:"approved"}),
  op("close","POST","/api/orders/{code}/close","transition","orders.write",
    {field:"status",from:"approved",to:"closed"}),
  op("health","GET","/health","health","public")
];
const ir={irVersion:"vnext-a0.1",namespace:"Orders",entities:[entity],operations:ops};
const spec={paths:{"/api/orders":{get:{parameters:[
  {name:"limit",in:"query",schema:{minimum:1,maximum:50,default:25}},
  {name:"offset",in:"query",schema:{minimum:0,maximum:1000000,default:0}}
]}}}};
const folder=()=>mkdtempSync(join(tmpdir(),"protocolia-workflow-"));
test("state machine generates guarded Spring+Nest SQL and multi-action UI",()=>{
  const a=folder(),b=folder();
  spring(ir,spec,a);nest(ir,spec,b);
  const java=readFileSync(join(a,"src/main/java/dev/protocolia/modular/DomainRuntime.java"),"utf8");
  const nestRuntime=readFileSync(join(b,"src/main.ts"),"utf8");
  for(const runtime of [java,nestRuntime]){
    assert.match(runtime,/Transition precondition failed/);
    assert.match(runtime,/transition/);
  }
  for(const sql of [
    readFileSync(join(a,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8"),
    readFileSync(join(b,"src/schema.sql"),"utf8")
  ]){
    assert.match(sql,/CHECK \(status IN \('approved','closed','draft'\)\)/);
  }
  for(const file of [
    join(a,"src/main/resources/static/protocolia-ui.json"),
    join(b,"dist/static/protocolia-ui.json")
  ]){
    const ui=JSON.parse(readFileSync(file,"utf8"));
    assert.deepEqual(ui.transitions.map(x=>x.name),["approve","close"]);
    assert.equal(ui.entity.fields.find(x=>x.name==="status").initial,"draft");
  }
});
test("invalid transition state, request and privilege bypass reject before generation",()=>{
  const tests=[
    x=>{x.operations[3].behavior.from="draft'; DROP TABLE orders; --";},
    x=>{x.operations[3].behavior.from=x.operations[3].behavior.to;},
    x=>{x.operations[3].capability="orders.read";},
    x=>{x.operations[3].behavior.input="userValue";},
    x=>{x.operations[3].statuses=[200];},
    x=>{x.entities[0].fields[2].initial="unauthorized";x.entities[0].fields[2].maxLength=5;},
    x=>{x.operations.push(op("bypass","PATCH","/api/orders/{code}/status",
      "patchFields","orders.write",{field:"status",input:"status"}));}
  ];
  for(const corrupt of tests){
    const data=structuredClone(ir);corrupt(data);
    assert.throws(()=>spring(data,spec,folder()));
    assert.throws(()=>nest(data,spec,folder()));
  }
});
