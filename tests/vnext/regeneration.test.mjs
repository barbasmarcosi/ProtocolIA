import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {diffContracts,additiveSql,validateOpenApiEvolution} from "../../packages/cli/regeneration.mjs";
import {sealApp,verifyApp} from "../../packages/cli/ownership.mjs";

const base={
  irVersion:"vnext-a0.1",namespace:"Acme",
  entities:[
    {name:"Equipment",publicIdentity:"code",view:"Equipment",fields:[
      {name:"code",type:"string",required:true,nullable:false,unique:true,maxLength:40},
      {name:"name",type:"string",required:true,nullable:false,unique:false,maxLength:80}
    ]},
    {name:"Inspection",publicIdentity:"number",fields:[
      {name:"number",type:"string",required:true,nullable:false,unique:true,maxLength:40},
      {name:"equipmentCode",type:"string",required:true,nullable:false,unique:false,maxLength:40,
        reference:{target:"Equipment",onDelete:"restrict"}}
    ]}
  ],
  operations:[
    {name:"getEquipment",entity:"Equipment",capability:"equipment.read",method:"GET",
      path:"/api/equipment/{code}",behavior:{kind:"get"},statuses:[200]}
  ]
};
const change=fn=>{const current=structuredClone(base);fn(current);return current;};
test("A5 accepts label/order/nullable optional addition without dropping columns",()=>{
  const evolved=change(ir=>{
    ir.entities[0].view="Revised Equipment";
    ir.entities[1].fields.unshift({name:"checkedAt",type:"utcDateTime",required:false,nullable:true,unique:false});
  });
  const plan=diffContracts(base,evolved);
  assert.equal(plan.compatible,true);
  assert.equal(plan.changes.length,2);
  assert.equal(additiveSql(plan),"ALTER TABLE inspection ADD COLUMN checked_at TIMESTAMP WITH TIME ZONE;");
});
test("A5 rejects changing public identity, field type, permissions, deletion and required addition",()=>{
  const mutations=[
    ir=>{ir.entities[0].publicIdentity="name";},
    ir=>{ir.entities[0].fields[1].type="int32";},
    ir=>{ir.operations[0].capability="public";},
    ir=>{ir.entities[0].fields.pop();},
    ir=>{ir.entities[0].fields.push({name:"new",type:"string",required:true,nullable:false});},
    ir=>{ir.entities[0].fields.push({name:"new",type:"string",required:false,nullable:false});},
    ir=>{ir.entities[0].fields.push({name:"new",type:"string",required:false,nullable:true,unique:true});},
    ir=>{ir.entities.pop();}
  ];
  for(const mutate of mutations){
    const plan=diffContracts(base,change(mutate));
    assert.equal(plan.compatible,false,JSON.stringify(plan));
    assert.throws(()=>additiveSql(plan),/Refusing destructive migration/);
  }
});
test("A5 allows additive integer and string columns with contract constraints",()=>{
  const next=change(ir=>ir.entities[0].fields.push({
    name:"count",type:"int32",required:false,nullable:true,unique:false,min:0
  },{name:"description",type:"string",required:false,nullable:true,unique:false,maxLength:90}));
  assert.match(additiveSql(diffContracts(base,next)),/ALTER TABLE equipment ADD COLUMN count INTEGER CHECK \(count>=0\)/);
  assert.match(additiveSql(diffContracts(base,next)),/description VARCHAR\(90\)/);
});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"protocolia-a5-unit-"));
  for(const path of ["src/main/java/dev","src/main/resources","web/src","extensions"]){
    mkdirSync(join(root,path),{recursive:true});
  }
  writeFileSync(join(root,"src/main/java/dev/Generated.java"),"public final class Generated {}");
  writeFileSync(join(root,"src/main/resources/application.properties"),"app=ok\n");
  writeFileSync(join(root,"web/src/App.jsx"),"export default function App(){}");
  writeFileSync(join(root,"protocolia-contract-ir.json"),JSON.stringify(base));
  writeFileSync(join(root,"protocolia-contract-openapi.json"),JSON.stringify({openapi:"3.1.0",components:{schemas:{}}}));
  writeFileSync(join(root,"protocolia-build.json"),JSON.stringify({builder:"protocolia-cli-vnext-a2"}));
  writeFileSync(join(root,"extensions/consumer.txt"),"keep me");
  return root;
}
test("A5 checksum seal permits independent consumer extensions and catches generated edits",()=>{
  const root=fixture();
  sealApp(root);verifyApp(root);
  writeFileSync(join(root,"extensions/consumer.txt"),"keep me unchanged");
  verifyApp(root);
  writeFileSync(join(root,"web/src/App.jsx"),"modified generated UI");
  assert.throws(()=>verifyApp(root),/Managed files modified/);
});
test("A5 ownership detects new foreign source file in managed tree",()=>{
  const root=fixture();
  sealApp(root);
  writeFileSync(join(root,"src/main/java/dev/Injected.java"),"class Injected{}");
  assert.throws(()=>verifyApp(root),/Managed files modified/);
});
test("A5 missing seal fails closed rather than assuming a legacy output is safe",()=>{
  assert.throws(()=>verifyApp(fixture()),/Unsealed output/);
});

test("A5 rejects hidden HTTP DTO/validation drift even when IR is unchanged",()=>{
  const oldIr=change(ir=>ir.operations.push({
    name:"createInspection",entity:"Inspection",capability:"inspections.write",
    method:"POST",path:"/api/inspections",behavior:{kind:"create"},request:"InspectionRequest",statuses:[201]
  }));
  const newIr=structuredClone(oldIr);
  newIr.entities[1].fields.push({name:"checkedAt",type:"utcDateTime",required:false,nullable:true,unique:false});
  const property={type:["string","null"],format:"date-time"};
  const oldApi={openapi:"3.1.0",info:{title:"X",version:"1"},
    components:{schemas:{
      Inspection:{type:"object",properties:{number:{type:"string"}}},
      InspectionRequest:{type:"object",properties:{number:{type:"string"}}}
    }},paths:{}};
  const nextApi=structuredClone(oldApi);
  nextApi.components.schemas.Inspection.properties.checkedAt=structuredClone(property);
  nextApi.components.schemas.InspectionRequest.properties.checkedAt=structuredClone(property);
  const diff=diffContracts(oldIr,newIr);
  assert.equal(diff.compatible,true);
  assert.deepEqual(validateOpenApiEvolution(oldApi,nextApi,oldIr,newIr,diff),[]);
  const unsafe=structuredClone(nextApi);
  unsafe.components.schemas.InspectionRequest.properties.checkedAt.maxLength=20;
  assert.match(validateOpenApiEvolution(oldApi,unsafe,oldIr,newIr,diff).join(";"),
    /does not match entity and create-request/);
  const invisible=structuredClone(oldApi);
  invisible.components.schemas.InspectionRequest.properties.number.maxLength=19;
  assert.match(validateOpenApiEvolution(oldApi,invisible,oldIr,oldIr,diffContracts(oldIr,oldIr)).join(";"),
    /Undeclared OpenAPI/);
});
