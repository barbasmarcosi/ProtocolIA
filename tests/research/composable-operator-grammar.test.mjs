import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {composeOperatorGraph,validateOperatorGraph,emitOperatorTypeSpec}
 from "../../scripts/research/composable-operator-grammar.mjs";
import {compileOperators} from "../../scripts/research/composable-operator-intake.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const original=join(root,"research/autonomous-engineering/samples/composable-equipment-allocation.json");
const parse=f=>JSON.parse(readFileSync(f,"utf8"));
function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),"composable-ops-")),source=join(dir,"source.json"),out=join(dir,"out");
 writeFileSync(source,readFileSync(original));
 try{return fn({dir,source,out,update:value=>writeFileSync(source,JSON.stringify(value,null,2)+"\n")});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
test("reserve + two terminal transitions assemble into a source-bounded graph",()=>{
 const ir=composeOperatorGraph(parse(original));
 assert.equal(validateOperatorGraph(ir),ir);
 assert.deepEqual(ir.entities.map(e=>e.name),["EquipmentPool","EquipmentClaim"]);
 assert.equal(ir.operations.length,9);
 assert.deepEqual(ir.operations.filter(x=>x.kind==="transition").map(x=>({name:x.name,release:!!x.release})),[
  {name:"approveEquipmentClaim",release:false},
  {name:"rejectEquipmentClaim",release:true}]);
 const generated=emitOperatorTypeSpec(ir);
 for(const code of [
  '@reserve("EquipmentPool", "available", "poolCode", "units")',
  '@transition("pending", "approved")',
  '@transition("pending", "rejected")',
  '@release("EquipmentPool", "available", "poolCode", "units")',
  '@audit("state")','@capability("equipmentclaim.write")','@reference("EquipmentPool", "restrict")'
 ])assert.ok(generated.includes(code),code);
 assert.equal((generated.match(/@release/g)||[]).length,1);
 assert.doesNotMatch(generated,/@payment|@delete|@charge|@moveUnits/);
});
test("generator creates a reproducible independent project, ledger and typed graph",()=>fixture(x=>{
 const created=compileOperators(x.source,x.out);
 assert.equal(created.files,7);
 assert.equal(compileOperators(x.source,x.out,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
 const ir=parse(join(x.out,"semantic-ir.json"));
 assert.equal(emitOperatorTypeSpec(ir),readFileSync(join(x.out,"contracts/main.tsp"),"utf8"));
 const decisions=parse(join(x.out,"decisions.json"));
 assert.equal(decisions.authority,"SELF_DECLARED_UNVERIFIED");
 assert.ok(decisions.decisions.every(d=>d.state==="unresolved"));
 const report=parse(join(x.out,"protocolia-intake-report.json"));
 assert.equal(report.status,"PARTIAL_DRAFT_UNVERIFIED");
 assert.deepEqual(report.operatorKinds,["reserve","transition","release"]);
}));
test("same operator grammar handles independently named resources and a three-stage decision",()=>{
 const s=structuredClone(parse(original));
 s.namespace="RentalLab";s.title="Rental availability and supervisor decision";
 s.entities[0]={name:"RentalAssets",route:"rental-assets",identity:{name:"assetCode",maxLength:55},
  label:{name:"assetName",maxLength:160},capacity:{name:"freeUnits",max:200}};
 s.entities[1]={name:"RentalRequest",route:"rental-requests",identity:{name:"requestCode",maxLength:55},
  reference:{name:"assetCode",target:"RentalAssets"},quantity:{name:"requested",max:12},
  status:{name:"phase",initial:"requested"}};
 s.operators=[
  {kind:"reserve",journal:"RentalRequest",parent:"RentalAssets"},
  {kind:"transition",name:"reviewRentalRequest",suffix:"review",from:"requested",to:"under_review",release:false},
  {kind:"transition",name:"grantRentalRequest",suffix:"grant",from:"under_review",to:"granted",release:false},
  {kind:"transition",name:"denyRentalRequest",suffix:"deny",from:"under_review",to:"denied",release:true}
 ];
 const ir=composeOperatorGraph(s),code=emitOperatorTypeSpec(ir);
 assert.equal(ir.operations.length,10);
 assert.equal(ir.entities[0].fields[2].name,"freeUnits");
 assert.equal(ir.entities[1].fields[2].name,"requested");
 assert.ok(code.includes('@reserve("RentalAssets", "freeUnits", "assetCode", "requested")'));
 assert.ok(code.includes('@release("RentalAssets", "freeUnits", "assetCode", "requested")'));
 assert.ok(code.includes('@transition("under_review", "granted")'));
 assert.ok(code.includes('@transition("requested", "under_review")'));
});
test("untrusted graph cannot silently change route, reference, privilege, reservation or compensation",()=>{
 const ir=composeOperatorGraph(parse(original));
 const edits=[
  q=>q.operations.find(o=>o.kind==="create").capability="public",
  q=>q.entities[1].fields[1].reference.onDelete="cascade",
  q=>q.operations.find(o=>o.reserve).reserve.availableField="description",
  q=>q.operations.find(o=>o.release).release.quantityField="claimCode",
  q=>q.operations.find(o=>o.release).release=undefined,
  q=>q.operations.push({name:"deleteEverything",kind:"delete"}),
  q=>q.entities[1].fields[3].initial="approved",
  q=>q.operations.find(o=>o.kind==="transition").audit=[]
 ];
 for(const edit of edits){
  const compromised=structuredClone(ir);edit(compromised);
  assert.throws(()=>emitOperatorTypeSpec(compromised),/graph differs/);
 }
});
test("dangerous source inputs and unsupported operator kinds are rejected before generating files",()=>fixture(x=>{
 const baseline=parse(x.source);
 for(const mutation of [
  q=>q.entities[0].capacity.max=-5,
  q=>q.entities[1].quantity.max=1,
  q=>q.entities[0].identity.name="id",
  q=>q.entities[1].reference.target="OtherTable",
  q=>q.entities[1].status.initial='pending"\n@capability("public")',
  q=>q.operators[1].release=true,
  q=>q.operators[2].release=false,
  q=>q.operators[2].to="pending",
  q=>q.operators.push({kind:"dropSql",command:"DROP TABLE users"}),
  q=>q.entities[0].capabilities={write:"public"},
  q=>q.operators[2].from="impossible"
 ]){
  const bad=structuredClone(baseline);mutation(bad);x.update(bad);
  assert.throws(()=>compileOperators(x.source,x.out),/OPERATOR_ASSEMBLY_INVALID/);
  assert.equal(existsSync(x.out),false);
 }
}));
test("output lock catches source changes, unknown files and changed generated TypeSpec",()=>fixture(x=>{
 compileOperators(x.source,x.out);
 const source=parse(x.source);source.entities[0].capacity.max=100;x.update(source);
 assert.throws(()=>compileOperators(x.source,x.out,"verify"),/artifact drift/);
 x.update(parse(original));
 writeFileSync(join(x.out,"contracts/main.tsp"),"tampered!");
 assert.throws(()=>compileOperators(x.source,x.out,"verify"),/artifact drift/);
 writeFileSync(join(x.out,"unapproved.js"),"process.exit(1)");
 assert.throws(()=>compileOperators(x.source,x.out,"verify"),/inventory drift/);
}));
