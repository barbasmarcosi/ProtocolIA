import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generate as spring} from "../../packages/adapters/modular/generate.mjs";
import {generate as nest} from "../../packages/adapters/nest/generate.mjs";

const make=()=>mkdtempSync(join(tmpdir(),"protocolia-a7-"));
const fields={
  Part:[
    {name:"sku",type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:40},
    {name:"name",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:100},
    {name:"available",type:"int32",required:true,nullable:false,unique:false,min:0}
  ],
  Allocation:[
    {name:"number",type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:40},
    {name:"partSku",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:40,
      reference:{target:"Part",onDelete:"restrict"}},
    {name:"units",type:"int32",required:true,nullable:false,unique:false,min:1,max:1000}
  ]
};
const entities=[
  {name:"Part",publicIdentity:"sku",fields:fields.Part},
  {name:"Allocation",publicIdentity:"number",fields:fields.Allocation}
];
const ops=[
  ["createPart","Part","POST","/api/parts","create","parts.write",[201,400,409]],
  ["getPart","Part","GET","/api/parts/{sku}","get","parts.read",[200]],
  ["listPart","Part","GET","/api/parts","listPage","parts.read",[200]],
  ["createAllocation","Allocation","POST","/api/allocations","create","allocations.write",[201,400,409]],
  ["getAllocation","Allocation","GET","/api/allocations/{number}","get","allocations.read",[200]],
  ["listAllocation","Allocation","GET","/api/allocations","listPage","allocations.read",[200]],
  ["health","Part","GET","/health","health","public",[200]]
].map(([name,entity,method,path,kind,capability,statuses])=>({name,entity,method,path,capability,statuses,
  behavior:{kind,...(name==="createAllocation"?{
    reserve:{stockEntity:"Part",availableField:"available",referenceField:"partSku",quantityField:"units"}
  }:{})}}));
const ir={irVersion:"vnext-a0.1",namespace:"IndependentInventory",entities,operations:ops};
const page={parameters:[
  {name:"limit",in:"query",schema:{minimum:1,maximum:50,default:25}},
  {name:"offset",in:"query",schema:{minimum:0,maximum:1000000,default:0}}
]};
const spec={paths:{"/api/parts":{get:page},"/api/allocations":{get:page}}};
test("A7 reservation manifest drives atomic stock debit and child INSERT in both adapters",()=>{
  const a=make(),b=make();
  spring(ir,spec,a);nest(ir,spec,b);
  const sqlA=readFileSync(join(a,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
  const sqlB=readFileSync(join(b,"src/schema.sql"),"utf8");
  for(const sql of [sqlA,sqlB]){
    assert.match(sql,/CHECK \(available>=0\)/);
    assert.match(sql,/FOREIGN KEY \(part_sku\) REFERENCES part \(sku\) ON DELETE RESTRICT/);
  }
  const java=readFileSync(join(a,"src/main/java/dev/protocolia/modular/DomainRuntime.java"),"utf8");
  const nestRuntime=readFileSync(join(b,"src/main.ts"),"utf8");
  assert.match(java,/@Transactional/);
  assert.match(java,/Insufficient availability/);
  assert.match(java,/stockWriteCapability\(\)/);
  assert.match(nestRuntime,/await client\.query\("BEGIN"\)/);
  assert.match(nestRuntime,/await client\.query\("ROLLBACK"\)/);
  assert.match(nestRuntime,/Insufficient stock/);
  for(const path of [join(a,"src/main/resources/static/protocolia-ui.json"),
    join(b,"dist/static/protocolia-ui.json")]){
    const ui=JSON.parse(readFileSync(path,"utf8"));
    const child=ui.resources.find(r=>r.entity.name==="Allocation");
    assert.equal(child.operations.create.behavior.reserve.quantityField,"units");
  }
  const nestManifest=JSON.parse(readFileSync(join(b,"src/manifest.json"),"utf8"));
  assert.equal(nestManifest.operations.find(o=>o.name==="createAllocation").reserve.stockWriteCapability,"parts.write");
});
test("A7 adapters reject malformed reserve semantics before generated output",()=>{
  const invalid=[
    d=>{d.operations.find(o=>o.name==="createAllocation").behavior.reserve.stockEntity="Missing";},
    d=>{d.operations.find(o=>o.name==="createAllocation").behavior.reserve.quantityField="partSku";},
    d=>{d.operations.find(o=>o.name==="createAllocation").behavior.reserve.availableField="name";},
    d=>{d.entities.find(e=>e.name==="Part").fields.find(f=>f.name==="available").min=-1;},
    d=>{d.entities.find(e=>e.name==="Allocation").fields.find(f=>f.name==="partSku").reference=undefined;},
    d=>{d.operations.find(o=>o.name==="createAllocation").statuses=[201];},
    d=>{d.operations.find(o=>o.name==="createAllocation").behavior.kind="get";}
  ];
  for(const corrupt of invalid){
    const bad=structuredClone(ir);corrupt(bad);
    assert.throws(()=>spring(bad,spec,make()));
    assert.throws(()=>nest(bad,spec,make()));
  }
});
