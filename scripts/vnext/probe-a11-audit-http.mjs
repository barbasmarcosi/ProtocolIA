import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const manager="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
const reader="Basic "+Buffer.from("reader:test-reader-only-2026").toString("base64");
async function check(path,auth,expect){
 const r=await fetch(base+path,{headers:{...(auth?{Authorization:auth}:{})}});
 let payload={};try{payload=await r.json();}catch{}
 assert.equal(r.status,expect,JSON.stringify({path,status:r.status,payload}));
 return payload;
}
const path="/api/work-orders/W-001/audit";
const me=await check("/api/_protocolia/me",manager,200);
assert.ok(me.capabilities.includes("orders.audit"));
const readerSession=await check("/api/_protocolia/me",reader,200);
assert.ok(!readerSession.capabilities.includes("orders.audit"));
await check(path,null,401);
await check(path,reader,403);
await check("/api/work-orders/W-NOPE/audit",reader,403); // no identity enumeration without authority
await check("/api/work-orders/W-NOPE/audit",manager,404);
for(const query of ["limit=0","limit=51","offset=-1","offset=1000001","limit=abc","unknown=1","offset=1.5"]){
 await check(path+"?"+query,manager,400);
}
const full=await check(path+"?limit=25&offset=0",manager,200);
assert.equal(full.total,4);
assert.equal(full.items.length,4);
assert.deepEqual(full.items.map(x=>x.operationName+":"+x.fieldName),[
 "closeWorkOrder:status","approveWorkOrder:status","createWorkOrder:status","createWorkOrder:title"
]);
assert.deepEqual(full.items.map(x=>[x.beforeValue,x.afterValue]),[
 ["approved","closed"],["draft","approved"],[null,"draft"],[null,"Inspect machine"]
]);
for(const event of full.items){
 assert.equal(event.actor,"manager");
 assert.equal(event.entityName,"WorkOrder");
 assert.equal(event.resourceId,"W-001");
 assert.match(event.id,/^[0-9]+$/);
 assert.match(event.occurredAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ$/);
}
const first=await check(path+"?limit=2&offset=0",manager,200);
const second=await check(path+"?limit=2&offset=2",manager,200);
assert.deepEqual([...first.items,...second.items],full.items);
assert.equal(first.total,4);assert.equal(second.total,4);
assert.equal((await check(path+"?limit=2&offset=4",manager,200)).items.length,0);
const other=await check("/api/work-orders/W-AUDFAIL/audit",manager,200);
assert.equal(other.total,2,"Must not leak another resource audit events");
assert.ok(other.items.every(x=>x.resourceId==="W-AUDFAIL"));
console.log("A11_AUDIT_READER_403_MANAGER_PAGES_ISOLATED_FIELDS_TIMESTAMPS_PASS");