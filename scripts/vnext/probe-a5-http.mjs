import assert from "node:assert/strict";
const phase=process.argv[2]??"";
assert.ok(["seed","verify"].includes(phase),"Usage: probe-a5-http.mjs <seed|verify>");
const base="http://127.0.0.1:8080";
const manager="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
const reader="Basic "+Buffer.from("reader:test-reader-only-2026").toString("base64");
async function req(method,path,identity,body){
  const response=await fetch(base+path,{method,headers:{
    Authorization:identity??manager,...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  let parsed;
  try {parsed=await response.json();} catch {parsed=null;}
  return {status:response.status,data:parsed};
}
async function check(method,path,identity,body,status){
  const answer=await req(method,path,identity,body);
  assert.equal(answer.status,status,method+" "+path+" "+JSON.stringify(answer.data));
  return answer.data;
}
if(phase==="seed"){
  await check("POST","/api/equipment",manager,{code:"E-A5-001",name:"Asset before regeneration"},201);
  await check("POST","/api/inspections",manager,{
    number:"I-A5-001",equipmentCode:"E-A5-001",notes:"Created with V1"
  },201);
  const record=await check("GET","/api/inspections/I-A5-001",reader,undefined,200);
  assert.equal(record.equipmentCode,"E-A5-001");
  assert.equal(Object.hasOwn(record,"checkedAt"),false);
  console.log("A5_BASELINE_DATA_SEEDED_AND_READ_PASS");
}else{
  const old=await check("GET","/api/inspections/I-A5-001",reader,undefined,200);
  assert.equal(old.number,"I-A5-001");
  assert.equal(old.notes,"Created with V1");
  assert.equal(old.equipmentCode,"E-A5-001");
  assert.equal(old.checkedAt,null);
  const parent=await check("GET","/api/equipment/E-A5-001",reader,undefined,200);
  assert.equal(parent.name,"Asset before regeneration");
  const newRow=await check("POST","/api/inspections",manager,{
    number:"I-A5-002",equipmentCode:"E-A5-001",
    notes:"Generated V2 field",checkedAt:"2026-10-13T11:00:00+02:00"
  },201);
  assert.equal(Date.parse(newRow.checkedAt),Date.parse("2026-10-13T09:00:00Z"));
  assert.equal((await check("GET","/api/inspections/I-A5-002",reader,undefined,200)).equipmentCode,"E-A5-001");
  await check("DELETE","/api/equipment/E-A5-001",manager,undefined,409);
  await check("POST","/api/inspections",reader,{
    number:"I-FORBIDDEN",equipmentCode:"E-A5-001",notes:"Forbidden"
  },403);
  const listings=await check("GET","/api/inspections?limit=20&offset=0",reader,undefined,200);
  assert.equal(listings.total,2);
  assert.deepEqual(listings.items.map(x=>x.number).sort(),["I-A5-001","I-A5-002"]);
  console.log("A5_V1_ROWS_PRESERVED_V2_TIMESTAMP_FK_ROLES_PASS");
}
