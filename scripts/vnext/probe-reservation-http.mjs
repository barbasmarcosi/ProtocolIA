import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const writer="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
const reader="Basic "+Buffer.from("reader:test-reader-only-2026").toString("base64");
async function call(method,path,auth,body){
  const res=await fetch(base+path,{method,headers:{
    ...(auth?{Authorization:auth}:{}),
    ...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  const raw=await res.text();
  let data;try{data=JSON.parse(raw);}catch{data=raw;}
  return {status:res.status,data};
}
async function verify(code,method,path,auth,body){
  const r=await call(method,path,auth,body);
  assert.equal(r.status,code,method+" "+path+" "+JSON.stringify(r.data));
  return r.data;
}
const stock="/api/parts",alloc="/api/allocations";
const get=async()=>await verify(200,"GET",stock+"/P-001",reader);
await verify(401,"GET",stock+"/P-001");
await verify(403,"POST",stock,reader,{sku:"P-001",name:"part",available:10});
await verify(201,"POST",stock,writer,{sku:"P-001",name:"Steel bolt",available:10});
await verify(400,"POST",stock,writer,{sku:"P-BAD",name:"bad",available:-1});
const before=await get();
assert.equal(before.available,10);
await verify(403,"POST",alloc,reader,{number:"R-DENY",partSku:"P-001",units:1});
await verify(400,"POST",alloc,writer,{number:"R-NO-STOCK",partSku:"MISSING",units:1});
await verify(400,"POST",alloc,writer,{number:"R-ZERO",partSku:"P-001",units:0});
await verify(400,"POST",alloc,writer,{number:"R-UNKNOWN",partSku:"P-001",units:1,rogue:true});
assert.equal((await get()).available,10);
const created=await verify(201,"POST",alloc,writer,{number:"R-001",partSku:"P-001",units:3});
assert.equal(created.partSku,"P-001");assert.equal(created.units,3);
assert.equal((await get()).available,7);
// Database insert of a duplicate must roll back the already-executed stock debit.
await verify(409,"POST",alloc,writer,{number:"R-001",partSku:"P-001",units:2});
assert.equal((await get()).available,7);
await verify(409,"POST",alloc,writer,{number:"R-OVER",partSku:"P-001",units:8});
assert.equal((await get()).available,7);
// Distinct reservation identities compete over the same row. No overselling.
const requests=Array.from({length:10},(_,i)=>call("POST",alloc,writer,{
  number:"R-RACE-"+i,partSku:"P-001",units:1
}));
const outcomes=await Promise.all(requests);
assert.equal(outcomes.filter(x=>x.status===201).length,7,JSON.stringify(outcomes));
assert.equal(outcomes.filter(x=>x.status===409).length,3,JSON.stringify(outcomes));
assert.equal((await get()).available,0);
assert.equal((await verify(200,"GET",alloc+"/R-001",reader)).units,3);
await verify(404,"GET",alloc+"/MISSING",reader);
await verify(409,"POST",alloc,writer,{number:"R-TOO-LATE",partSku:"P-001",units:1});
const page=await verify(200,"GET",alloc+"?limit=25&offset=0",reader);
assert.equal(page.total,8);
console.log("A7_RESERVE_DEBIT_INSERT_ROLLBACK_AND_TEN_WAY_RACE_PASS");
