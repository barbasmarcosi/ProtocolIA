import assert from "node:assert/strict";
const base="http://127.0.0.1:8080";
const auth=(name,password)=>"Basic "+Buffer.from(name+":"+password).toString("base64");
const manager={"authorization":auth("manager","test-manager-only-2026"),"content-type":"application/json"};
const reader={"authorization":auth("reader","test-reader-only-2026"),"content-type":"application/json"};
async function call(method,path,headers={},body) {
  const response=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const raw=await response.text();
  let data;try{data=JSON.parse(raw);}catch{data=raw;}
  return {status:response.status,data};
}
const code="A0-MODULAR-001";
const invalid=await call("POST","/api/tools",manager,{code:"",name:"Blank",quantity:2});
assert.equal(invalid.status,400);
const created=await call("POST","/api/tools",manager,{code,name:"Measured drill",quantity:2,lastReviewedAt:null});
console.log("A0_MODULAR_CREATE_STATUS="+created.status);
assert.equal(created.status,201);
assert.equal(created.data.code,code);
assert.equal(Object.hasOwn(created.data,"id"),false);
const get=await call("GET","/api/tools/"+code,reader);
assert.equal(get.status,200);
assert.equal(get.data.quantity,2);
console.log("A0_MODULAR_PUBLIC_CODE_GET_STATUS="+get.status);
const missing=await call("GET","/api/tools/NO-SUCH-TOOL",manager);
assert.equal(missing.status,404);
const duplicate=await call("POST","/api/tools",manager,{code,name:"Duplicate",quantity:70});
assert.equal(duplicate.status,409);
const unknown=await call("POST","/api/tools",manager,{code:"A0-UNEXPECTED",name:"X",quantity:2,unexpected:true});
assert.equal(unknown.status,400);
const negative=await call("POST","/api/tools",manager,{code:"A0-NEGATIVE",name:"X",quantity:-1});
assert.equal(negative.status,400);
const anonymous=await call("GET","/api/tools/"+code);
assert.equal(anonymous.status,401);
const readDenied=await call("POST","/api/tools",reader,{code:"A0-READ-DENIED",name:"No write",quantity:1});
assert.equal(readDenied.status,403);
const page=await call("GET","/api/tools?limit=1&offset=0",reader);
assert.equal(page.status,200);
assert.deepEqual(Object.keys(page.data).sort(),["items","limit","offset","total"]);
assert.equal(page.data.total,1);
assert.equal(page.data.items[0].code,code);
const rename=await call("PATCH","/api/tools/"+code+"/name",manager,{name:"Renamed drill"});
assert.equal(rename.status,200);
assert.equal(rename.data.name,"Renamed drill");
assert.equal(rename.data.quantity,2);
const increase=await call("PATCH","/api/tools/"+code+"/quantity",manager,{amount:3});
assert.equal(increase.status,200);
assert.equal(increase.data.quantity,5);
const concurrent=await Promise.all(Array.from({length:10},()=>
  call("PATCH","/api/tools/"+code+"/quantity",manager,{amount:1})));
assert.ok(concurrent.every(r=>r.status===200),"Every concurrent increment must commit");
const final=await call("GET","/api/tools/"+code,manager);
console.log("A0_MODULAR_CONCURRENT_FINAL_QUANTITY="+final.data.quantity);
assert.equal(final.data.quantity,15);
const amountZero=await call("PATCH","/api/tools/"+code+"/quantity",manager,{amount:0});
assert.equal(amountZero.status,400);
const badDate=await call("POST","/api/tools",manager,{code:"A0-BAD-DATE",name:"X",quantity:0,lastReviewedAt:"broken"});
assert.equal(badDate.status,400);

const readonlyPatch=await call("PATCH","/api/tools/"+code+"/quantity",reader,{amount:1});
assert.equal(readonlyPatch.status,403);
const malformedPage=await call("GET","/api/tools?limit=0&offset=0",manager);
assert.equal(malformedPage.status,400);
const unknownQuery=await call("GET","/api/tools?limit=1&extra=1",manager);
assert.equal(unknownQuery.status,400);
const unknownPatch=await call("PATCH","/api/tools/"+code+"/name",manager,{name:"Unexpected",extra:true});
assert.equal(unknownPatch.status,400);
const overflowCode="A0-MODULAR-MAX";
const maximum=await call("POST","/api/tools",manager,{code:overflowCode,name:"Overflow control",quantity:2147483647});
assert.equal(maximum.status,201);
const overflow=await call("PATCH","/api/tools/"+overflowCode+"/quantity",manager,{amount:1});
console.log("A0_MODULAR_ATOMIC_OVERFLOW_STATUS="+overflow.status);
assert.equal(overflow.status,409);
const postOverflow=await call("GET","/api/tools/"+overflowCode,manager);
assert.equal(postOverflow.data.quantity,2147483647);
const dateCode="A0-MODULAR-DATE";
const withDate=await call("POST","/api/tools",manager,{
 code:dateCode,name:"Date check",quantity:0,lastReviewedAt:"2026-10-13T12:00:00+02:00",
});
console.log("A0_MODULAR_DATE_ROUNDTRIP_CREATE_STATUS="+withDate.status);
assert.equal(withDate.status,201);
const readDate=await call("GET","/api/tools/"+dateCode,manager);
assert.equal(readDate.status,200);
assert.equal(Date.parse(readDate.data.lastReviewedAt),Date.parse("2026-10-13T10:00:00Z"));
const omitted=await call("POST","/api/tools",manager,{code:"A0-MODULAR-OPTIONAL",name:"No date",quantity:0});
assert.equal(omitted.status,201);
assert.equal(omitted.data.lastReviewedAt,null);

console.log("A0_MODULAR_HTTP_POSTGRES_AUTH_CONCURRENCY_PASS");
