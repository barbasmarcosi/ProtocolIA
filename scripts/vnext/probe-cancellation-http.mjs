import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const writer="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
const reader="Basic "+Buffer.from("reader:test-reader-only-2026").toString("base64");
async function call(method,path,auth,body){
  const response=await fetch(base+path,{method,headers:{
    ...(auth?{Authorization:auth}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try{data=await response.json();}catch{data=null;}
  return {status:response.status,data};
}
async function expect(status,method,path,auth,body){
  const response=await call(method,path,auth,body);
  assert.equal(response.status,status,method+" "+path+": "+JSON.stringify(response.data));
  return response.data;
}
const part=async()=>await expect(200,"GET","/api/parts/P-001",reader);
const id="/api/allocations/R-001",cancel=id+"/cancel";
assert.equal((await part()).available,0);
assert.equal((await expect(200,"GET",id,reader)).status,"active");
await expect(401,"POST",cancel);
await expect(403,"POST",cancel,reader);
await expect(400,"POST",cancel,writer,{rogue:true});
await expect(404,"POST","/api/allocations/R-MISSING/cancel",writer);
assert.equal((await part()).available,0);
// Exactly one request transitions active -> cancelled and restores its units.
const outcomes=await Promise.all(Array.from({length:10},()=>call("POST",cancel,writer)));
assert.equal(outcomes.filter(x=>x.status===200).length,1,JSON.stringify(outcomes));
assert.equal(outcomes.filter(x=>x.status===409).length,9,JSON.stringify(outcomes));
assert.equal((await expect(200,"GET",id,reader)).status,"cancelled");
assert.equal((await part()).available,3);
await expect(409,"POST",cancel,writer);
assert.equal((await part()).available,3);
// A cancelled reservation is terminal; a different active reservation can be cancelled.
const allocations=await expect(200,"GET","/api/allocations?limit=25&offset=0",reader);
const another=allocations.items.find(x=>x.number.startsWith("R-RACE-")&&x.status==="active");
assert.ok(another,"Expected another active allocation");
await expect(200,"POST","/api/allocations/"+another.number+"/cancel",writer);
assert.equal((await part()).available,4);
await expect(409,"POST","/api/allocations/"+another.number+"/cancel",writer);
assert.equal((await part()).available,4);
// Create cannot skip directly to cancelled; no stock effect.
await expect(400,"POST","/api/allocations",writer,{
  number:"R-SKIP",partSku:"P-001",units:1,status:"cancelled"
});
assert.equal((await part()).available,4);
// A new ordinary reservation still works after a cancellation restores availability.
await expect(201,"POST","/api/allocations",writer,{
  number:"R-REUSE",partSku:"P-001",units:4,status:"active"
});
assert.equal((await part()).available,0);
assert.equal((await expect(200,"GET","/api/allocations/R-REUSE",reader)).status,"active");
console.log("A8_DOUBLE_CANCEL_CONCURRENT_EXACTLY_ONCE_AND_STOCK_REUSE_PASS");
