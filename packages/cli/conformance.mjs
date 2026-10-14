#!/usr/bin/env node
// Contract-driven HTTP conformance for the supported single/multi-resource profile.
// This test MUTATES its target DB; only the isolated Compose test command may enable it.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [app, base] = process.argv.slice(2);
assert.ok(app && base, "Usage: conformance.mjs <generated-app-dir> <base-url>");
assert.equal(process.env.PROTOCOLIA_ALLOW_CONFORMANCE_WRITES, "true",
  "Conformance writes require explicit isolated-test opt-in");
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/,
  "Conformance cannot mutate a remote or publicly exposed application");
const buildInfo=JSON.parse(readFileSync(resolve(app,"protocolia-build.json"),"utf8"));
const uiPath=buildInfo.target==="nestjs"?"dist/static/protocolia-ui.json":
  buildInfo.target==="modular-spring"?"src/main/resources/static/protocolia-ui.json":null;
assert.ok(uiPath,"Unsupported generated target for conformance");
const config=JSON.parse(readFileSync(resolve(app,uiPath),"utf8"));
const entity=config.entity, operations=config.operations;
const id=entity.publicIdentity, fields=entity.fields;
const managerName=process.env.PROTOCOLIA_MANAGER_USERNAME;
const managerPassword=process.env.PROTOCOLIA_MANAGER_PASSWORD;
const readerName=process.env.PROTOCOLIA_READER_USERNAME;
const readerPassword=process.env.PROTOCOLIA_READER_PASSWORD;
for(const value of [managerName,managerPassword,readerName,readerPassword])
  assert.ok(value,"Both test identities and passwords must be explicitly supplied");
