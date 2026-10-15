import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const manager="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
async function create(path,body){
  const response=await fetch(base+path,{method:"POST",headers:{
    Authorization:manager,"Content-Type":"application/json"
  },body:JSON.stringify(body)});
  assert.equal(response.status,201,await response.text());
}
await create("/api/parts",{sku:"P-MAX",name:"Overflow guard",available:2147483647});
await create("/api/allocations",{number:"R-MAX",partSku:"P-MAX",units:1,status:"active"});
console.log("A8_OVERFLOW_SETUP_ACTIVE_RESERVATION_PASS");
