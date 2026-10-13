import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../../packages/adapters/modular/generate.mjs";

const fields = [
  {name:"serial",type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:40},
  {name:"label",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:90},
  {name:"reading",type:"int32",required:true,nullable:false,unique:false,min:0},
  {name:"calibratedAt",type:"utcDateTime",required:false,nullable:true,unique:false},
];
const operations = [
  {name:"registerGauge",entity:"Gauge",method:"POST",path:"/api/gauges",capability:"gauges.write",behavior:{kind:"create"}},
  {name:"getGauge",entity:"Gauge",method:"GET",path:"/api/gauges/{serial}",capability:"gauges.read",behavior:{kind:"get"}},
  {name:"listGauges",entity:"Gauge",method:"GET",path:"/api/gauges",capability:"gauges.read",behavior:{kind:"listPage"}},
  {name:"relabelGauge",entity:"Gauge",method:"PATCH",path:"/api/gauges/{serial}/label",capability:"gauges.write",behavior:{kind:"patchFields",field:"label",input:"label"}},
  {name:"addReading",entity:"Gauge",method:"PATCH",path:"/api/gauges/{serial}/reading",capability:"gauges.write",behavior:{kind:"atomicIncrement",field:"reading",input:"delta"}},
  {name:"health",entity:"Gauge",method:"GET",path:"/health",capability:"public",behavior:{kind:"health"}},
];
for(const op of operations)op.statuses=[op.behavior.kind==="create"?201:200];
const ir={irVersion:"vnext-a0.1",namespace:"IndependentGauge",entities:[{name:"Gauge",publicIdentity:"serial",fields}],operations};
const q=(name,def,min,max)=>({name,in:"query",schema:{type:"integer",default:def,minimum:min,maximum:max}});
const spec={paths:{
  "/api/gauges":{get:{parameters:[q("limit",12,1,35),q("offset",0,0,500)]}},
  "/api/gauges/{serial}/reading":{patch:{requestBody:{content:{"application/json":{schema:{
    properties:{delta:{type:"integer",minimum:1,maximum:25}},
  }}}}}},
}};
const scratch=()=>mkdtempSync(join(tmpdir(),"protocolia-modular-fixture-"));
test("independent Gauge fixture derives SQL and Java without Tool hardcodes",()=>{
  const root=scratch();
  const result=generate(ir,spec,root);
  assert.equal(result.files.length,19);
  const sql=readFileSync(join(root,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
  assert.equal(existsSync(join(root,"src/main/resources/schema.sql")),false);
  const java=readFileSync(join(root,"src/main/java/dev/protocolia/modular/Manifest.java"),"utf8");
  assert.match(sql,/CREATE TABLE gauge/);
  assert.match(sql,/ProtocolIA schema SHA256 [a-f0-9]{64}/);
  assert.match(sql,/serial VARCHAR\(40\) PRIMARY KEY NOT NULL/);
  assert.match(sql,/reading INTEGER NOT NULL CHECK \(reading>=0\)/);
  assert.match(java,/IndependentGauge|Gauge/);
  assert.match(java,/\/api\/gauges\/\{serial\}\/reading/);
  assert.doesNotMatch(java,/Tool|Book|Inventory/);
  assert.match(java,/gauges\.read/);
  assert.match(java,/gauges\.write/);
  const compose=readFileSync(join(root,"compose.yaml"),"utf8");
  assert.match(compose,/127\.0\.0\.1:\$\{PROTOCOLIA_HOST_PORT:-8080\}:8080/);
  assert.match(compose,/PROTOCOLIA_ALLOW_DEMO_AUTH/);
  assert.match(compose,/\$\{PROTOCOLIA_DB_PASSWORD:\?/);
  const env=readFileSync(join(root,".env.example"),"utf8");
  assert.match(env,/PROTOCOLIA_ALLOW_DEMO_AUTH=false/);
  assert.doesNotMatch(env,/test-manager-only-2026/);
  const ui=JSON.parse(readFileSync(join(root,"src/main/resources/static/protocolia-ui.json"),"utf8"));
  assert.equal(ui.entity.publicIdentity,"serial");
  assert.equal(ui.operations.atomicIncrement.behavior.input,"delta");
  assert.equal(ui.operations.listPage.path,"/api/gauges");
});
test("same contract and official OpenAPI produce identical managed files in two fresh trees",()=>{
  const first=scratch(),second=scratch();
  const a=generate(ir,spec,first),b=generate(ir,spec,second);
  assert.deepEqual(a.files,b.files);
  for(const path of a.files)
    assert.deepEqual(readFileSync(join(first,path)),readFileSync(join(second,path)),path);
});
test("regeneration is blocked when output has consumer-owned content",()=>{
  const root=scratch(), marker=join(root,"extension.txt");
  writeFileSync(marker,"consumer data\n");
  assert.throws(()=>generate(ir,spec,root),/refusing to overwrite/);
  assert.equal(readFileSync(marker,"utf8"),"consumer data\n");
});
test("unsupported operations and unsafe SQL field names fail before writing",()=>{
  const extra=structuredClone(ir);
  extra.operations.push({...extra.operations[0],name:"unsafe",behavior:{kind:"arbitrarySql"}});
  assert.throws(()=>generate(extra,spec,scratch()),/Unsupported operation/);
  const unsafe=structuredClone(ir);
  unsafe.entities[0].fields[1].name="label; DROP TABLE";
  assert.throws(()=>generate(unsafe,spec,scratch()),/Unsafe identifier/);
});

test("wrong HTTP verb, status and public-key route fail before generating code",()=>{
  const verb=structuredClone(ir);
  verb.operations.find(o=>o.name==="getGauge").method="POST";
  assert.throws(()=>generate(verb,spec,scratch()),/HTTP verb\/status mismatch/);
  const status=structuredClone(ir);
  status.operations.find(o=>o.name==="registerGauge").statuses=[200];
  assert.throws(()=>generate(status,spec,scratch()),/HTTP verb\/status mismatch/);
  const identity=structuredClone(ir);
  identity.operations.find(o=>o.name==="getGauge").path="/api/gauges/{id}";
  assert.throws(()=>generate(identity,spec,scratch()),/Public identity path/);
});

const equipmentFields=[
  {name:"code",type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:40},
  {name:"name",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:120}
];
const inspectionFields=[
  {name:"number",type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:40},
  {name:"equipmentCode",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:40,
    reference:{target:"Equipment",onDelete:"restrict"}},
  {name:"notes",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:160}
];
const a4ops=[
  ...["Equipment","Inspection"].flatMap((entity)=>{
    const path=entity==="Equipment"?"/api/equipment":"/api/inspections";
    const key=entity==="Equipment"?"code":"number";
    const prefix=entity==="Equipment"?"equipment":"inspections";
    return [
      {name:"create"+entity,entity,method:"POST",path,behavior:{kind:"create"},capability:prefix+".write",statuses:[201]},
      {name:"get"+entity,entity,method:"GET",path:path+"/{"+key+"}",behavior:{kind:"get"},capability:prefix+".read",statuses:[200]},
      {name:"list"+entity,entity,method:"GET",path,behavior:{kind:"listPage"},capability:prefix+".read",statuses:[200]},
      {name:"delete"+entity,entity,method:"DELETE",path:path+"/{"+key+"}",behavior:{kind:"delete"},capability:prefix+".write",statuses:[204]}
    ];
  }),
  {name:"health",entity:"Equipment",method:"GET",path:"/health",behavior:{kind:"health"},capability:"public",statuses:[200]}
];
const multiIr={
  irVersion:"vnext-a0.1",namespace:"EquipmentInspections",
  entities:[{name:"Equipment",publicIdentity:"code",fields:equipmentFields},
    {name:"Inspection",publicIdentity:"number",fields:inspectionFields}],operations:a4ops
};
const multiSpec={paths:{
  "/api/equipment":{get:{parameters:[q("limit",25,1,50),q("offset",0,0,1000000)]}},
  "/api/inspections":{get:{parameters:[q("limit",25,1,50),q("offset",0,0,1000000)]}}
}};
test("A4 two entities generate independent SQL tables and a restrictive FK",()=>{
  const path=scratch();
  const generated=generate(multiIr,multiSpec,path);
  assert.equal(generated.adapter,"modular-spring-a0");
  const sql=readFileSync(join(path,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
  assert.match(sql,/CREATE TABLE equipment \(/);
  assert.match(sql,/CREATE TABLE inspection \(/);
  assert.match(sql,/FOREIGN KEY \(equipment_code\) REFERENCES equipment \(code\) ON DELETE RESTRICT/);
  const java=readFileSync(join(path,"src/main/java/dev/protocolia/modular/Manifest.java"),"utf8");
  assert.match(java,/READ_CAPABILITIES=List\.of\("equipment\.read","inspections\.read"\)/);
  assert.match(java,/WRITE_CAPABILITIES=List\.of\("equipment\.write","inspections\.write"\)/);
  assert.match(java,/new Entity\("Equipment"/);
  assert.match(java,/new Entity\("Inspection"/);
  const ui=JSON.parse(readFileSync(join(path,"src/main/resources/static/protocolia-ui.json"),"utf8"));
  assert.equal(ui.resources.length,2);
  assert.deepEqual(ui.resources[1].entity.fields[1].reference,{target:"Equipment",onDelete:"restrict"});
});
test("A4 invalid references fail before emission",()=>{
  for(const invalid of ["Unknown","Inspection"]){
    const value=structuredClone(multiIr);
    value.entities[1].fields[1].reference.target=invalid;
    assert.throws(()=>generate(value,multiSpec,scratch()),/Unsupported FK/);
  }
  const invalid=structuredClone(multiIr);
  invalid.entities[1].fields[1].reference.onDelete="cascade";
  assert.throws(()=>generate(invalid,multiSpec,scratch()),/Unsupported FK/);
});
