import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const w="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
const r="Basic "+Buffer.from("reader:test-reader-only-2026").toString("base64");
async function call(method,path,who,body){
  const res=await fetch(base+path,{method,headers:{Authorization:who,
    ...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await res.json();}catch{data=null;}
  return {status:res.status,data};
}
for(const number of ["R-MIG","R-LEGACY"]){
  const result=await call("GET","/api/allocations/"+number,r);
  assert.equal(result.status,200);assert.equal(result.data.status,"active");
}
assert.equal((await call("GET","/api/parts/P-MIG",r)).data.available,7);
const cancel=await call("POST","/api/allocations/R-MIG/cancel",w);
assert.equal(cancel.status,200,JSON.stringify(cancel));
assert.equal(cancel.data.status,"cancelled");
assert.equal((await call("GET","/api/parts/P-MIG",r)).data.available,10);
assert.equal((await call("POST","/api/allocations/R-MIG/cancel",w)).status,409);
assert.equal((await call("GET","/api/parts/P-MIG",r)).data.available,10);
// Unmodified A7 clients send no status; generated A8 backend defaults to active.
const created=await call("POST","/api/allocations",w,{
  number:"R-POST",partSku:"P-MIG",units:2
});
assert.equal(created.status,201,JSON.stringify(created));
assert.equal(created.data.status,"active");
assert.equal((await call("GET","/api/parts/P-MIG",r)).data.available,8);
const page=await call("GET","/api/allocations?limit=25&offset=0",r);
assert.equal(page.status,200);assert.equal(page.data.total,3);
console.log("A9_PERSISTED_V1_ROWS_BACKFILLED_AND_A7_CLIENT_COMPATIBLE_PASS");
