#!/usr/bin/env node
// Conformance for the supported single-entity ProtocolIA profile.
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
const config=JSON.parse(readFileSync(resolve(app,"src/main/resources/static/protocolia-ui.json"),"utf8"));
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
async function main(){
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
