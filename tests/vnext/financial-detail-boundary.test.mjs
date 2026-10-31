import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assertCreateDetails} from "../../packages/adapters/create-details.mjs";

// S2b-0 is an executable *negative* boundary, not itemized charge support.
const parent={
  name:"PurchaseOrder",publicIdentity:"code",fields:[
    {name:"code",type:"string",required:true,nullable:false},
    {name:"title",type:"string",required:true,nullable:false}
  ]
};
const child={
  name:"OrderLine",publicIdentity:"lineCode",fields:[
    {name:"lineCode",type:"string",required:true,nullable:false},
    {name:"orderCode",type:"string",required:true,nullable:false,
      reference:{target:"PurchaseOrder",onDelete:"restrict"}},
    {name:"product",type:"string",required:true,nullable:false},
    {name:"units",type:"int32",required:true,nullable:false,min:1,max:100}
  ]
};
const create={
  name:"createPurchaseOrder",entity:"PurchaseOrder",method:"POST",
  statuses:[201,400,401,403,409],capability:"orders.write",
  behavior:{kind:"create",createDetails:{
    childEntity:"OrderLine",parentField:"orderCode",rowsField:"lines",maxRows:20
  }}
};
const ir={
  entities:[parent,child],
  operations:[create,{name:"createOrderLine",entity:"OrderLine",
    method:"POST",capability:"lines.write",behavior:{kind:"create"}}]
};

test("S2b-0 leaves ordinary transactional header/details intact",()=>{
  const plan=assertCreateDetails(ir,parent,create);
  assert.equal(plan.maxRows,20);
  assert.equal(plan.rowsField,"lines");
  assert.equal(plan.childWriteCapability,"lines.write");
});

for(const [label,extra] of [
  ["declared exact reconciliation",{entity:"PurchaseOrder",behavior:{kind:"reconcileExact",reconcileExact:{openingField:"openingBalance"}}}],
  ["exact receipt debit without reconciliation",{entity:"Payment",behavior:{kind:"create",debitExact:{stockEntity:"PurchaseOrder"}}}],
  ["exact reversal without reconciliation",{entity:"Payment",behavior:{kind:"transition",reverseExact:{stockEntity:"PurchaseOrder"}}}]
]){
  test("S2b-0 rejects unsafe header/details plus "+label,()=>{
    const unsafe={...ir,operations:[...ir.operations,{...extra,name:"unsafeFinancialOperation"}]};
    assert.throws(()=>assertCreateDetails(unsafe,parent,create),
      /Unsafe bounded relational header\/detail contract/);
  });
}

test("S2b-0 does not block unrelated exact ledger parents",()=>{
  const unrelated={...ir,operations:[...ir.operations,{
    name:"unrelatedPayment",entity:"Payment",
    behavior:{kind:"create",debitExact:{stockEntity:"OtherLedger"}}
  }]};
  assert.equal(assertCreateDetails(unrelated,parent,create).maxRows,20);
});

test("both generated targets enforce the same preflight",()=>{
  for(const name of ["nest","modular"]){
    const generator=readFileSync("packages/adapters/"+name+"/generate.mjs","utf8");
    assert.match(generator,/import \{assertCreateDetails\} from "\.\.\/create-details\.mjs"/);
    assert.match(generator,/if\((?:b|op\.behavior)\.createDetails\)assertCreateDetails\(ir,/);
  }
});
