import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generatePassport,verifyPassport,validateIr} from "../../scripts/research/project-passport.mjs";

function ir(){return {irVersion:"vnext-a0.1",namespace:"KioskDomain",entities:[
 {name:"Product",publicIdentity:"sku",fields:[
  {name:"sku",type:"string",required:true,nullable:false,unique:true},
  {name:"stock",type:"int32",required:true,nullable:false,min:0},
  {name:"status",type:"string",required:true,nullable:false,initial:"active"}]},
 {name:"Sale",publicIdentity:"receipt",fields:[
  {name:"receipt",type:"string",required:true,nullable:false,unique:true},
  {name:"productSku",type:"string",required:true,nullable:false,reference:{target:"Product",onDelete:"restrict"}},
  {name:"amount",type:"decimal",required:true,nullable:false,decimal:{precision:14,scale:2}}]}
],operations:[
 {name:"createSale",entity:"Sale",method:"POST",path:"/api/sales",behavior:{kind:"create"},capability:"sales.write",statuses:[201]},
 {name:"archiveProduct",entity:"Product",method:"PATCH",path:"/api/products/{sku}/archive",behavior:{kind:"transition",from:"active",to:"archived"},capability:"product.write",statuses:[200,409]}
]};}
function fixture(fn){
 const base=mkdtempSync(join(tmpdir(),"protocolia-passport-")),source=join(base,"ir.json"),out=join(base,"passport");
 writeFileSync(source,JSON.stringify(ir()));
 try{return fn({base,source,out});}finally{rmSync(base,{recursive:true,force:true});}
}
test("generates canonical entities, ER diagram, guarded states and operations",()=>fixture(({source,out})=>{
 assert.equal(generatePassport(source,out).status,"GENERATED_NOT_ATTESTED");
 assert.equal(verifyPassport(source,out).status,"PASS_PORTABLE_INTEGRITY_ONLY");
 assert.match(readFileSync(join(out,"docs/architecture/data-model.mmd"),"utf8"),/Product \|\|--o\{ Sale : "productSku"/);
 assert.match(readFileSync(join(out,"docs/architecture/states.mmd"),"utf8"),/Product_active --> Product_archived: archiveProduct/);
 assert.match(readFileSync(join(out,"docs/domain/operations.md"),"utf8"),/sales.write/);
 const trace=JSON.parse(readFileSync(join(out,"docs/traceability.json"),"utf8"));
 assert.equal(trace.requirementMappingProvided,false);
 assert.equal(trace.traceAuthority,"DECLARED_UNVERIFIED");
}));
test("identical sources produce byte-identical Passport lock",()=>fixture(({base,source,out})=>{
 generatePassport(source,out);
 const second=join(base,"second");generatePassport(source,second);
 assert.deepEqual(readFileSync(join(out,"protocolia-passport.lock.json")),readFileSync(join(second,"protocolia-passport.lock.json")));
}));
test("rejects overwrites, manual edits and source drift",()=>fixture(({source,out})=>{
 generatePassport(source,out);
 assert.throws(()=>generatePassport(source,out),/empty/);
 const doc=join(out,"docs/domain/entities.md");writeFileSync(doc,readFileSync(doc,"utf8")+"MANUAL");
 assert.throws(()=>verifyPassport(source,out),/drift/);
}));
test("a changed IR invalidates existing documentation",()=>fixture(({source,out})=>{
 generatePassport(source,out);
 const next=ir();next.entities[0].fields[1].min=1;writeFileSync(source,JSON.stringify(next));
 assert.throws(()=>verifyPassport(source,out),/drift|stale/);
}));
test("explicit requirement mapping remains declared, NEVER test PASS",()=>fixture(({base,source,out})=>{
 const map=join(base,"requirements.json");
 writeFileSync(map,JSON.stringify({schemaVersion:"protocolia-requirements/v1",requirements:[
  {id:"K-01",text:"A sale persists",origin:"explicit_owner",evidenceRefs:["user-brief-1"],operations:["createSale"]}
 ]}));
 generatePassport(source,out,map);
 assert.equal(verifyPassport(source,out,map).status,"PASS_PORTABLE_INTEGRITY_ONLY");
 const trace=JSON.parse(readFileSync(join(out,"docs/traceability.json"),"utf8"));
 assert.equal(trace.requirements[0].verification,"NOT_RUN");
 assert.deepEqual(trace.unmappedOperations,["archiveProduct"]);
}));
test("unknown mapped operation and AI-assumed business behavior fail closed",()=>fixture(({base,source,out})=>{
 const map=join(base,"requirements.json");
 const x={schemaVersion:"protocolia-requirements/v1",requirements:[
  {id:"K-01",text:"Discount",origin:"explicit_owner",evidenceRefs:["user-1"],operations:["unknown"]}
 ]};
 writeFileSync(map,JSON.stringify(x));assert.throws(()=>generatePassport(source,out,map),/unknown mapped operation/);
 x.requirements[0].operations=["createSale"];x.requirements[0].origin="agent_assumption";
 writeFileSync(map,JSON.stringify(x));assert.throws(()=>generatePassport(source,out,map),/AI assumption cannot/);
}));
test("rejects malicious entity names and broken references before writing",()=>fixture(({source,out})=>{
 const bad=ir();bad.entities[0].name="Product --> Evil";writeFileSync(source,JSON.stringify(bad));
 assert.throws(()=>generatePassport(source,out),/unsafe entity/);
 bad.entities[0].name="Product";bad.entities[1].fields[1].reference.target="Unknown";
 writeFileSync(source,JSON.stringify(bad));assert.throws(()=>generatePassport(source,out),/unresolved FK/);
}));
test("rejects unsupported semantic values rather than guessing",()=>{
 const bad=ir();bad.entities[0].fields[1].type="any";assert.throws(()=>validateIr(bad),/unsupported field/);
 bad.entities[0].fields[1].type="int32";bad.entities[0].publicIdentity="missing";
 assert.throws(()=>validateIr(bad),/missing public identity/);
});

test("Passport renders unresolved questions with declared provenance, never invents rationale",()=>fixture(({base,source,out})=>{
 const path=join(base,"decisions.json");
 const decisions={schemaVersion:"protocolia-decision-ledger/v0.1",authority:"SELF_DECLARED_UNVERIFIED",
  sourceSha256:"a".repeat(64),decisions:[
   {id:"K-Q01",question:"What refund policy applies?",classification:"material_business",
    state:"unresolved",affectsSupported:false,origin:"agent_assumption",evidenceRefs:[]},
   {id:"K-Q02",question:"Which mobile layout?",classification:"reversible_technical",
    state:"provisional",affectsSupported:false,origin:"agent_assumption",
    evidenceRefs:[],decision:"Compact cards for first candidate"}
  ]};
 writeFileSync(path,JSON.stringify(decisions));
 generatePassport(source,out,undefined,path);
 assert.equal(verifyPassport(source,out,undefined,path).status,"PASS_PORTABLE_INTEGRITY_ONLY");
 const doc=readFileSync(join(out,"docs/domain/decisions.md"),"utf8");
 assert.match(doc,/What refund policy applies/);
 assert.match(doc,/UNKNOWN \/ unresolved/);
 assert.match(doc,/Compact cards for first candidate/);
 assert.match(doc,/NOT authenticated owner intent/);
 decisions.decisions[0].question="Was it changed?";
 writeFileSync(path,JSON.stringify(decisions));
 assert.throws(()=>verifyPassport(source,out,undefined,path),/drift|stale/);
}));
test("Passport cannot bless fabricated owner approval for agent assumptions",()=>fixture(({base,source,out})=>{
 const path=join(base,"decisions.json");
 const d={schemaVersion:"protocolia-decision-ledger/v0.1",authority:"SELF_DECLARED_UNVERIFIED",
  sourceSha256:"b".repeat(64),decisions:[
    {id:"K-Q01",question:"Allow real refunds?",classification:"external_effect",state:"resolved",
     affectsSupported:true,origin:"agent_assumption",evidenceRefs:[],decision:"Yes"}
  ]};
 writeFileSync(path,JSON.stringify(d));
 assert.throws(()=>generatePassport(source,out,undefined,path),/resolved decision lacks declared evidence/);
}));
