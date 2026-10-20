import test from "node:test";
import assert from "node:assert/strict";
import {diffContracts,additiveSql,validateOpenApiEvolution} from "../../packages/cli/regeneration.mjs";
const reserve={stockEntity:"Part",availableField:"available",referenceField:"partSku",quantityField:"units"};
const part={name:"Part",publicIdentity:"sku",fields:[
  {name:"sku",type:"string",required:true,nullable:false,unique:true,maxLength:40},
  {name:"available",type:"int32",required:true,nullable:false,unique:false,min:0}
]};
const allocation={name:"Allocation",publicIdentity:"number",fields:[
  {name:"number",type:"string",required:true,nullable:false,unique:true,maxLength:40},
  {name:"partSku",type:"string",required:true,nullable:false,unique:false,maxLength:40,
    reference:{target:"Part",onDelete:"restrict"}},
  {name:"units",type:"int32",required:true,nullable:false,unique:false,min:1,max:1000}
]};
const op=(name,entity,kind,path,capability,request,behavior)=>({
 name,entity,method:"POST",path,capability,request,statuses:[201,400,409],
 behavior:behavior??{kind}
});
const old={
 irVersion:"vnext-a0.1",namespace:"InventoryReservations",
 entities:[part,allocation],
 operations:[
  op("createPart","Part","create","/api/parts","parts.write","PartRequest"),
  op("createAllocation","Allocation","create","/api/allocations",
    "allocations.write","AllocationRequest",{kind:"create",reserve})
 ]
};
const next=structuredClone(old);
next.entities[1].fields.push({name:"status",type:"string",required:true,nullable:false,
 unique:false,minLength:1,maxLength:20,initial:"active"});
next.operations.push({name:"cancelAllocation",entity:"Allocation",method:"POST",
 path:"/api/allocations/{number}/cancel",capability:"allocations.write",
 statuses:[200,400,404,409],
 behavior:{kind:"transition",field:"status",from:"active",to:"cancelled",release:reserve}});
const prop={type:"string",minLength:1,maxLength:20};
const oldApi={openapi:"3.1.0",paths:{"/api/allocations":{post:{operationId:"createAllocation"}}},
 components:{schemas:{
   Allocation:{type:"object",required:["number","partSku","units"],properties:{
     number:{type:"string"},partSku:{type:"string"},units:{type:"integer"}}},
   AllocationRequest:{type:"object",required:["number","partSku","units"],properties:{
     number:{type:"string"},partSku:{type:"string"},units:{type:"integer"}}}
 }}};
const nextApi=structuredClone(oldApi);
nextApi.components.schemas.Allocation.required.push("status");
nextApi.components.schemas.Allocation.properties.status=structuredClone(prop);
nextApi.components.schemas.AllocationRequest.properties.status=structuredClone(prop);
nextApi.paths["/api/allocations/{number}/cancel"]={post:{operationId:"cancelAllocation"}};

test("A9 allows a proven one-time state backfill + new cancellation route without rewriting old operations",()=>{
 const plan=diffContracts(old,next);
 assert.equal(plan.compatible,true,JSON.stringify(plan.blockers));
 assert.deepEqual(plan.changes.map(c=>c.kind),["addInitialState","addOperation"]);
 assert.equal(additiveSql(plan),
   "ALTER TABLE allocation ADD COLUMN status VARCHAR(20) CHECK (char_length(status) >= 1) DEFAULT 'active' NOT NULL CHECK (status IN ('active','cancelled'));");
 assert.deepEqual(validateOpenApiEvolution(oldApi,nextApi,old,next,plan),[]);
});
test("A9 blocks unsafe state migrations and subtle OpenAPI changes",()=>{
 const invalid=[
   x=>{x.entities[1].fields[3].initial="cancelled";},
   x=>{x.operations[2].behavior.release.quantityField="wrong";},
   x=>{x.operations[2].capability="public";},
   x=>{x.operations[2].behavior.from="cancelled";},
   x=>{x.operations[2].behavior.to="ACTIVE";},
   x=>{x.operations[1].capability="public";},
   x=>{x.entities[1].fields[3].required=false;},
   x=>{x.entities[1].fields[3].initial=undefined;},
   x=>{x.operations[2].behavior.release.stockEntity="Other";},
   x=>{x.operations[2].method="DELETE";},
   x=>{x.entities[1].fields[0].maxLength=38;}
 ];
 for(const corrupt of invalid){
   const copy=structuredClone(next);corrupt(copy);
   const plan=diffContracts(old,copy);
   assert.equal(plan.compatible,false,JSON.stringify(plan));
   assert.throws(()=>additiveSql(plan));
 }
 const requiredRequest=structuredClone(nextApi);
 requiredRequest.components.schemas.AllocationRequest.required.push("status");
 assert.match(validateOpenApiEvolution(oldApi,requiredRequest,old,next,diffContracts(old,next)).join(";"),
    /Unsafe initial-state/);
 const unrelated=structuredClone(nextApi);
 unrelated.components.schemas.Allocation.properties.units.maxLength=200;
 assert.match(validateOpenApiEvolution(oldApi,unrelated,old,next,diffContracts(old,next)).join(";"),
    /Undeclared OpenAPI/);
});
