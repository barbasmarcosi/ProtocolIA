import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {tmpdir} from "node:os";
import {checkBrief,gateway} from "../../scripts/research/agent-intake-gateway.mjs";
import {stockSemanticIr,validateStockSemanticIr,emitStockTypeSpec} from "../../scripts/research/stock-semantic-ir.mjs";
import {compileStockBrief} from "../../scripts/research/stock-debit-intake.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const trusted=join(root,"research/autonomous-engineering/samples/stock-debit-typed-ir-brief.json");
const candidate=join(root,"research/autonomous-engineering/trials/chat-agent-stock-debit/proposal-template.json");
const h=x=>createHash("sha256").update(x).digest("hex");
function scenario(fn){
 const tmp=mkdtempSync(join(tmpdir(),"protocolia-stock-ir-"));
 const brief=join(tmp,"brief.json"),proposal=join(tmp,"proposal.json"),
  out=join(tmp,"generated"),gate=join(tmp,"gateway");
 writeFileSync(brief,readFileSync(trusted));
 const p=JSON.parse(readFileSync(candidate));
 p.briefSha256=h(readFileSync(brief));
 writeFileSync(proposal,JSON.stringify(p,null,2)+"\n");
 const update=x=>writeFileSync(brief,JSON.stringify(x,null,2)+"\n");
 try{return fn({tmp,brief,proposal,out,gate,update});}finally{rmSync(tmp,{force:true,recursive:true});}
}
test("typed source produces bounded two-entity semantic graph with fixed transactional behavior",()=>{
 const source=JSON.parse(readFileSync(trusted));
 assert.equal(checkBrief(source),source);
 const ir=stockSemanticIr(source.project);
 assert.equal(validateStockSemanticIr(ir),ir);
 assert.equal(ir.schemaVersion,"protocolia-stock-semantic-ir/v0.1");
 assert.deepEqual(ir.entities.map(x=>x.name),["StockItem","StockDebit"]);
 assert.equal(ir.entities[0].fields.find(f=>f.name==="available").max,50000);
 assert.equal(ir.entities[1].fields.find(f=>f.name==="debitId").maxLength,64);
 const debit=ir.operations.find(x=>x.name==="createStockDebit");
 const reversal=ir.operations.find(x=>x.name==="reverseStockDebit");
 assert.deepEqual(debit.reserve,{stockEntity:"StockItem",availableField:"available",referenceField:"stockSku",quantityField:"units"});
 assert.deepEqual(reversal.release,debit.reserve);
 assert.deepEqual(reversal.audit,["state"]);
 assert.equal(reversal.from,"posted");
 assert.equal(reversal.to,"reversed");
});
test("real emitter serializes source bound constraints from typed nodes, not copy of fixed template",()=>scenario(x=>{
 const r=compileStockBrief(x.brief,x.proposal,x.out);
 assert.equal(r.files,8);
 assert.equal(compileStockBrief(x.brief,x.proposal,x.out,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
 const sem=JSON.parse(readFileSync(join(x.out,"semantic-ir.json"),"utf8"));
 const main=readFileSync(join(x.out,"contracts/main.tsp"),"utf8");
 assert.equal(main,emitStockTypeSpec(sem));
 const fragment=(str)=>assert.ok(main.includes(str),"TypeSpec missing "+str);
 for(const part of ["@maxLength(56)","@maxLength(140)","@maxValue(50000)","@maxLength(64)","@maxValue(250)",
  '@reserve("StockItem", "available", "stockSku", "units")',
  '@release("StockItem", "available", "stockSku", "units")',
  '@audit("state")',
  '@capability("stock-debits.write")'])
  fragment(part);
 const old=readFileSync(join(root,"examples/vnext/stock-debit/contracts/main.tsp"),"utf8");
 assert.notEqual(old,main,"typed IR must actually emit a new contract");
 const r2=JSON.parse(readFileSync(join(x.out,"protocolia-intake-report.json"),"utf8"));
 assert.equal(r2.templateSha256,null);
 assert.equal(r2.semanticIrSha256,h(readFileSync(join(x.out,"semantic-ir.json"))));
 assert.equal(r2.generatedOperations.length,8);
 assert.deepEqual(r2.deferredRequirements,["SI-05","SI-06","SI-07"]);
 const provenance=JSON.parse(readFileSync(join(x.out,"source-provenance.json"),"utf8"));
 assert.equal(provenance.status,"SOURCE_ANCHORED_DRAFT_UNVERIFIED");
 assert.equal(provenance.sourceFactIds.length,5);
}));
test("semantic graph can't be injected with arbitrary operation, public write or compromised journal",()=>{
 const source=JSON.parse(readFileSync(trusted));
 const ir=stockSemanticIr(source.project);
 for(const mutate of [
  o=>o.operations.push({name:"adminSql",kind:"create",entity:"StockItem",capability:"public"}),
  o=>o.operations.find(x=>x.name==="createStockDebit").reserve.availableField="name",
  o=>o.operations.find(x=>x.name==="reverseStockDebit").audit=[],
  o=>o.entities[1].fields.find(x=>x.name==="units").max=99999,
  o=>o.operations.find(x=>x.name==="reverseStockDebit").capability="public",
  o=>o.entities[1].fields.find(x=>x.name==="stockSku").reference.onDelete="cascade",
 ]){
  const bad=structuredClone(ir);mutate(bad);
  assert.throws(()=>emitStockTypeSpec(bad),/semantic graph differs/);
 }
});
test("source-supplied limit values are validated before any files are created",()=>scenario(x=>{
 const from=JSON.parse(readFileSync(x.brief));
 const corrupt=[
  y=>y.project.bounds.stockMaxUnits=-1,
  y=>y.project.bounds.debitMaxUnits=1,
  y=>y.project.bounds.skuMaxLength=0,
  y=>y.project.bounds.debitMaxUnits=2.5,
  y=>y.project.bounds.sql="SELECT * FROM users",
  y=>y.project.title='A"\\n@capability("public")\\nB',
  y=>{delete y.project.bounds.debitIdMaxLength;}
 ];
 for(const edit of corrupt){
  const b=structuredClone(from);edit(b);x.update(b);
  const proposal=JSON.parse(readFileSync(x.proposal));
  proposal.briefSha256=h(readFileSync(x.brief));
  writeFileSync(x.proposal,JSON.stringify(proposal,null,2)+"\n");
  assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/STOCK_IR_INVALID/);
  assert.equal(existsSync(x.out),false);
 }
}));
test("source hash binds exact trusted limits, not a model's modified copy",()=>scenario(x=>{
 const bb=JSON.parse(readFileSync(x.brief));
 bb.project.bounds.debitMaxUnits=200;x.update(bb);
 assert.throws(()=>gateway(x.brief,x.proposal,x.gate),/hash mismatch/);
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/hash mismatch/);
 assert.equal(existsSync(x.out),false);
}));
test("new business ambiguity affecting stock behavior blocks typed IR generation",()=>scenario(x=>{
 const p=JSON.parse(readFileSync(x.proposal));
 p.discoveredQuestions.push({id:"SI-Q10",question:"Do stock debits have a mandatory external authorization before posting?",
 classification:"security_privilege",affectsSupported:true});
 writeFileSync(x.proposal,JSON.stringify(p));
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out),/SI-Q10/);
 assert.equal(existsSync(x.out),false);
}));
test("changing output semantic IR or TypeSpec is detected by locked verification",()=>scenario(x=>{
 compileStockBrief(x.brief,x.proposal,x.out);
 const file=join(x.out,"semantic-ir.json");
 const data=JSON.parse(readFileSync(file));
 data.sourceBounds.stockMaxUnits=900000;
 writeFileSync(file,JSON.stringify(data,null,2)+"\n");
 assert.throws(()=>compileStockBrief(x.brief,x.proposal,x.out,"verify"),/drift/);
}));
test("different frozen input bounds change generated TypeSpec deterministically and not capabilities",()=>scenario(x=>{
 const baseline=JSON.parse(readFileSync(x.brief));
 compileStockBrief(x.brief,x.proposal,x.out);
 const t1=readFileSync(join(x.out,"contracts/main.tsp"),"utf8");
 const other=join(x.tmp,"other"),updated=structuredClone(baseline);
 updated.project.bounds.stockMaxUnits=90000;updated.project.bounds.debitMaxUnits=125;
 x.update(updated);
 const p=JSON.parse(readFileSync(x.proposal));
 p.briefSha256=h(readFileSync(x.brief));
 writeFileSync(x.proposal,JSON.stringify(p,null,2)+"\n");
 compileStockBrief(x.brief,x.proposal,other);
 const t2=readFileSync(join(other,"contracts/main.tsp"),"utf8");
 assert.notEqual(t1,t2);
 assert.match(t2,/@maxValue\(90000\)/);
 assert.match(t2,/@maxValue\(125\)/);
 const ir1=JSON.parse(readFileSync(join(x.out,"semantic-ir.json")));
 const ir2=JSON.parse(readFileSync(join(other,"semantic-ir.json")));
 assert.deepEqual(ir1.operations,ir2.operations);
 assert.deepEqual(ir1.entities.map(e=>e.fields.map(f=>({name:f.name,type:f.type,reference:f.reference}))),
  ir2.entities.map(e=>e.fields.map(f=>({name:f.name,type:f.type,reference:f.reference}))));
}));
