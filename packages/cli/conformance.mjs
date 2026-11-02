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
  if(field.choices!==undefined){
    assert.ok(field.type==="string"&&Array.isArray(field.choices)&&field.choices.length>0,
      "Unsupported or empty contract enum fixture "+field.name);
    const allowed=field.choices.find(choice=>typeof choice.value==="string"&&choice.value.length>0);
    assert.ok(allowed,"No valid enum fixture for "+field.name);
    return allowed.value;
  }
  if(field.type==="utcDateTime")return "2026-10-13T00:00:00Z";
  if(field.type==="int32")return Math.max(field.min??0, identity?0:2);
  if(field.type==="decimal"){
    // This oracle writes only in disposable Compose environments. Never use JS Number
    // for exact value generation: compare fixed-scale integer units instead.
    const d=field.decimal;
    if(!d||!Number.isInteger(d.scale)||!Number.isInteger(d.precision))
      throw Error("Unresolved decimal precision and scale "+field.name);
    const units=value=>{
      const negative=value.startsWith("-");
      const [whole,fraction=""]=(negative?value.slice(1):value).split(".");
      return BigInt((negative?"-":"")+whole+fraction.padEnd(d.scale,"0"));
    };
    const maxInt=BigInt("9".repeat(d.precision-d.scale)||"0");
    const defaultValue=(d.precision-d.scale>0?"2":"0")+
      (d.scale>0?"."+"0".repeat(d.scale):"");
    const maxValue=maxInt.toString()+(d.scale>0?"."+"9".repeat(d.scale):"");
    let candidate=defaultValue;
    if(d.min!==undefined&&units(candidate)<units(d.min))candidate=d.min;
    if(d.max!==undefined&&units(candidate)>units(d.max))candidate=d.max;
    if(units(candidate)>units(maxValue))throw Error("Unrepresentable decimal fixture "+field.name);
    return candidate;
  }
  if(field.type!=="string")throw Error("Unsupported fixture field "+field.name);
  if(field.pattern!==undefined){
    const supported="^[0-9]{4}-(0[1-9]|1[0-2])$";
    if(field.pattern!==supported)throw Error("No safe fixture for authoritative pattern "+field.name);
    return "2026-10";
  }
  let value=identity?"C"+uuid:"Sample"+field.name;
  const minimum=Math.max(field.minLength??1,1);
  const maximum=field.maxLength??255;
  if(maximum<minimum||maximum<1)throw Error("Unrepresentable string bounds "+field.name);
  value=value.slice(0,maximum).padEnd(minimum,"x");
  return value;
}
const body=Object.fromEntries(fields.filter(f=>f.required&&!f.serverDerived&&!f.fixedInitial&&!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal).map(f=>[f.name,valueFor(f,f.name===id)]));
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
  // Derive the versioned document relationship from canonical generated metadata.
  // No special entity/table/field names; never infer concurrency from URL shapes.
  const creators=resources.filter(r=>r.operations.create?.behavior?.createDetails?.versioned);
  const versionedChild=resource=>creators.find(parent=>
    parent.operations.create.behavior.createDetails.childEntity===resource.entity.name);
  const immutableChild=resource=>resources.find(parent=>{
    const detail=parent.operations.create?.behavior?.createDetails;
    return detail?.chargeAmountField&&detail.childEntity===resource.entity.name;
  });
  const versionedTransition=(resource,op)=>{
    const details=resource.operations.create?.behavior?.createDetails;
    return details?.versioned && details.closeField&&details.closeState&&
      op.behavior.kind==="transition"&&op.behavior.field===details.closeField&&
      op.behavior.to===details.closeState;
  };
  async function run(resource,kind,who,{key,body,query,ifMatch}={}){
    const op=typeof kind==="string"?resource.operations[kind]:kind;
    assert.ok(op,resource.entity.name+" missing operation "+kind);
    const route=op.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(key));
    const suffix=query?"?"+new URLSearchParams(query).toString():"";
    // Resolve the ETag only for authorized mutation attempts. Negative 403
    // tests must reach the backend without accidentally acquiring authority.
    let versionTag=ifMatch;
    if(versionTag===undefined&&who===writer){
      const childParent=versionedChild(resource);
      const parent=childParent??(
        versionedTransition(resource,op)||op.behavior.kind==="replaceDetails"&&
        resource.operations.create?.behavior?.createDetails?.versioned?resource:null);
      if(parent && (childParent?
        ["create","patchFields","delete"].includes(op.behavior.kind):
        ["transition","replaceDetails"].includes(op.behavior.kind))){
        const details=parent.operations.create.behavior.createDetails;
        let parentKey=childParent?body?.[details.parentField]:key;
        if(childParent&&op.behavior.kind!=="create"){
          const child=await run(resource,"get",writer,{key});
          parentKey=child.status===200?child.data[details.parentField]:undefined;
        }
        if(typeof parentKey==="string"){
          const header=await run(parent,"get",writer,{key:parentKey});
          if(header.status===200){
            assert.ok(Number.isInteger(header.data.documentVersion)&&
              header.data.documentVersion>=1,"Document read lacks persisted version");
            assert.equal(header.etag,'"'+header.data.documentVersion+'"',
              "Generated parent ETag must match the documentVersion field");
            versionTag=header.etag;
          }
        }
        // Preserve 404/400 negative tests for missing child/parent identities.
        // An absent child must not be mistaken for an invalid If-Match header.
        versionTag??='"1"';
      }
    }
    const response=await fetch(baseUrl+route+suffix,{
      method:op.method,headers:{
        ...(who?{Authorization:who}:{}),
        ...(body===undefined?{}:{"Content-Type":"application/json"}),
        ...(versionTag===undefined?{}:{"If-Match":versionTag})
      },...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const raw=await response.text();
    let result;
    try{result=JSON.parse(raw);}catch{result=raw;}
    return {status:response.status,data:result,etag:response.headers.get("etag")};
  }
  const createBodies=new Map();
  const deferredClosures=[];
  for(const resource of resources){
    const e=resource.entity,identity=e.publicIdentity;
    const sealed=immutableChild(resource);
    if(sealed){
      // The generated UI correctly omits direct CREATE for immutable financial
      // rows. They are created only as part of their parent transaction.
      assert.equal(resource.operations.create,undefined,
        "Immutable financial charge rows must not advertise standalone CREATE");
      assert.ok(resource.operations.get&&resource.operations.listPage);
      const detail=sealed.operations.create.behavior.createDetails;
      const parentBody=createBodies.get(sealed.entity.name);
      const rows=parentBody?.[detail.rowsField];
      assert.ok(Array.isArray(rows)&&rows.length>=1,
        "Financial charge rows must be supplied atomically with their parent");
      for(const line of rows){
        const key=line[identity];
        assert.equal(typeof key,"string");
        const read=await run(resource,"get",reader,{key});
        assert.equal(read.status,200,"Atomic child rows must be independently readable");
        assert.equal(read.data[detail.parentField],
          parentBody[sealed.entity.publicIdentity]);
      }
      keys.set(e.name,rows[0][identity]);
      createBodies.set(e.name,{...rows[0],
        [detail.parentField]:parentBody[sealed.entity.publicIdentity]});
      continue;
    }
    for(const kind of ["create","get","listPage"])
      assert.ok(resource.operations[kind],e.name+" requires "+kind);
    assert.ok(session.capabilities.includes(resource.operations.create.capability),
      "Manager missing write permission on "+e.name);
    const owned=e.fields.some(f=>f.ownerManaged);
    const body=Object.fromEntries(e.fields.filter(f=>f.required&&!f.ownerManaged&&!f.serverDerived&&!f.fixedInitial&&!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal&&
      !((resource.operations.create.behavior.moveUnits||resource.operations.create.behavior.moveBatch)&&
        f.initial!==undefined))
      .map(f=>[f.name,f.reference?keys.get(f.reference.target):valueFor(f,f.name===identity)]));
    assert.ok(e.fields.filter(f=>f.reference).every(f=>typeof body[f.name]==="string"));
    const key=body[identity];
    assert.equal(typeof key,"string");
    assert.equal((await run(resource,"get",null,{key})).status,401);
    assert.equal((await run(resource,"create",reader,{body})).status,403);
    const details=resource.operations.create.behavior.createDetails;
    let detailFixture;
    if(details){
      const child=resources.find(x=>x.entity.name===details.childEntity);
      assert.ok(child,"Child entity from B12 contract must be emitted as an independent resource");
      const fields=child.entity.fields.filter(field=>field.name!==details.parentField&&!field.fixedInitial&&
        !field.computedSum&&!field.computedProduct&&!field.computedRoundedProduct&&
        !field.computedDiscountedTotal);
      const keyField=fields.find(field=>field.name===child.entity.publicIdentity);
      assert.ok(keyField,"Missing child public key for dynamic detail collection");
      const rows=[1,2].map(i=>Object.fromEntries(fields.map(field=>{
        const value=valueFor(field,field.name===child.entity.publicIdentity);
        return [field.name,field.name===child.entity.publicIdentity?
          String(value).slice(0,(field.maxLength??255)-2)+"D"+i:value];
      })));
      body[details.rowsField]=rows;
      detailFixture={child,rows};
    }
    const reserve=resource.operations.create.behavior.reserve;
    const parent=reserve?resources.find(r=>r.entity.name===reserve.stockEntity):undefined;
    const move=resource.operations.create.behavior.moveUnits;
    const batch=resource.operations.create.behavior.moveBatch;
    const moveParent=move?resources.find(r=>r.entity.name===move.stockEntity):undefined;
    let batchAccounts;
    if(batch){
      const parent=resources.find(r=>r.entity.name===batch.stockEntity);
      const base=createBodies.get(batch.stockEntity);
      assert.ok(parent&&base,"Multi-leg settlement needs its parent fixture first");
      const parentKey=parent.entity.publicIdentity;
      const keyField=parent.entity.fields.find(f=>f.name===parentKey);
      const original=base[parentKey];
      const suffixKey=suffix=>String(original).slice(0,(keyField.maxLength??255)-1)+suffix;
      const left=suffixKey("X"),right=suffixKey("Y");
      for(const key of [left,right]){
        const child={...base,[parentKey]:key,[batch.availableField]:0};
        assert.equal((await run(parent,"create",writer,{body:child})).status,201,
          "Multi-leg fixture requires all parents to exist");
      }
      for(let i=0;i<batch.legs.length;i++){
        const leg=batch.legs[i];
        const source=i===0?original:i%2===1?left:right;
        const target=i===0?left:i%2===1?right:original;
        body[leg.sourceField]=source;
        body[leg.targetField]=target;
      }
      batchAccounts={parent,ids:[original,left,right],before:[]};
      for(const key of batchAccounts.ids){
        const result=await run(parent,"get",reader,{key});
        assert.equal(result.status,200);
        batchAccounts.before.push(result.data[batch.availableField]);
      }
    }
    let moveBefore;
    if(move){
      assert.ok(moveParent,"Transfer parent not found");
      const parentBody=createBodies.get(move.stockEntity);
      assert.ok(parentBody,"Parent fixture must precede transfer");
      const keyField=moveParent.entity.fields.find(f=>f.name===moveParent.entity.publicIdentity);
      assert.ok(keyField);
      const source=body[move.sourceField];
      assert.equal(typeof source,"string");
      // Use a separate parent, never allow the oracle to simulate a self-transfer.
      const alternate=(source.slice(0,Math.max(0,(keyField.maxLength??255)-1))+"X");
      assert.notEqual(alternate,source,"Unable to make distinct related fixture");
      const target={...parentBody,[moveParent.entity.publicIdentity]:alternate,
        [move.availableField]:0};
      assert.equal((await run(moveParent,"create",writer,{body:target})).status,201,
        "Secondary transfer parent must be a real persisted record");
      body[move.targetField]=alternate;
      const first=await run(moveParent,"get",reader,{key:source});
      const second=await run(moveParent,"get",reader,{key:alternate});
      assert.equal(first.status,200);assert.equal(second.status,200);
      moveBefore={first:first.data[move.availableField],
        second:second.data[move.availableField],source,target:alternate};
      assert.ok(moveBefore.first>=body[move.quantityField],
        "Stock fixture must be sufficient for the generated transfer amount");
    }
    const beforeStock=reserve?await run(parent,"get",reader,{key:body[reserve.referenceField]}):undefined;
    if(reserve)assert.equal(beforeStock.status,200,"Stock parent is required by reservation");
    const created=await run(resource,"create",writer,{body});
    assert.equal(created.status,201,e.name+": "+JSON.stringify(created.data));
    assert.equal(created.data[identity],key);
    if(owned)assert.equal(created.data[e.fields.find(f=>f.ownerManaged).name],managerName);
    if(detailFixture)for(const row of detailFixture.rows){
      const result=await run(detailFixture.child,"get",reader,{
        key:row[detailFixture.child.entity.publicIdentity]});
      assert.equal(result.status,200,"B12 row must exist after header insertion");
      assert.equal(result.data[details.parentField],key);
    }
    assert.equal(Object.hasOwn(created.data,"id"),false);
    if(move){
      const first=await run(moveParent,"get",reader,{key:moveBefore.source});
      const second=await run(moveParent,"get",reader,{key:moveBefore.target});
      assert.equal(first.status,200);assert.equal(second.status,200);
      assert.equal(first.data[move.availableField],
        moveBefore.first-body[move.quantityField],"Transfer source debited once");
      assert.equal(second.data[move.availableField],
        moveBefore.second+body[move.quantityField],"Transfer destination credited once");
    }
    if(batch){
      const deltas=new Map(batchAccounts.ids.map(id=>[id,0]));
      for(const leg of batch.legs){
        const units=body[leg.quantityField];
        deltas.set(body[leg.sourceField],deltas.get(body[leg.sourceField])-units);
        deltas.set(body[leg.targetField],deltas.get(body[leg.targetField])+units);
      }
      for(let i=0;i<batchAccounts.ids.length;i++){
        const key=batchAccounts.ids[i];
        const after=await run(batchAccounts.parent,"get",reader,{key});
        assert.equal(after.status,200);
        assert.equal(after.data[batch.availableField],
          batchAccounts.before[i]+deltas.get(key),"Atomic net movement per parent");
      }
    }
    if(reserve){
      const afterStock=await run(parent,"get",reader,{key:body[reserve.referenceField]});
      assert.equal(afterStock.status,200);
      assert.equal(afterStock.data[reserve.availableField],
        beforeStock.data[reserve.availableField]-body[reserve.quantityField],
        "Atomic reservation must debit exactly the amount specified by the contract");
    }
    assert.equal((await run(resource,"create",writer,{body})).status,409);
    if(move){
      const first=await run(moveParent,"get",reader,{key:moveBefore.source});
      const second=await run(moveParent,"get",reader,{key:moveBefore.target});
      assert.equal(first.data[move.availableField],
        moveBefore.first-body[move.quantityField],"Duplicate journal must roll back source debit");
      assert.equal(second.data[move.availableField],
        moveBefore.second+body[move.quantityField],"Duplicate journal must roll back destination credit");
    }
    if(batch){
      // Duplicating the journal key must not settle any participating parent twice.
      const after=await Promise.all(batchAccounts.ids.map(async key=>{
        const result=await run(batchAccounts.parent,"get",reader,{key});
        return result.data[batch.availableField];
      }));
      const originalSum=batchAccounts.before.reduce((a,b)=>a+b,0);
      assert.equal(after.reduce((a,b)=>a+b,0),originalSum,
        "Duplicate batch must conserve all participating parents");
      const expected=new Map(batchAccounts.ids.map((id,i)=>[id,batchAccounts.before[i]]));
      for(const leg of batch.legs){
        expected.set(body[leg.sourceField],expected.get(body[leg.sourceField])-body[leg.quantityField]);
        expected.set(body[leg.targetField],expected.get(body[leg.targetField])+body[leg.quantityField]);
      }
      assert.deepEqual(after,batchAccounts.ids.map(id=>expected.get(id)));
    }
    if(reserve){
      const afterDuplicate=await run(parent,"get",reader,{key:body[reserve.referenceField]});
      assert.equal(afterDuplicate.data[reserve.availableField],
        beforeStock.data[reserve.availableField]-body[reserve.quantityField],
        "Duplicate reservation must not retain a stock debit");
    }

    if(reserve){
      // Live DB race: independent keys compete for the SAME seven units.
      // This is checked via actual generated HTTP endpoints and PostgreSQL,
      // not a mock or a repeated idempotent request.
      const stockField=parent.entity.fields.find(f=>f.name===reserve.availableField);
      const debitField=e.fields.find(f=>f.name===reserve.quantityField);
      const parentKeyField=parent.entity.fields.find(f=>f.name===parent.entity.publicIdentity);
      const debitKeyField=e.fields.find(f=>f.name===identity);
      const stockFixture=createBodies.get(reserve.stockEntity);
      const canRace=stockFixture&&stockField&&(stockField.min??0)<=7&&(stockField.max??2147483647)>=7&&
        debitField&&(debitField.min??1)<=2&&(debitField.max??2147483647)>=2&&
        parentKeyField&&(parentKeyField.maxLength??255)>=8&&
        debitKeyField&&(debitKeyField.maxLength??255)>=8;
      if(canRace){
        const mkId=(base,suffix,max)=>String(base).slice(0,max-suffix.length)+suffix;
        const stockId=mkId(stockFixture[parent.entity.publicIdentity],"Race",parentKeyField.maxLength??255);
        const stockBody={...stockFixture,[parent.entity.publicIdentity]:stockId,[reserve.availableField]:7};
        const opening=await run(parent,"create",writer,{body:stockBody});
        assert.equal(opening.status,201,"Concurrent stock fixture must be created");
        const attempts=Array.from({length:12},(_,i)=>{
          const debitId=mkId(key,"Race"+i,debitKeyField.maxLength??255);
          return {...body,[identity]:debitId,[reserve.referenceField]:stockId,[reserve.quantityField]:2};
        });
        const settled=await Promise.all(attempts.map(payload=>run(resource,"create",writer,{body:payload})));
        const accepted=settled.filter(x=>x.status===201);
        const rejected=settled.filter(x=>x.status===409);
        assert.equal(accepted.length,3,
          "Atomic stock debit: seven available, twelve simultaneous requests of two must admit exactly three");
        assert.equal(rejected.length,9,
          "Atomic stock debit: exhausted concurrent requests must reject without an extra debit");
        const afterRace=await run(parent,"get",reader,{key:stockId});
        assert.equal(afterRace.status,200);
        assert.equal(afterRace.data[reserve.availableField],1,
          "PostgreSQL must never permit overselling or lost-update races");
        for(let i=0;i<attempts.length;i++){
          const found=await run(resource,"get",reader,{key:attempts[i][identity]});
          assert.equal(found.status,settled[i].status===201?200:404,
            "The persisted debit journal must match exactly the committed debit outcomes");
        }
        console.log("PROTOCOLIA_ATOMIC_DEBIT_RACE_PASS "+JSON.stringify({
          entity:e.name,parallel:12,approved:accepted.length,rejected:rejected.length,
          finalAvailable:afterRace.data[reserve.availableField]
        }));
      }
    }
    assert.equal((await run(resource,"get",reader,{key})).status,owned?404:200);
    const page=await run(resource,"listPage",reader,{query:{limit:1,offset:0}});
    assert.equal(page.status,200);
    assert.ok(Array.isArray(page.data.items));
    if(owned){
      assert.equal(page.data.total,0,"Owned page count must be scoped");
      assert.deepEqual(page.data.items,[]);
      const creatorPage=await run(resource,"listPage",writer,{query:{limit:1,offset:0}});
      assert.equal(creatorPage.status,200);
      assert.ok(creatorPage.data.total>=1);
    }else assert.ok(page.data.total>=1);
    assert.equal((await run(resource,"create",writer,{body:{...body,unknown:true}})).status,400);
    keys.set(e.name,key);createBodies.set(e.name,body);
    const patchOptions=resource.patchFieldsOptions?.length?
      resource.patchFieldsOptions:
      resource.operations.patchFields?[resource.operations.patchFields]:[];
    for(const op of patchOptions){
      const patchResource={...resource,operations:{...resource.operations,patchFields:op}};
      const field=e.fields.find(f=>f.name===op.behavior.field);
      assert.ok(field);
      const update=String(valueFor(field))+"V2";
      const previous=body[op.behavior.input];
      const value=field.type==="int32"?
        Math.min(field.max??1000000000,(field.min??1)+3):
        update.slice(0,field.maxLength??255);
      const patchBody={
        [op.behavior.input]:value,
        ...(op.behavior.audit?.length?{expected:previous}:{})
      };
      const changed=await run(patchResource,"patchFields",writer,{key,body:patchBody});
      assert.equal(changed.status,200,e.name+" PATCH "+JSON.stringify(changed.data));
      assert.equal((await run(patchResource,"patchFields",reader,{key,body:patchBody})).status,403);
      if(op.behavior.audit?.length)
        assert.equal((await run(patchResource,"patchFields",writer,{key,body:patchBody})).status,409,
          "Stale audited patch must never overwrite a prior update");
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
    // The compiler is allowed to sort operations alphabetically; do not
    // interpret the emitted order as business-state ordering. Resolve the
    // dependent transitions of the reviewed case from its source graph.
    const transitionPlan=e.name==="ReviewCase"?
      [...(resource.transitions??[])].sort((a,b)=>{
        const stage={submitReviewCase:0,approveReviewCase:1,rejectReviewCase:2};
        return (stage[a.name]??99)-(stage[b.name]??99);
      }):resource.transitions??[];
    for(const op of transitionPlan){
      // Terminal closure must execute after all dependent resource fixtures have
      // been created and edited. Closing midway would correctly forbid later
      // child creation and produce a false-negative generic conformance result.
      if(versionedTransition(resource,op)){
        deferredClosures.push({resource,op,key});
        continue;
      }
      const field=e.fields.find(f=>f.name===op.behavior.field);
      assert.ok(field?.initial, "Transition requires an initial-state field");
      const current=await run(resource,"get",reader,{key});
      if(current.data[field.name]!==op.behavior.from)continue;
      const release=op.behavior.release;
      const stockResource=release?resources.find(x=>x.entity.name===release.stockEntity):undefined;
      const stockKey=release?current.data[release.referenceField]:undefined;
      const beforeRelease=release?await run(stockResource,"get",reader,{key:stockKey}):undefined;
      if(release)assert.equal(beforeRelease.status,200);
      assert.equal((await run(resource,op,reader,{key})).status,403);
      assert.equal((await run(resource,op,writer,{key,body:{unexpected:true}})).status,400);
      const results=await Promise.all(Array.from({length:10},()=>run(resource,op,writer,{key})));
      assert.equal(results.filter(x=>x.status===200).length,1);
      assert.equal(results.filter(x=>x.status===409).length,9);
      assert.equal((await run(resource,"get",reader,{key})).data[field.name],op.behavior.to);
      if(release){
        const credited=await run(stockResource,"get",reader,{key:stockKey});
        assert.equal(credited.status,200);
        assert.equal(credited.data[release.availableField],
          beforeRelease.data[release.availableField]+current.data[release.quantityField],
          "A8 cancellation must credit exactly once across concurrent requests");
        assert.equal((await run(resource,op,writer,{key})).status,409);
        const afterDuplicate=await run(stockResource,"get",reader,{key:stockKey});
        assert.equal(afterDuplicate.data[release.availableField],credited.data[release.availableField],
          "A8 repeated cancellation cannot re-credit stock");
      }
      executed++;
    }
    if((resource.transitions??[]).some(op=>!versionedTransition(resource,op)))
      assert.ok(executed>0,"No declared transition was executable");

    // P2 operator composition: a journal reservation has two terminal choices,
    // one committing the reserved units and the other returning them. This tests
    // actual HTTP/Postgres behavior for BOTH choices, not only the first branch
    // encountered in the generated operation manifest.
    if(reserve){
      const branch=(resource.transitions??[]).filter(t=>t.behavior.kind==="transition"&&
        t.behavior.from===e.fields.find(f=>f.name===t.behavior.field)?.initial);
      const approved=branch.find(t=>!t.behavior.release);
      const rejected=branch.find(t=>!!t.behavior.release);
      const parentBody=createBodies.get(reserve.stockEntity);
      const parentId=parent?.entity.fields.find(f=>f.name===parent.entity.publicIdentity);
      const childId=e.fields.find(f=>f.name===identity);
      const qty=e.fields.find(f=>f.name===reserve.quantityField);
      const capacity=parent?.entity.fields.find(f=>f.name===reserve.availableField);
      if(branch.length===2&&approved&&rejected&&
         approved.behavior.field===rejected.behavior.field&&
         approved.behavior.to!==rejected.behavior.to&&
         parentBody&&parentId&&childId&&capacity&&qty&&
         (capacity.min??0)<=7&&(capacity.max??2147483647)>=7&&
         (qty.min??1)<=2&&(qty.max??2147483647)>=2){
        const suffix=(base,ending,max)=>String(base).slice(0,max-ending.length)+ending;
        const parentKey=suffix(parentBody[parent.entity.publicIdentity],"ForkPool",parentId.maxLength??255);
        assert.ok(parentKey.length<=parentId.maxLength&&parentKey!==body[reserve.referenceField]);
        const pool={...parentBody,[parent.entity.publicIdentity]:parentKey,[reserve.availableField]:7};
        assert.equal((await run(parent,"create",writer,{body:pool})).status,201);
        const mkClaim=ending=>({...body,
          [identity]:suffix(key,ending,childId.maxLength??255),
          [reserve.referenceField]:parentKey,
          [reserve.quantityField]:2});
        const yes=mkClaim("ApproveFork");
        const no=mkClaim("RejectFork");
        assert.notEqual(yes[identity],no[identity]);
        assert.equal((await run(resource,"create",writer,{body:yes})).status,201);
        assert.equal((await run(resource,"create",writer,{body:no})).status,201);
        const afterReservations=await run(parent,"get",reader,{key:parentKey});
        assert.equal(afterReservations.data[reserve.availableField],3,
          "Two pending journal entries must reserve four of seven units");
        const runRace=async (operation,claimId)=>{
          const results=await Promise.all(Array.from({length:10},()=>
            run(resource,operation,writer,{key:claimId})));
          assert.equal(results.filter(v=>v.status===200).length,1,
            "Only one of ten concurrent decisions may succeed");
          assert.equal(results.filter(v=>v.status===409).length,9,
            "Repeated decisions must all conflict");
        };
        await runRace(approved,yes[identity]);
        assert.equal((await run(parent,"get",reader,{key:parentKey})).data[reserve.availableField],3,
          "Approving a request must retain already reserved capacity");
        await runRace(rejected,no[identity]);
        assert.equal((await run(parent,"get",reader,{key:parentKey})).data[reserve.availableField],5,
          "Rejecting a request must return exactly its two reserved units");
        assert.equal((await run(resource,"get",reader,{key:yes[identity]})).data[approved.behavior.field],
          approved.behavior.to);
        assert.equal((await run(resource,"get",reader,{key:no[identity]})).data[rejected.behavior.field],
          rejected.behavior.to);
        assert.equal((await run(resource,rejected,writer,{key:yes[identity]})).status,409,
          "Cannot reject a committed approval");
        assert.equal((await run(resource,approved,writer,{key:no[identity]})).status,409,
          "Cannot approve a terminal rejection");
        assert.equal((await run(parent,"get",reader,{key:parentKey})).data[reserve.availableField],5,
          "Conflicting terminal decisions must not mutate the balance");
        console.log("PROTOCOLIA_COMPOSED_OPERATOR_CONFORMANCE_PASS "+JSON.stringify({
          entity:e.name,initial:7,reserved:4,afterApproval:3,afterRejection:5,
          concurrentAccepted:1,concurrentRejected:9
        }));
      }
    }

    // Source-bounded reviewer state machine: test BOTH mutually exclusive
    // terminal branches, not merely the first path traversed by the generic
    // single-record state conformance. No external financial side effects.
    if(e.name==="ReviewCase"){
      const transitions=resource.transitions??[];
      const submit=transitions.find(t=>t.name==="submitReviewCase");
      const approve=transitions.find(t=>t.name==="approveReviewCase");
      const reject=transitions.find(t=>t.name==="rejectReviewCase");
      assert.ok(submit&&approve&&reject,"ReviewCase requires three source-typed transitions");
      assert.equal(approve.behavior.from,reject.behavior.from);
      assert.equal(submit.behavior.to,approve.behavior.from);
      const afterApproved=await run(resource,"get",reader,{key});
      assert.equal(afterApproved.status,200);
      assert.equal(afterApproved.data.state,approve.behavior.to);
      assert.equal((await run(resource,reject,writer,{key})).status,409,
        "An approved case cannot also become rejected");
      const identityField=e.fields.find(f=>f.name===identity);
      const max=identityField?.maxLength??64;
      const suffix="Alt"+uuid.slice(0,5);
      assert.ok(max>suffix.length+2,"Review identity too short for branch fixture");
      const alternateKey=String(key).slice(0,max-suffix.length)+suffix;
      const alternateBody={...body,[identity]:alternateKey};
      assert.equal((await run(resource,"create",writer,{body:alternateBody})).status,201,
        "Fork test must create an independent persisted review case");
      assert.equal((await run(resource,approve,writer,{key:alternateKey})).status,409,
        "Cannot approve a draft without entering review");
      assert.equal((await run(resource,submit,writer,{key:alternateKey})).status,200,
        "Alternate branch must enter review");
      const race=await Promise.all(Array.from({length:10},()=>
        run(resource,reject,writer,{key:alternateKey})));
      assert.equal(race.filter(v=>v.status===200).length,1,
        "Concurrent rejections must have one state change");
      assert.equal(race.filter(v=>v.status===409).length,9,
        "Remaining rejections must conflict");
      assert.equal((await run(resource,"get",reader,{key:alternateKey})).data.state,
        reject.behavior.to,"The alternative decision must persist independently");
      assert.equal((await run(resource,approve,writer,{key:alternateKey})).status,409,
        "A rejected case cannot later become approved");
      console.log("PROTOCOLIA_REVIEW_FORK_CONFORMANCE_PASS "+JSON.stringify({
        entity:e.name,first:approve.behavior.to,second:reject.behavior.to,
        concurrentRejected:9
      }));
    }
    for(const f of e.fields.filter(f=>f.reference)){
      const bad={...body,[identity]:("MISSING"+uuid).slice(0,e.fields.find(x=>x.name===identity).maxLength??64),
        [f.name]:"UNMATCHED-"+uuid};
      assert.equal((await run(resource,"create",writer,{body:bad})).status,400);
    }
  }
  // A terminal state is evaluated only once all resource fixtures have been
  // created. The same 10-writer CAS contention still proves one transition
  // can succeed and that the other nine are rejected by document version/state.
  for(const {resource,op,key} of deferredClosures){
    const field=resource.entity.fields.find(f=>f.name===op.behavior.field);
    assert.ok(field?.initial,"Terminal transition requires initial state");
    const before=await run(resource,"get",reader,{key});
    assert.equal(before.status,200);
    assert.equal(before.data[field.name],op.behavior.from);
    const version=before.data.documentVersion;
    assert.ok(Number.isSafeInteger(version)&&version>=1);
    assert.equal((await run(resource,op,reader,{key})).status,403);
    assert.equal((await run(resource,op,writer,{key,body:{unexpected:true}})).status,400);
    const results=await Promise.all(Array.from({length:10},()=>
      run(resource,op,writer,{key})));
    assert.equal(results.filter(x=>x.status===200).length,1,
      "Exactly one terminal close may consume the current version");
    assert.equal(results.filter(x=>x.status===409).length,9);
    const after=await run(resource,"get",reader,{key});
    assert.equal(after.status,200);
    assert.equal(after.data[field.name],op.behavior.to);
    assert.equal(after.data.documentVersion,version+1);
    assert.equal(after.etag,'"'+after.data.documentVersion+'"');
    const closedChild=resources.find(x=>versionedChild(x)===resource);
    if(closedChild){
      const parentField=resource.operations.create.behavior.createDetails.parentField;
      const sample=createBodies.get(closedChild.entity.name);
      if(sample?.[parentField]===key){
        const attempt=await run(closedChild,"create",writer,{
          body:{...sample,[closedChild.entity.publicIdentity]:
            ("CLOSED-"+uuid).slice(0,closedChild.entity.fields.find(f=>
              f.name===closedChild.entity.publicIdentity).maxLength??64)}
        });
        assert.equal(attempt.status,409,"Closed parent must reject child writes");
      }
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
    const versionedParent=versionedChild(resource);
    const plan=versionedParent?.operations.create?.behavior?.createDetails;
    const parentKey=createBodies.get(resource.entity.name)?.[plan?.parentField];
    const closed=plan?.closeField&&plan?.closeState&&typeof parentKey==="string"&&
      (await run(versionedParent,"get",writer,{key:parentKey})).data?.[plan.closeField]===
        plan.closeState;
    // Some contracts deliberately make journal children immutable: a posted
    // debit can be reversed but its row cannot be deleted. The physical FK
    // must continue to RESTRICT parents at *every* level of the hierarchy.
    const liveChild=await Promise.all(resources.flatMap(child=>
      child.entity.fields.filter(f=>f.reference?.target===resource.entity.name)
        .map(async field=>{
          const fixture=createBodies.get(child.entity.name);
          const childKey=keys.get(child.entity.name);
          if(!fixture||fixture[field.name]!==key||!childKey||!child.operations.get)
            return false;
          return (await run(child,"get",reader,{key:childKey})).status===200;
        })));
    if(closed||liveChild.includes(true)){
      assert.equal((await run(resource,"delete",writer,{key})).status,409,
        "A referenced/closed parent must reject deletion while child rows survive");
      assert.equal((await run(resource,"get",reader,{key})).status,200);
    }else{
      assert.equal((await run(resource,"delete",writer,{key})).status,204);
      assert.equal((await run(resource,"get",reader,{key})).status,404);
    }
  }
  console.log((resources.some(r=>r.operations.create?.behavior?.reserve)?
    (resources.some(r=>(r.transitions??[]).some(t=>t.behavior.release))?
      "PROTOCOLIA_COMPENSATING_CONFORMANCE_PASS ":"PROTOCOLIA_TRANSACTIONAL_CONFORMANCE_PASS "):
    resources.some(r=>(r.transitions??[]).length)?"PROTOCOLIA_STATEFUL_CONFORMANCE_PASS ":
    "PROTOCOLIA_MULTIRESOURCE_CONFORMANCE_PASS ")+
    JSON.stringify({entities:resources.map(r=>r.entity.name),references:resources.flatMap(r=>
      r.entity.fields.filter(f=>f.reference).map(f=>r.entity.name+"."+f.name+"->"+f.reference.target))}));
}

async function runOwnerScope(){
  const owner=fields.find(f=>f.ownerManaged);
  assert.ok(owner,"Missing owner-managed field");
  for(const kind of ["create","get","listPage"])assert.ok(operations[kind]);
  const payload={...body};delete payload[owner.name];
  assert.equal((await req("get",null,{key:publicKey})).status,401);
  assert.equal((await req("create",reader,{body:payload})).status,403);
  assert.equal((await req("create",writer,{body:{...payload,[owner.name]:readerName}})).status,400);
  const created=await req("create",writer,{body:payload});
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data[owner.name],managerName,"Owner must be server-derived");
  assert.equal((await req("create",writer,{body:payload})).status,409);
  assert.equal((await req("get",writer,{key:publicKey})).status,200);
  assert.equal((await req("get",reader,{key:publicKey})).status,404);
  assert.equal((await req("get",writer,{key:"absent-"+uuid})).status,404);
  const own=await req("listPage",writer,{query:{limit:25,offset:0}});
  const foreign=await req("listPage",reader,{query:{limit:25,offset:0}});
  assert.equal(own.status,200);assert.equal(foreign.status,200);
  assert.equal(own.data.total,1);assert.equal(foreign.data.total,0);
  assert.deepEqual(foreign.data.items,[]);
  assert.deepEqual(own.data.items.map(x=>x[id]),[publicKey]);
  assert.equal((await req("listPage",null,{query:{limit:25,offset:0}})).status,401);
  if(operations.patchFields){
    const op=operations.patchFields,field=op.behavior.field;
    assert.notEqual(op.capability,operations.create.capability,"Field write needs independent authority");
    const me=await fetch(base.replace(/\/$/,"")+"/api/_protocolia/me",{headers:{Authorization:writer}});
    assert.equal(me.status,200);
    const session=await me.json();
    assert.ok(session.capabilities.includes(op.capability),"Manager requires field write grant");
    assert.equal((await req("patchFields",reader,{key:publicKey,body:{[field]:"Reader attempt"}})).status,403);
    assert.equal((await req("patchFields",writer,{key:publicKey,body:{owner:readerName}})).status,400);
    const change=await req("patchFields",writer,{key:publicKey,body:{[field]:"Edited by owner"}});
    assert.equal(change.status,200,JSON.stringify(change.data));
    assert.equal(change.data[field],"Edited by owner");
    assert.equal((await req("get",writer,{key:publicKey})).data[field],"Edited by owner");
    assert.equal((await req("patchFields",writer,{key:"absent-"+uuid,body:{[field]:"Other"}})).status,404);
  }
  console.log("PROTOCOLIA_OWNER_SCOPE_CONFORMANCE_PASS "+JSON.stringify({entity:entity.name,owner:owner.name,isolated:true}));
}
async function main(){
  if(fields.some(f=>f.ownerManaged)&&(config.resources?.length??1)===1)return runOwnerScope();
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
  if(operations.patchFields){
  const changedField=operations.patchFields.behavior.field;
  const patchInput=operations.patchFields.behavior.input;
  const patchMeta=fields.find(f=>f.name===changedField);
  const updated=valueFor(patchMeta)+"Revised";
  const changed=await req("patchFields",writer,{key:publicKey,body:{[patchInput]:updated.slice(0,patchMeta.maxLength??255)}});
  assert.equal(changed.status,200);
  assert.equal(changed.data[id],publicKey);
  assert.equal((await req("patchFields",reader,{key:publicKey,body:{[patchInput]:updated}})).status,403);

  }
  let incrementResult=null;
  if(operations.atomicIncrement){
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
  incrementResult={concurrent:10,finalValue:starting+10};

  }
  if(operations.delete){
    assert.equal((await req("delete",reader,{key:publicKey})).status,403);
    assert.equal((await req("delete",writer,{key:publicKey})).status,204);
    assert.equal((await req("get",reader,{key:publicKey})).status,404);
  }
  console.log("PROTOCOLIA_CONFORMANCE_PASS "+JSON.stringify({
    entity:entity.name,identity:id,base,ops:Object.keys(operations),
    concurrent:incrementResult?.concurrent??0,finalValue:incrementResult?.finalValue??null,deleted:Boolean(operations.delete)
  }));
}
main().catch(e=>{console.error("PROTOCOLIA_CONFORMANCE_FAIL "+e.stack);process.exitCode=1;});
