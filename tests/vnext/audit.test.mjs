import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generate as spring} from "../../packages/adapters/modular/generate.mjs";
import {generate as nest} from "../../packages/adapters/nest/generate.mjs";

const directory=()=>mkdtempSync(join(tmpdir(),"protocolia-a10-"));
const entity={name:"ServiceCase",publicIdentity:"caseCode",fields:[
  {name:"caseCode",type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:40},
  {name:"subject",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:100},
  {name:"state",type:"string",required:true,nullable:false,unique:false,minLength:1,maxLength:20,initial:"open"}
]};
const op=(name,kind,method,path,capability,statuses,behavior={})=>({
  name,entity:"ServiceCase",method,path,capability,statuses,behavior:{kind,...behavior}
});
const operations=[
  op("createCase","create","POST","/api/cases","cases.write",[201,400,409],{audit:["subject","state"]}),
  op("getCase","get","GET","/api/cases/{caseCode}","cases.read",[200]),
  op("listCases","listPage","GET","/api/cases","cases.read",[200]),
  op("resolveCase","transition","POST","/api/cases/{caseCode}/resolve","cases.write",[200,409],
    {field:"state",from:"open",to:"resolved",audit:["state"]}),
  op("health","health","GET","/health","public",[200])
];
const ir={irVersion:"vnext-a0.1",namespace:"ServiceCases",entities:[entity],operations};
const spec={paths:{"/api/cases":{get:{parameters:[
  {name:"limit",in:"query",schema:{minimum:1,maximum:50,default:25}},
  {name:"offset",in:"query",schema:{minimum:0,maximum:1000000,default:0}}
]}}}};
test("A10 audited service cases emit the same append-only event journal for Spring and Nest",()=>{
  const a=directory(),b=directory();
  spring(ir,spec,a);nest(ir,spec,b);
  for(const [file,pattern] of [
    [join(a,"src/main/resources/db/migration/V1__contract_baseline.sql"),/CREATE TABLE protocolia_audit_event/],
    [join(b,"src/schema.sql"),/CREATE TABLE protocolia_audit_event/],
    [join(a,"src/main/java/dev/protocolia/modular/DomainRuntime.java"),/INSERT INTO protocolia_audit_event/],
    [join(b,"src/main.ts"),/INSERT INTO protocolia_audit_event/]
  ])assert.match(readFileSync(file,"utf8"),pattern,file);
  const manifest=readFileSync(join(a,"src/main/java/dev/protocolia/modular/Manifest.java"),"utf8");
  assert.match(manifest,/List\.of\("subject","state"\)/);
  const nestManifest=JSON.parse(readFileSync(join(b,"src/manifest.json"),"utf8"));
  assert.deepEqual(nestManifest.operations.find(x=>x.name==="createCase").audit,["subject","state"]);
  assert.deepEqual(nestManifest.operations.find(x=>x.name==="resolveCase").audit,["state"]);
});
test("A10 audited-field permissions and field selection reject invalid IR before output",()=>{
  const cases=[
    x=>{x.operations[0].behavior.audit=["password"];},
    x=>{x.operations[0].behavior.audit=["state","state"];},
    x=>{x.operations[0].behavior.audit=[];},
    x=>{x.operations[0].behavior.audit=["caseCode"];},
    x=>{x.operations[1].behavior.audit=["state"];},
    x=>{x.operations[3].behavior.audit=["subject"];},
    x=>{x.operations[3].behavior.audit=["state","subject"];}
  ];
  for(const mutate of cases){
    const copy=structuredClone(ir);mutate(copy);
    assert.throws(()=>spring(copy,spec,directory()));
    assert.throws(()=>nest(copy,spec,directory()));
  }
});
