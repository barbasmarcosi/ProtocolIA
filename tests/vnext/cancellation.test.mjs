import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generate as spring} from "../../packages/adapters/modular/generate.mjs";
import {generate as nest} from "../../packages/adapters/nest/generate.mjs";

const temp=()=>mkdtempSync(join(tmpdir(),"protocolia-a8-"));
const field=(name,type,extra={})=>({name,type,required:true,nullable:false,unique:false,...extra});
const entities=[
  {name:"Part",publicIdentity:"sku",fields:[
    field("sku","string",{unique:true,minLength:1,maxLength:40}),
    field("name","string",{minLength:1,maxLength:120}),
    field("available","int32",{min:0})
  ]},
  {name:"Allocation",publicIdentity:"number",fields:[
    field("number","string",{unique:true,minLength:1,maxLength:40}),
    field("partSku","string",{minLength:1,maxLength:40,reference:{target:"Part",onDelete:"restrict"}}),
    field("units","int32",{min:1,max:1000}),
    field("status","string",{minLength:1,maxLength:20,initial:"active"})
  ]}
];
const op=(name,entity,kind,path,capability,statuses,extra={})=>({
  name,entity,method:kind==="create"||kind==="transition"?"POST":"GET",
  path,capability,statuses,behavior:{kind,...extra}
});
const selector={stockEntity:"Part",availableField:"available",referenceField:"partSku",quantityField:"units"};
const operations=[
  op("createPart","Part","create","/api/parts","parts.write",[201,400,409]),
  op("getPart","Part","get","/api/parts/{sku}","parts.read",[200]),
  op("listParts","Part","listPage","/api/parts","parts.read",[200]),
  op("createAllocation","Allocation","create","/api/allocations","allocations.write",[201,400,409],{reserve:selector}),
  op("getAllocation","Allocation","get","/api/allocations/{number}","allocations.read",[200]),
  op("listAllocations","Allocation","listPage","/api/allocations","allocations.read",[200]),
  op("cancelAllocation","Allocation","transition","/api/allocations/{number}/cancel","allocations.write",
    [200,400,404,409],{field:"status",from:"active",to:"cancelled",release:selector}),
  op("health","Part","health","/health","public",[200])
];
const ir={irVersion:"vnext-a0.1",namespace:"Cancellation",entities,operations};
const pagination={parameters:[
  {name:"limit",in:"query",schema:{minimum:1,maximum:50,default:25}},
  {name:"offset",in:"query",schema:{minimum:0,maximum:1000000,default:0}}
]};
const spec={paths:{"/api/parts":{get:pagination},"/api/allocations":{get:pagination}}};
test("A8 both targets compile exactly-once release metadata and guarded rollback",()=>{
  const a=temp(),b=temp();
  spring(ir,spec,a);nest(ir,spec,b);
  const java=readFileSync(join(a,"src/main/java/dev/protocolia/modular/DomainRuntime.java"),"utf8");
  const nestService=readFileSync(join(b,"src/main.ts"),"utf8");
  assert.match(java,/@Transactional/);
  assert.match(java,/2147483647-:amount/);
  assert.match(java,/Reservation already processed/);
  assert.match(nestService,/await client\.query\("BEGIN"\)/);
  assert.match(nestService,/await client\.query\("ROLLBACK"\)/);
  assert.match(nestService,/2147483647-\$1/);
  const manifest=readFileSync(join(a,"src/main/java/dev/protocolia/modular/Manifest.java"),"utf8");
  assert.match(manifest,/new Reserve\("part","sku","available","partSku","units","parts\.write"\)/);
  const compiled=JSON.parse(readFileSync(join(b,"src/manifest.json"),"utf8"));
  assert.equal(compiled.operations.find(x=>x.name==="cancelAllocation").release.stockWriteCapability,"parts.write");
  for(const uiPath of [join(a,"src/main/resources/static/protocolia-ui.json"),
    join(b,"dist/static/protocolia-ui.json")]){
    const config=JSON.parse(readFileSync(uiPath,"utf8"));
    const allocation=config.resources.find(x=>x.entity.name==="Allocation");
    assert.equal(allocation.transitions[0].behavior.release.quantityField,"units");
  }
});
test("A8 invalid cancellation metadata rejects before emitting generated SQL",()=>{
  const corruptors=[
    x=>{x.operations.find(o=>o.name==="cancelAllocation").behavior.release.stockEntity="Missing";},
    x=>{x.operations.find(o=>o.name==="cancelAllocation").behavior.release.availableField="name";},
    x=>{x.operations.find(o=>o.name==="cancelAllocation").behavior.release.quantityField="partSku";},
    x=>{x.operations.find(o=>o.name==="cancelAllocation").behavior.release.referenceField="number";},
    x=>{x.operations.find(o=>o.name==="cancelAllocation").behavior.from="cancelled";},
    x=>{x.operations.find(o=>o.name==="cancelAllocation").behavior.release.quantityField="missing";},
    x=>{x.operations.find(o=>o.name==="createAllocation").behavior.reserve.quantityField="other";},
    x=>{x.operations.push(op("reactivate","Allocation","transition","/api/allocations/{number}/restore",
       "allocations.write",[200,409],{field:"status",from:"cancelled",to:"active"}));}
  ];
  for(const mutate of corruptors){
    const fixture=structuredClone(ir);mutate(fixture);
    assert.throws(()=>spring(fixture,spec,temp()));
    assert.throws(()=>nest(fixture,spec,temp()));
  }
});
