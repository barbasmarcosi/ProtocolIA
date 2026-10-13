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
  assert.match(compose,/127\.0\.0\.1:8080:8080/);
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
