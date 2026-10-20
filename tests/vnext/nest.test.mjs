import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generate} from "../../packages/adapters/nest/generate.mjs";

const ir={
  irVersion:"vnext-a0.1",namespace:"GaugeRegistry",
  entities:[{name:"Gauge",publicIdentity:"serial",view:"Instruments",fields:[
    {name:"serial",type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:40},
    {name:"label",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:90},
    {name:"reading",type:"int32",required:true,nullable:false,unique:false,min:0},
    {name:"calibratedAt",type:"utcDateTime",required:false,nullable:true,unique:false}
  ]}],
  operations:[
    {name:"createGauge",method:"POST",path:"/api/gauges",entity:"Gauge",
      capability:"gauges.write",statuses:[201],behavior:{kind:"create"}},
    {name:"getGauge",method:"GET",path:"/api/gauges/{serial}",entity:"Gauge",
      capability:"gauges.read",statuses:[200],behavior:{kind:"get"}},
    {name:"listGauges",method:"GET",path:"/api/gauges",entity:"Gauge",
      capability:"gauges.read",statuses:[200],behavior:{kind:"listPage"}},
    {name:"renameGauge",method:"PATCH",path:"/api/gauges/{serial}/label",entity:"Gauge",
      capability:"gauges.write",statuses:[200],
      behavior:{kind:"patchFields",field:"label",input:"label"}},
    {name:"increaseGauge",method:"PATCH",path:"/api/gauges/{serial}/reading",entity:"Gauge",
      capability:"gauges.write",statuses:[200],
      behavior:{kind:"atomicIncrement",field:"reading",input:"delta"}},
    {name:"deleteGauge",method:"DELETE",path:"/api/gauges/{serial}",entity:"Gauge",
      capability:"gauges.write",statuses:[204],behavior:{kind:"delete"}},
    {name:"health",method:"GET",path:"/health",entity:"Gauge",
      capability:"public",statuses:[200],behavior:{kind:"health"}}
  ]
};
const spec={paths:{
  "/api/gauges":{
    get:{parameters:[
      {name:"limit",in:"query",schema:{minimum:1,maximum:50,default:25}},
      {name:"offset",in:"query",schema:{minimum:0,maximum:1000000,default:0}}
    ]}
  },
  "/api/gauges/{serial}/reading":{
    patch:{requestBody:{content:{"application/json":{schema:{
      properties:{delta:{minimum:1,maximum:25}}
    }}}}}
  }
}};
const scratch=()=>mkdtempSync(join(tmpdir(),"protocolia-a3-nest-test-"));
test("A3 emits real NestJS controllers, contract metadata and generated PostgreSQL",()=>{
  const folder=scratch();
  const result=generate(ir,spec,folder);
  assert.equal(result.adapter,"nestjs");
  const sql=readFileSync(join(folder,"src/schema.sql"),"utf8");
  assert.match(sql,/CREATE TABLE gauge/);
  assert.match(sql,/PRIMARY KEY/);
  const manifest=JSON.parse(readFileSync(join(folder,"src/manifest.json"),"utf8"));
  assert.deepEqual(manifest.readCapabilities,["gauges.read"]);
  assert.deepEqual(manifest.writeCapabilities,["gauges.write"]);
  assert.equal(manifest.operations.find(x=>x.kind==="atomicIncrement").inputMax,25);
  const backend=readFileSync(join(folder,"src/main.ts"),"utf8");
  assert.match(backend,/@Controller/);
  assert.match(backend,/pg_advisory_xact_lock/);
  assert.match(backend,/2147483647/);
  const ui=JSON.parse(readFileSync(join(folder,"dist/static/protocolia-ui.json"),"utf8"));
  assert.equal(ui.entity.publicIdentity,"serial");
  assert.equal(ui.operations.delete.method,"DELETE");
  assert.match(readFileSync(join(folder,"compose.yaml"),"utf8"),/127\.0\.0\.1/);
});
test("A3 clean repeated compilation has deterministic contract files",()=>{
  const first=scratch(),second=scratch();
  generate(ir,spec,first);generate(ir,spec,second);
  for(const name of ["src/manifest.json","src/schema.sql","dist/static/protocolia-ui.json"])
    assert.equal(readFileSync(join(first,name),"utf8"),readFileSync(join(second,name),"utf8"));
});
test("A3 unsupported capabilities/methods/identity/field behavior fail closed",()=>{
  const wrong=[
    x=>x.operations.find(o=>o.kind==="create"||o.behavior.kind==="create").capability="public",
    x=>x.operations.find(o=>o.behavior.kind==="get").path="/api/gauges/{id}",
    x=>x.operations.find(o=>o.behavior.kind==="atomicIncrement").behavior.field="label",
    x=>x.operations.find(o=>o.behavior.kind==="delete").statuses=[200],
    x=>x.entities[0].publicIdentity="id",
  ];
  for(const mutate of wrong){
    const invalid=structuredClone(ir);
    mutate(invalid);
    assert.throws(()=>generate(invalid,spec,scratch()));
  }
});
test("A3 independently resolves official OpenAPI default/constraints",()=>{
  const broken=structuredClone(spec);
  broken.paths["/api/gauges"].get.parameters[0].schema.maximum=undefined;
  assert.throws(()=>generate(ir,broken,scratch()),/Unresolved bounds/);
});
