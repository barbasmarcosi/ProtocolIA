import assert from "node:assert/strict";
import test from "node:test";
import {emitJdl,planJhipster} from "../../packages/adapters/jhipster/dist/index.js";

const demo = {
  irVersion:"vnext-a0.1",namespace:"IndependentFixture",
  entities:[{name:"Widget",publicIdentity:"sku",fields:[
    {name:"sku",type:"string",required:true,nullable:false,unique:true,minLength:1,maxLength:64},
    {name:"quantity",type:"int32",required:true,nullable:false,unique:false,min:0},
    {name:"reviewedAt",type:"utcDateTime",required:false,nullable:true,unique:false},
  ]}],
  operations:[{name:"increase",entity:"Widget",method:"PATCH",path:"/api/widgets/{sku}/quantity",
    behavior:{kind:"atomicIncrement",field:"quantity",input:"amount"},capability:"widget.write",
    statuses:[200,400,401,403,404,409]}],
};
test("JDL has constraints and nullable Instant without inventing an id",()=>{
  const jdl=emitJdl(demo);
  assert.match(jdl,/sku String required unique minlength\(1\) maxlength\(64\)/);
  assert.match(jdl,/quantity Integer required min\(0\)/);
  assert.match(jdl,/reviewedAt Instant/);
  assert.doesNotMatch(jdl,/id Integer/);
});
test("capability negotiation must not claim full app support",()=>{
  const decision=planJhipster(demo);
  assert.equal(decision.fullContractSupported,false);
  assert.ok(decision.blockers.some((x)=>x.code==="PUBLIC_IDENTITY_ADAPTER_UNVERIFIED"));
  assert.ok(decision.blockers.some((x)=>x.detail.includes("SQL-atomic")));
});
test("identity must be required and unique before JDL can be emitted",()=>{
  const malformed=structuredClone(demo);
  malformed.entities[0].fields[0].unique=false;
  assert.throws(()=>emitJdl(malformed),/Invalid public identity/);
});
test("unsafe field names cannot become generator identifiers",()=>{
  const malformed=structuredClone(demo);
  malformed.entities[0].fields.push({...malformed.entities[0].fields[1],name:"\n} shell("});
  assert.throws(()=>emitJdl(malformed),/Unsafe JDL identifier/);
});
