import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const w="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
const r="Basic "+Buffer.from("reader:test-reader-only-2026").toString("base64");
async function call(method,path,token,body){
  const res=await fetch(base+path,{method,headers:{Authorization:token,
    ...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await res.json();}catch{data=null;}
  return {status:res.status,data};
}
for(const [url,payload] of [
  ["/api/parts",{sku:"P-MIG",name:"Original inventory",available:12}],
  ["/api/allocations",{number:"R-MIG",partSku:"P-MIG",units:3}],
  ["/api/allocations",{number:"R-LEGACY",partSku:"P-MIG",units:2}]
]){
  const result=await call("POST",url,w,payload);
  assert.equal(result.status,201,JSON.stringify(result));
}
const part=await call("GET","/api/parts/P-MIG",r);
assert.equal(part.status,200);assert.equal(part.data.available,7);
const old=await call("GET","/api/allocations/R-MIG",r);
assert.equal(old.status,200);assert.equal(Object.hasOwn(old.data,"status"),false);
console.log("A9_V1_ROWS_POPULATED_WITHOUT_STATE_PASS");
