import assert from "node:assert/strict";
const root="http://127.0.0.1:8080";
const auth="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
async function perform(method,path,status){
  const response=await fetch(root+path,{method,headers:{Authorization:auth}});
  assert.equal(response.status,status,method+" "+path);
}
await perform("DELETE","/api/inspections/I-UI-001",204);
await perform("DELETE","/api/inspections/I-001",204);
await perform("DELETE","/api/equipment/E-001",204);
await perform("GET","/api/equipment/E-001",404);
console.log("A4_FK_RESTRICT_RECOVERY_AND_DELETIONS_PASS");
