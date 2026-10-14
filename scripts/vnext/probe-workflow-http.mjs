import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const manager="Basic "+Buffer.from("manager:test-manager-only-2026").toString("base64");
const reader="Basic "+Buffer.from("reader:test-reader-only-2026").toString("base64");
async function call(method,path,token,body){
  const r=await fetch(base+path,{method,headers:{
    ...(token?{Authorization:token}:{}),
    ...(body===undefined?{}:{"Content-Type":"application/json"})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=r.status===204?null:await r.json();
  return {status:r.status,data};
}
const expect=async (status,method,path,token,body)=>{
  const r=await call(method,path,token,body);
  assert.equal(r.status,status,method+" "+path+" "+JSON.stringify(r.data));
  return r.data;
};
const url="/api/work-orders",id=url+"/W-001";
await expect(401,"GET",url+"?limit=25&offset=0");
await expect(403,"POST",url,reader,{code:"W-DENY",title:"reader cannot create",status:"draft"});
await expect(400,"POST",url,manager,{code:"W-BAD",title:"Illegal direct approval",status:"approved"});
await expect(400,"POST",url,manager,{code:"W-BAD-2",title:"Unknown status",status:"rogue"});
const created=await expect(201,"POST",url,manager,{code:"W-001",title:"Inspect machine",status:"draft"});
assert.equal(created.status,"draft");
await expect(409,"POST",url,manager,{code:"W-001",title:"Duplicate",status:"draft"});
await expect(400,"POST",id+"/approve",manager,{unexpected:"secret"});
await expect(403,"POST",id+"/approve",reader);
await expect(404,"POST",url+"/W-MISSING/approve",manager);
await expect(409,"POST",id+"/close",manager);
const concurrent=await Promise.all(Array.from({length:10},()=>call("POST",id+"/approve",manager)));
assert.equal(concurrent.filter(x=>x.status===200).length,1);
assert.equal(concurrent.filter(x=>x.status===409).length,9);
assert.equal((await expect(200,"GET",id,reader)).status,"approved");
await expect(409,"POST",id+"/approve",manager);
assert.equal((await expect(200,"POST",id+"/close",manager)).status,"closed");
await expect(409,"POST",id+"/close",manager);
assert.equal((await expect(200,"GET",id,reader)).status,"closed");
const page=await expect(200,"GET",url+"?limit=25&offset=0",reader);
assert.equal(page.total,1);
assert.equal(page.items[0].status,"closed");
console.log("A6_WORKFLOW_HTTP_CONCURRENCY_INITIAL_AUTH_404_409_PASS");