const b64=(a,b)=>"Basic "+Buffer.from(a+":"+b).toString("base64");
const writer=b64(managerName,managerPassword), reader=b64(readerName,readerPassword);
const uuid=randomBytes(9).toString("hex");
function valueFor(field, identity=false){
  if(field.initial!==undefined)return field.initial;
  if(field.type==="utcDateTime")return "2026-10-13T00:00:00Z";
  if(field.type==="int32")return Math.max(field.min??0, identity?0:2);
  if(field.type!=="string")throw Error("Unsupported fixture field "+field.name);
  let value=identity?"C"+uuid:"Sample"+field.name;
  const minimum=Math.max(field.minLength??1,1);
  const maximum=field.maxLength??255;
  if(maximum<minimum||maximum<1)throw Error("Unrepresentable string bounds "+field.name);
  value=value.slice(0,maximum).padEnd(minimum,"x");
  return value;
}
const body=Object.fromEntries(fields.filter(f=>f.required).map(f=>[f.name,valueFor(f,f.name===id)]));
const publicKey=body[id];
assert.equal(typeof publicKey,"string");
const urlFor=(kind,key)=> {
  const op=operations[kind];assert.ok(op,"Unsupported conformance kind "+kind);
  return op.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(key));
};
async function req(kind, authorization, {key,body:payload,query}={}){
  const op=operations[kind];assert.ok(op);
  const suffix=query?"?"+new URLSearchParams(query).toString():"";
  const response=await fetch(base.replace(/\/$/,"")+urlFor(kind,key)+suffix,{
    method:op.method,headers:{
      ...(authorization?{Authorization:authorization}:{}),
      ...(payload===undefined?{}:{"Content-Type":"application/json"})
    },...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
  const raw=await response.text();
  let result;try{result=JSON.parse(raw);}catch{result=raw;}
  return {status:response.status,data:result};
}
// Multi-resource conformance derives dependencies, routes, permissions and
// payloads entirely from the generated manifest. No domain names are special.
function orderedResources(){
  const resources=config.resources??[{entity,operations}];
  const named=new Map(resources.map(x=>[x.entity.name,x]));
  if(named.size!==resources.length)throw Error("Duplicate entity in conformance manifest");
  const result=[],pending=new Set(resources);
  while(pending.size){
    let changed=false;
    for(const res of [...pending]){
      const dependencies=res.entity.fields.filter(f=>f.reference)
        .map(f=>f.reference.target);
      for(const dep of dependencies)if(!named.has(dep))throw Error("Unknown reference: "+dep);
      if(dependencies.every(x=>result.some(r=>r.entity.name===x))){
        result.push(res);pending.delete(res);changed=true;
      }
    }
    if(!changed)throw Error("Reference graph has an unsupported cycle");
  }
  return result;
}
async function runMulti(){
  const resources=orderedResources();
  const keys=new Map();
  const baseUrl=base.replace(/\/$/,"");
  const health=await fetch(baseUrl+"/health");
  assert.equal(health.status,200);
  const sessionRes=await fetch(baseUrl+"/api/_protocolia/me",{headers:{Authorization:writer}});
  assert.equal(sessionRes.status,200);
  const session=await sessionRes.json();
  async function run(resource,kind,who,{key,body,query}={}){
    const op=typeof kind==="string"?resource.operations[kind]:kind;
    assert.ok(op,resource.entity.name+" missing operation "+kind);
    const route=op.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(key));
    const suffix=query?"?"+new URLSearchParams(query).toString():"";
    const response=await fetch(baseUrl+route+suffix,{
      method:op.method,headers:{
        ...(who?{Authorization:who}:{}),
        ...(body===undefined?{}:{"Content-Type":"application/json"})
      },...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const raw=await response.text();
    let result;
    try{result=JSON.parse(raw);}catch{result=raw;}
    return {status:response.status,data:result};
  }
  const createBodies=new Map();
  for(const resource of resources){
    const e=resource.entity,identity=e.publicIdentity;
    for(const kind of ["create","get","listPage"])
      assert.ok(resource.operations[kind],e.name+" requires "+kind);
    assert.ok(session.capabilities.includes(resource.operations.create.capability),
      "Manager missing write permission on "+e.name);
    const body=Object.fromEntries(e.fields.filter(f=>f.required)
      .map(f=>[f.name,f.reference?keys.get(f.reference.target):valueFor(f,f.name===identity)]));
    assert.ok(e.fields.filter(f=>f.reference).every(f=>typeof body[f.name]==="string"));
    const key=body[identity];
    assert.equal(typeof key,"string");
    assert.equal((await run(resource,"get",null,{key})).status,401);
    assert.equal((await run(resource,"create",reader,{body})).status,403);
    const created=await run(resource,"create",writer,{body});
    assert.equal(created.status,201,e.name+": "+JSON.stringify(created.data));
    assert.equal(created.data[identity],key);
    assert.equal(Object.hasOwn(created.data,"id"),false);
    assert.equal((await run(resource,"create",writer,{body})).status,409);
    assert.equal((await run(resource,"get",reader,{key})).status,200);
    const page=await run(resource,"listPage",reader,{query:{limit:1,offset:0}});
    assert.equal(page.status,200);
    assert.ok(page.data.total>=1);
    assert.ok(Array.isArray(page.data.items));
    assert.equal((await run(resource,"create",writer,{body:{...body,unknown:true}})).status,400);
    keys.set(e.name,key);createBodies.set(e.name,body);
    if(resource.operations.patchFields){
      const op=resource.operations.patchFields;
      const field=e.fields.find(f=>f.name===op.behavior.field);
      assert.ok(field);
      const update=String(valueFor(field))+"V2";
      const value=update.slice(0,field.maxLength??255);
      const changed=await run(resource,"patchFields",writer,{key,body:{[op.behavior.input]:value}});
      assert.equal(changed.status,200);
      assert.equal((await run(resource,"patchFields",reader,{key,body:{[op.behavior.input]:value}})).status,403);
    }
    if(resource.operations.atomicIncrement){
      const op=resource.operations.atomicIncrement;
      const initial=created.data[op.behavior.field];
      assert.equal(typeof initial,"number");
      const updates=await Promise.all(Array.from({length:10},()=>
        run(resource,"atomicIncrement",writer,{key,body:{[op.behavior.input]:1}})));
      assert.ok(updates.every(x=>x.status===200),e.name+" atomic updates");
      const after=await run(resource,"get",reader,{key});
      assert.equal(after.data[op.behavior.field],initial+10);
    }
    let executed=0;
    for(const op of resource.transitions??[]){
      const field=e.fields.find(f=>f.name===op.behavior.field);
      assert.ok(field?.initial, "Transition requires an initial-state field");
      const current=await run(resource,"get",reader,{key});
      if(current.data[field.name]!==op.behavior.from)continue;
      assert.equal((await run(resource,op,reader,{key})).status,403);
      assert.equal((await run(resource,op,writer,{key,body:{unexpected:true}})).status,400);
      const results=await Promise.all(Array.from({length:10},()=>run(resource,op,writer,{key})));
      assert.equal(results.filter(x=>x.status===200).length,1);
      assert.equal(results.filter(x=>x.status===409).length,9);
      assert.equal((await run(resource,"get",reader,{key})).data[field.name],op.behavior.to);
      executed++;
    }
    if((resource.transitions??[]).length)assert.ok(executed>0,"No declared transition was executable");
    for(const f of e.fields.filter(f=>f.reference)){
      const bad={...body,[identity]:("MISSING"+uuid).slice(0,e.fields.find(x=>x.name===identity).maxLength??64),
        [f.name]:"UNMATCHED-"+uuid};
      assert.equal((await run(resource,"create",writer,{body:bad})).status,400);
    }
  }
  // RESTRICT is not cosmetic: parents referenced by persisted children must refuse delete.
  for(const resource of resources){
    if(!resource.operations.delete)continue;
    const used=resources.some(child=>child.entity.fields.some(
      f=>f.reference?.target===resource.entity.name));
    if(used)assert.equal((await run(resource,"delete",writer,{key:keys.get(resource.entity.name)})).status,409);
  }
  for(const resource of [...resources].reverse()){
    if(!resource.operations.delete)continue;
    const key=keys.get(resource.entity.name);
    assert.equal((await run(resource,"delete",reader,{key})).status,403);
    assert.equal((await run(resource,"delete",writer,{key})).status,204);
    assert.equal((await run(resource,"get",reader,{key})).status,404);
  }
  console.log((resources.some(r=>(r.transitions??[]).length)?"PROTOCOLIA_STATEFUL_CONFORMANCE_PASS ":"PROTOCOLIA_MULTIRESOURCE_CONFORMANCE_PASS ")+
    JSON.stringify({entities:resources.map(r=>r.entity.name),references:resources.flatMap(r=>
      r.entity.fields.filter(f=>f.reference).map(f=>r.entity.name+"."+f.name+"->"+f.reference.target))}));
}

async function main(){
  if((config.resources?.length??1)>1||(config.transitions?.length??0)>0)return runMulti();
  const health=await fetch(base.replace(/\/$/,"")+"/health");assert.equal(health.status,200);
  const probe=await fetch(base.replace(/\/$/,"")+"/api/_protocolia/me",{headers:{Authorization:writer}});
  assert.equal(probe.status,200);
  const session=await probe.json();
  assert.ok(session.capabilities.includes(operations.create.capability));

  assert.equal((await req("get",null,{key:publicKey})).status,401);
  assert.equal((await req("create",reader,{body})).status,403);
  const created=await req("create",writer,{body});
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data[id],publicKey);
  assert.equal(Object.hasOwn(created.data,"id"),false);
  assert.equal((await req("create",writer,{body})).status,409);
  const read=await req("get",reader,{key:publicKey});
  assert.equal(read.status,200);
  assert.equal(read.data[id],publicKey);
  const paged=await req("listPage",reader,{query:{limit:1,offset:0}});
  assert.equal(paged.status,200);
  assert.ok(Array.isArray(paged.data.items));
  assert.ok(paged.data.total>=1);
  assert.equal((await req("create",writer,{body:{...body,[id]:valueFor(fields.find(f=>f.name===id),true)+"Z",unexpected:true}})).status,400);
  const changedField=operations.patchFields.behavior.field;
  const patchInput=operations.patchFields.behavior.input;
  const patchMeta=fields.find(f=>f.name===changedField);
  const updated=valueFor(patchMeta)+"Revised";
  const changed=await req("patchFields",writer,{key:publicKey,body:{[patchInput]:updated.slice(0,patchMeta.maxLength??255)}});
  assert.equal(changed.status,200);
  assert.equal(changed.data[id],publicKey);
  assert.equal((await req("patchFields",reader,{key:publicKey,body:{[patchInput]:updated}})).status,403);

  const incrementField=operations.atomicIncrement.behavior.field;
  const incrementInput=operations.atomicIncrement.behavior.input;
  const starting=created.data[incrementField];
  assert.equal(typeof starting,"number");
  const updates=await Promise.all(Array.from({length:10},()=>
    req("atomicIncrement",writer,{key:publicKey,body:{[incrementInput]:1}})));
  assert.ok(updates.every(r=>r.status===200),"Atomic operations must all commit");
  const after=await req("get",reader,{key:publicKey});
  assert.equal(after.data[incrementField],starting+10);
  assert.equal((await req("atomicIncrement",writer,{key:publicKey,body:{[incrementInput]:0}})).status,400);

  if(operations.delete){
    assert.equal((await req("delete",reader,{key:publicKey})).status,403);
    assert.equal((await req("delete",writer,{key:publicKey})).status,204);
    assert.equal((await req("get",reader,{key:publicKey})).status,404);
  }
  console.log("PROTOCOLIA_CONFORMANCE_PASS "+JSON.stringify({
    entity:entity.name,identity:id,base,ops:Object.keys(operations),
    concurrent:10,finalValue:starting+10,deleted:Boolean(operations.delete)
  }));
}
main().catch(e=>{console.error("PROTOCOLIA_CONFORMANCE_FAIL "+e.stack);process.exitCode=1;});
