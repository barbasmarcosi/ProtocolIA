import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generate as spring} from "../../packages/adapters/modular/generate.mjs";
import {generate as nest} from "../../packages/adapters/nest/generate.mjs";
const dir=()=>mkdtempSync(join(tmpdir(),"a11-contract-"));
const fields=[
 {name:"id",type:"string",unique:true,required:true,nullable:false,minLength:1,maxLength:40},
 {name:"state",type:"string",unique:false,required:true,nullable:false,minLength:1,maxLength:20,initial:"open"},
];
const make=(kind,name,method,path,capability,statuses,behavior={})=>({entity:"ServiceCase",name,method,path,capability,statuses,behavior:{kind,...behavior}});
const ir={irVersion:"vnext-a0.1",namespace:"ServiceCase",entities:[{name:"ServiceCase",publicIdentity:"id",fields}],operations:[
 make("create","createCase","POST","/api/cases","cases.write",[201,400],{audit:["state"]}),
 make("get","getCase","GET","/api/cases/{id}","cases.read",[200]),
 make("listPage","listCases","GET","/api/cases","cases.read",[200]),
 make("transition","closeCase","POST","/api/cases/{id}/close","cases.write",[200,409],{field:"state",from:"open",to:"closed",audit:["state"]}),
 make("auditPage","listCaseAudit","GET","/api/cases/{id}/audit","cases.audit",[200,400,404]),
 make("health","health","GET","/health","public",[200])
]};
const paging={
 parameters:[
  {name:"limit",in:"query",schema:{default:25,minimum:1,maximum:50}},
  {name:"offset",in:"query",schema:{default:0,minimum:0,maximum:1000000}}
 ]};
const spec={paths:{"/api/cases":{get:paging},"/api/cases/{id}/audit":{get:paging}}};
test("A11 independent ServiceCase contract generates protected audit pagination in both backends and React",()=>{
 const a=dir(),b=dir();spring(ir,spec,a);nest(ir,spec,b);
 const java=readFileSync(join(a,"src/main/java/dev/protocolia/modular/Manifest.java"),"utf8");
 assert.match(java,/AUDIT_CAPABILITIES=List.of\("cases.audit"\)/);
 const sj=readFileSync(join(a,"src/main/java/dev/protocolia/modular/DomainRuntime.java"),"utf8");
 const nj=readFileSync(join(b,"src/main.ts"),"utf8");
 for(const source of [sj,nj])assert.match(source,/ORDER BY id DESC LIMIT/);
 assert.match(sj,/case "auditPage"/);
 assert.match(nj,/case "auditPage"/);
 const nManifest=JSON.parse(readFileSync(join(b,"src/manifest.json"),"utf8"));
 assert.deepEqual(nManifest.auditCapabilities,["cases.audit"]);
 const web=JSON.parse(readFileSync(join(a,"src/main/resources/static/protocolia-ui.json"),"utf8"));
 assert.equal(web.operations.auditPage.path,"/api/cases/{id}/audit");
 assert.equal(web.operations.auditPage.capability,"cases.audit");
});
test("A11 adapters reject an audit read privilege shared with normal readers or writers",()=>{
 for(const cap of ["cases.read","cases.write","public"]){
  const changed=structuredClone(ir);
  changed.operations.find(x=>x.behavior.kind==="auditPage").capability=cap;
  assert.throws(()=>spring(changed,spec,dir()));
  assert.throws(()=>nest(changed,spec,dir()));
 }
 for(const kind of ["create","transition"]){
  const changed=structuredClone(ir);
  changed.operations.find(x=>x.behavior.kind===kind).behavior.audit=undefined;
  if(kind==="create")changed.operations.find(x=>x.behavior.kind==="transition").behavior.audit=undefined;
  else changed.operations.find(x=>x.behavior.kind==="create").behavior.audit=undefined;
  assert.throws(()=>spring(changed,spec,dir()));
  assert.throws(()=>nest(changed,spec,dir()));
 }
});
