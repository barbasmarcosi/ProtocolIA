import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {reviewSemanticIr,validateReviewSemanticIr,emitReviewTypeSpec} from "../../scripts/research/typed-review-workflow.mjs";
import {compileReviewWorkflow} from "../../scripts/research/review-workflow-intake.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const source=join(root,"research/autonomous-engineering/samples/review-workflow-source.json");
const parse=file=>JSON.parse(readFileSync(file,"utf8"));
function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),"p2-review-")),input=join(dir,"src.json"),out=join(dir,"out");
 writeFileSync(input,readFileSync(source));
 try{return fn({dir,input,out,update:v=>writeFileSync(input,JSON.stringify(v,null,2)+"\n")});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
test("source names four distinct states, two exclusive terminal edges and no stock or external effects",()=>{
 const ir=reviewSemanticIr(parse(source));
 assert.equal(validateReviewSemanticIr(ir),ir);
 assert.equal(ir.entities.length,1);
 assert.equal(ir.operations.length,7);
 assert.deepEqual(ir.operations.filter(op=>op.kind==="transition").map(op=>[op.name,op.from,op.to,op.capability]),[
  ["submitReviewCase","drafted","in_review","cases.write"],
  ["approveReviewCase","in_review","approved","cases.write"],
  ["rejectReviewCase","in_review","rejected","cases.write"]]);
 assert.ok(ir.operations.every(op=>!op.reserve&&!op.release&&!op.moveUnits&&!op.moveBatch));
 const tsp=emitReviewTypeSpec(ir);
 assert.equal((tsp.match(/@transition\(/g)||[]).length,3);
 assert.equal((tsp.match(/@audit\("state"\)/g)||[]).length,3);
 assert.doesNotMatch(tsp,/@reserve|@release|@moveBatch|@delete|@charge/);
 assert.match(tsp,/@transition\("in_review", "rejected"\)/);
});
test("source-bound generator creates exact reviewed IR, TypeSpec, Passport inputs and lock",()=>fixture(x=>{
 const result=compileReviewWorkflow(x.input,x.out);
 assert.equal(result.status,"PARTIAL_DRAFT_UNVERIFIED");
 assert.equal(result.files,7);
 assert.equal(compileReviewWorkflow(x.input,x.out,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
 const ir=parse(join(x.out,"semantic-ir.json"));
 assert.equal(readFileSync(join(x.out,"contracts/main.tsp"),"utf8"),emitReviewTypeSpec(ir));
 const d=parse(join(x.out,"decisions.json"));
 assert.equal(d.authority,"SELF_DECLARED_UNVERIFIED");
 assert.equal(d.decisions.length,2);
 assert.ok(d.decisions.every(q=>q.state==="unresolved"));
 assert.equal(parse(join(x.out,"requirements.json")).requirements.at(-1).scope,"deferred");
}));
test("source may change stage names and length bounds but never operations or privileges",()=>fixture(x=>{
 compileReviewWorkflow(x.input,x.out);
 const other=join(x.dir,"different"),src=parse(x.input);
 src.title="Bounded case approval with different labels";
 src.workflow={initial:"unsubmitted",review:"technical_review",accepted:"granted",rejected:"denied"};
 src.bounds={caseIdMaxLength:70,summaryMaxLength:140};x.update(src);
 compileReviewWorkflow(x.input,other);
 const first=parse(join(x.out,"semantic-ir.json"));
 const next=parse(join(other,"semantic-ir.json"));
 assert.notDeepEqual(first.workflow,next.workflow);
 assert.deepEqual(first.operations.map(o=>[o.name,o.path,o.capability,o.kind]),
  next.operations.map(o=>[o.name,o.path,o.capability,o.kind]));
 const newTsp=readFileSync(join(other,"contracts/main.tsp"),"utf8");
 assert.match(newTsp,/@transition\("technical_review", "granted"\)/);
 assert.match(newTsp,/@maxLength\(70\)/);
 assert.match(newTsp,/@maxLength\(140\)/);
}));
test("malformed state graph, spoofed operations and injected labels are refused before output",()=>fixture(x=>{
 const base=parse(x.input);
 for(const mutation of [
  p=>p.workflow.rejected=p.workflow.accepted,
  p=>p.workflow.review="approved\n@capability(\"public\")",
  p=>p.bounds.caseIdMaxLength=1,
  p=>p.bounds.summaryMaxLength=2.5,
  p=>p.workflow.initial=42,
  p=>p.profile="dynamic-god-mode",
  p=>p.workflow.extra="deleted",
  p=>p.evilSql="DROP TABLE users"
 ]){
  const damaged=structuredClone(base);mutation(damaged);x.update(damaged);
  assert.throws(()=>compileReviewWorkflow(x.input,x.out),/REVIEW_IR_INVALID/);
  assert.equal(existsSync(x.out),false);
 }
}));
test("IR tampering cannot authorize public approvals, state bypass, or decisions with side effects",()=>{
 const ir=reviewSemanticIr(parse(source));
 for(const mutation of [
  p=>p.operations[4].capability="public",
  p=>p.operations[3].from=p.workflow.review,
  p=>p.operations[5].to=p.workflow.accepted,
  p=>p.operations[5].audit=[],
  p=>p.operations[3].reserve={stockEntity:"Cash",availableField:"balance"},
  p=>p.entities[0].fields[2].initial="approved",
  p=>p.operations.push({name:"deleteReviewCase",kind:"delete"})
 ]){
  const changed=structuredClone(ir);mutation(changed);
  assert.throws(()=>emitReviewTypeSpec(changed),/IR differs from trusted state graph/);
 }
});
test("hash lock detects source change, output mutation and unexpected generated files",()=>fixture(x=>{
 compileReviewWorkflow(x.input,x.out);
 const original=parse(x.input);
 original.workflow.rejected="declined";
 x.update(original);
 assert.throws(()=>compileReviewWorkflow(x.input,x.out,"verify"),/artifact drift/);
 x.update(parse(source));
 writeFileSync(join(x.out,"contracts/main.tsp"),"tampered");
 assert.throws(()=>compileReviewWorkflow(x.input,x.out,"verify"),/artifact drift/);
 writeFileSync(join(x.out,"unexpected.sql"),"SELECT 1;");
 assert.throws(()=>compileReviewWorkflow(x.input,x.out,"verify"),/output file inventory changed/);
}));
