import test from "node:test";
import assert from "node:assert/strict";
import {compileRelatedSums} from "../../packages/adapters/related-sum.mjs";

const field=(name,type,extra={})=>({name,type,required:true,nullable:false,unique:false,...extra});
function sample(){
  const entities=[
    {name:"Part",publicIdentity:"sku",fields:[
      field("sku","string",{unique:true,minLength:1,maxLength:40}),
      field("available","int32",{min:0})]},
    {name:"Allocation",publicIdentity:"number",fields:[
      field("number","string",{unique:true,minLength:1,maxLength:40}),
      field("partSku","string",{reference:{target:"Part",onDelete:"restrict"},maxLength:40}),
      field("units","int32",{min:1,max:1000}),
      field("status","string",{initial:"active",minLength:1,maxLength:20})]}
  ];
  const op=(name,entity,kind,method,path,capability,extra={})=>({
    name,entity,method,path,capability,
    statuses:kind==="create"?[201,400,409]:kind==="sumRelated"?[200,401,403,404]:[200,404],
    behavior:{kind,...extra}
  });
  const reserve={stockEntity:"Part",availableField:"available",referenceField:"partSku",quantityField:"units"};
  const operations=[
    op("createPart","Part","create","POST","/api/parts","parts.write"),
    op("getPart","Part","get","GET","/api/parts/{sku}","parts.read"),
    op("createAllocation","Allocation","create","POST","/api/allocations","allocations.write",{reserve}),
    op("getAllocation","Allocation","get","GET","/api/allocations/{number}","allocations.read"),
    op("cancelAllocation","Allocation","transition","POST","/api/allocations/{number}/cancel",
      "allocations.write",{field:"status",from:"active",to:"cancelled",release:reserve}),
    op("activeAllocationSum","Part","sumRelated","GET",
      "/api/parts/{sku}/allocation-summary","parts.read",{
        relatedSum:{childEntity:"Allocation",referenceField:"partSku",
          quantityField:"units",stateField:"status",activeState:"active"}
      })
  ];
  return {irVersion:"vnext-a0.1",namespace:"Inventory",entities,operations};
}
test("compiled relation SUM uses a single safe PostgreSQL snapshot and child read permission",()=>{
  const compiled=compileRelatedSums(sample());
  assert.equal(compiled.size,1);
  const q=compiled.get("activeAllocationSum");
  assert.equal(q.childReadCapability,"allocations.read");
  assert.match(q.sqlNest,/LEFT JOIN allocation c ON c.part_sku=p.sku AND c.status='active'/);
  assert.match(q.sqlNest,/COALESCE\(SUM\(c.units::bigint\),0\)::text AS "totalUnits"/);
  assert.match(q.sqlNest,/WHERE p.sku=\$1 GROUP BY p.sku/);
  assert.match(q.sqlSpring,/WHERE p.sku=:identity GROUP BY p.sku/);
  assert.ok(!q.sqlNest.includes("RACE"),"No literal runtime key must enter SQL");
});
test("reject untrusted IR, invalid lifecycle, FK and authorization",()=>{
  const mutations=[
    ir=>{ir.operations.at(-1).behavior.relatedSum.childEntity="Allocation;drop table part";},
    ir=>{ir.operations.at(-1).behavior.relatedSum.quantityField="partSku";},
    ir=>{ir.operations.at(-1).behavior.relatedSum.stateField="unknown";},
    ir=>{ir.operations.at(-1).behavior.relatedSum.activeState="cancelled";},
    ir=>{ir.operations.at(-1).behavior.relatedSum.activeState="active' OR TRUE";},
    ir=>{ir.operations.at(-1).behavior.relatedSum.referenceField="number";},
    ir=>{ir.entities[1].fields[2].min=0;},
    ir=>{ir.entities[1].fields[1].reference=undefined;},
    ir=>{ir.operations=ir.operations.filter(x=>x.name!=="cancelAllocation");},
    ir=>{ir.operations=ir.operations.filter(x=>x.name!=="createAllocation");},
    ir=>{ir.operations.at(-1).capability="allocations.read";},
    ir=>{ir.operations.find(x=>x.name==="getAllocation").capability="public";},
    ir=>{ir.operations.at(-1).method="POST";},
    ir=>{ir.operations.at(-1).statuses=[200];}
  ];
  for(const mutate of mutations){
    const contract=sample();mutate(contract);
    assert.throws(()=>compileRelatedSums(contract),/Invalid authorized related reservation sum/);
  }
});
