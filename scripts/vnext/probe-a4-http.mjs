import assert from "node:assert/strict";
const root="http://127.0.0.1:8080";
const token=(name,password)=>"Basic "+Buffer.from(name+":"+password).toString("base64");
const manager={Authorization:token("manager","test-manager-only-2026"),"Content-Type":"application/json"};
const reader={Authorization:token("reader","test-reader-only-2026"),"Content-Type":"application/json"};
async function call(method,path,headers={},body){
  const response=await fetch(root+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
  return {status:response.status,data};
}
async function check(method,path,headers,body,status){
  const result=await call(method,path,headers,body);
  assert.equal(result.status,status,method+" "+path+": "+JSON.stringify(result.data));
  return result.data;
}
assert.equal((await call("GET","/api/equipment/E-001")).status,401);
const permissions=await check("GET","/api/_protocolia/me",manager,undefined,200);
assert.ok(permissions.capabilities.includes("equipment.write"));
assert.ok(permissions.capabilities.includes("inspections.write"));
assert.ok(!((await check("GET","/api/_protocolia/me",reader,undefined,200)).capabilities.includes("equipment.write")));
await check("POST","/api/equipment",reader,{code:"E-BLOCKED",name:"Forbidden"},403);
await check("POST","/api/equipment",manager,{code:"E-001",name:"Compressor"},201);
await check("POST","/api/equipment",manager,{code:"E-001",name:"Other"},409);
await check("POST","/api/inspections",manager,{number:"I-ORPHAN",equipmentCode:"E-MISSING",notes:"Invalid"},400);
assert.equal((await check("GET","/api/inspections?limit=10&offset=0",reader,undefined,200)).total,0);
const inspection=await check("POST","/api/inspections",manager,{number:"I-001",equipmentCode:"E-001",notes:"Checked"},201);
assert.equal(inspection.equipmentCode,"E-001");
const equipment=await check("GET","/api/equipment/E-001",reader,undefined,200);
assert.equal(equipment.name,"Compressor");
await check("DELETE","/api/equipment/E-001",manager,undefined,409);
assert.equal((await check("GET","/api/equipment?limit=10&offset=0",reader,undefined,200)).total,1);
assert.equal((await check("GET","/api/inspections?limit=10&offset=0",reader,undefined,200)).total,1);
console.log("A4_FK_CHILD_REFERENCE_AND_PARENT_RESTRICT_PASS");
console.log("A4_INDEPENDENT_PAGINATION_AND_CAPABILITIES_PASS");
