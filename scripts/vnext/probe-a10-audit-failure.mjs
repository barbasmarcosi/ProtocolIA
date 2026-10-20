import assert from "node:assert/strict";
const stage=process.argv[2];
assert.ok(["create","transition"].includes(stage));
const base="http://127.0.0.1:8080",actor="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
async function req(method,path,body){
 const result=await fetch(base+path,{method,headers:{Authorization:actor,
   ...(body===undefined?{}:{"Content-Type":"application/json"})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:result.status,body:await result.text()};
}
const key="/api/work-orders/W-AUDFAIL";
if(stage==="create"){
 const failed=await req("POST","/api/work-orders",{code:"W-AUDFAIL",title:"Audit failure rollback",status:"draft"});
 assert.ok(failed.status>=500,"Audit insertion failure must fail create, got "+JSON.stringify(failed));
 assert.equal((await req("GET",key)).status,404,"Create must be rolled back");
}else{
 const failed=await req("POST",key+"/approve");
 assert.ok(failed.status>=500,"Audit insertion failure must fail transition");
 const data=await req("GET",key);
 assert.equal(data.status,200);
 assert.equal(JSON.parse(data.body).status,"draft","Transition must be rolled back");
}
console.log("A10_"+stage.toUpperCase()+"_AUDIT_FAILURE_ROLLS_BACK_BUSINESS_CHANGE_PASS");
