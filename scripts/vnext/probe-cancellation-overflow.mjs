import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const writer="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
const reader="Basic "+Buffer.from("reader:test-reader-only-2026").toString("base64");
async function call(method,path,auth,body){
  const r=await fetch(base+path,{method,headers:{
    ...(auth?{Authorization:auth}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();return {status:r.status,data};
}
const id="/api/allocations/R-MAX",part="/api/parts/P-MAX";
let r=await call("POST",id+"/cancel",writer);
assert.equal(r.status,409,JSON.stringify(r));
r=await call("GET",id,reader);assert.equal(r.data.status,"active");
r=await call("GET",part,reader);assert.equal(r.data.available,2147483647);
console.log("A8_OVERFLOW_FAILS_CLOSED_ROLLBACK_PRESERVES_ACTIVE_STATE_PASS");
