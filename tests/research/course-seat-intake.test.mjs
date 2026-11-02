import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {courseSeatSemanticIr,emitCourseSeatTypeSpec,validateCourseSeatSemanticIr} from "../../scripts/research/course-seat-semantic-ir.mjs";
import {compileCourseSource,validateCourseSource} from "../../scripts/research/course-seat-intake.mjs";
import {stockSemanticIr,emitStockTypeSpec} from "../../scripts/research/stock-semantic-ir.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const source=join(root,"research/autonomous-engineering/samples/course-seats-source.json");
const stock=join(root,"research/autonomous-engineering/samples/stock-debit-typed-ir-brief.json");
const parse=path=>JSON.parse(readFileSync(path,"utf8"));
function fixture(fn){
 const temp=mkdtempSync(join(tmpdir(),"protocolia-course-seat-")),file=join(temp,"source.json"),out=join(temp,"generated");
 writeFileSync(file,readFileSync(source));
 try{return fn({temp,file,out,change:v=>writeFileSync(file,JSON.stringify(v,null,2)+"\n")});}
 finally{rmSync(temp,{recursive:true,force:true});}
}
test("independent course domain has distinct entities, capability boundaries and audited cancel-once behavior",()=>{
 const src=parse(source),{ir}=validateCourseSource(src);
 assert.equal(ir.profile,"course-seat-lab/v0");
 assert.deepEqual(ir.entities.map(x=>x.name),["CourseSession","SeatBooking"]);
 assert.deepEqual(ir.operations.map(x=>x.name),[
  "createCourseSession","getCourseSession","listCourseSessions",
  "createSeatBooking","getSeatBooking","listSeatBookings","cancelSeatBooking","health"]);
 const booking=ir.operations.find(x=>x.name==="createSeatBooking");
 const cancel=ir.operations.find(x=>x.name==="cancelSeatBooking");
 assert.deepEqual(booking.reserve,{stockEntity:"CourseSession",availableField:"seatsAvailable",referenceField:"sessionCode",quantityField:"seats"});
 assert.deepEqual(cancel.release,booking.reserve);
 assert.equal(cancel.from,"confirmed");assert.equal(cancel.to,"cancelled");
 assert.deepEqual(cancel.audit,["status"]);
 assert.equal(cancel.capability,"course-seats.write");
 assert.equal(ir.entities[1].fields.find(x=>x.name==="sessionCode").reference.onDelete,"restrict");
 assert.equal(validateCourseSeatSemanticIr(ir),ir);
});
test("real TypeSpec emitted from course IR is verified against immutable source and never invents pricing/scheduling",()=>fixture(x=>{
 const a=compileCourseSource(x.file,x.out);
 assert.equal(a.status,"PARTIAL_DRAFT_UNVERIFIED");
 assert.equal(a.files,7);
 assert.equal(compileCourseSource(x.file,x.out,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
 const sourceIr=parse(join(x.out,"semantic-ir.json"));
 const tsp=readFileSync(join(x.out,"contracts/main.tsp"),"utf8");
 assert.equal(tsp,emitCourseSeatTypeSpec(sourceIr));
 for(const token of [
  'namespace CourseSeatLab',
  'model CourseSession','model SeatBooking',
  '@reserve("CourseSession", "seatsAvailable", "sessionCode", "seats")',
  '@release("CourseSession", "seatsAvailable", "sessionCode", "seats")',
  '@transition("confirmed", "cancelled")','@audit("status")',
  '@capability("course-seats.write")','@reference("CourseSession", "restrict")',
  '@maxValue(80)','@maxValue(8)'
 ])assert.ok(tsp.includes(token),token);
 assert.doesNotMatch(tsp,/@chargeCustomer|@calendar|@payment|op refund|model Student/);
 const req=parse(join(x.out,"requirements.json"));
 assert.equal(req.schemaVersion,"protocolia-requirements/v1");
 assert.ok(req.requirements.every(v=>v.origin==="source_brief_unverified"));
 assert.equal(req.requirements.find(v=>v.id==="CS-05").operations.length,0);
 const ledger=parse(join(x.out,"decisions.json"));
 assert.equal(ledger.authority,"SELF_DECLARED_UNVERIFIED");
 assert.equal(ledger.decisions.length,3);
 assert.ok(ledger.decisions.every(x=>x.state==="unresolved"));
}));
test("second domain proves same renderer works without altering first domain contract semantics",()=>{
 const project=parse(stock).project,ir=stockSemanticIr(project),a=emitStockTypeSpec(ir);
 const second=emitCourseSeatTypeSpec(courseSeatSemanticIr(parse(source).project));
 assert.match(a,/@reserve\("StockItem", "available", "stockSku", "units"\)/);
 assert.match(a,/@release\("StockItem", "available", "stockSku", "units"\)/);
 assert.match(second,/@reserve\("CourseSession", "seatsAvailable", "sessionCode", "seats"\)/);
 assert.notEqual(a,second);
});
test("both independent domains reject tampering of the transaction graph, permissions, capacity and cancellation state",()=>{
 const approved=courseSeatSemanticIr(parse(source).project);
 const attacks=[
  o=>o.operations.find(x=>x.name==="createSeatBooking").reserve.availableField="topic",
  o=>o.operations.find(x=>x.name==="cancelSeatBooking").release.quantityField="bogus",
  o=>o.operations.find(x=>x.name==="cancelSeatBooking").to="confirmed",
  o=>o.operations.find(x=>x.name==="cancelSeatBooking").audit=[],
  o=>o.operations.find(x=>x.name==="cancelSeatBooking").capability="public",
  o=>o.entities[1].fields.find(x=>x.name==="sessionCode").reference.onDelete="cascade",
  o=>o.entities[0].fields.find(x=>x.name==="seatsAvailable").max=999999,
  o=>o.operations.push({name:"adminSql",kind:"create",entity:"CourseSession",capability:"public"})
 ];
 for(const mutate of attacks){
  const compromised=structuredClone(approved);mutate(compromised);
  assert.throws(()=>emitCourseSeatTypeSpec(compromised),/semantic graph differs from trusted/);
 }
});
test("source bounds reject invalid or unreviewed extensions before output creation",()=>fixture(x=>{
 const original=parse(x.file);
 const edits=[
  q=>q.project.bounds.seatCapacityMax=-1,
  q=>q.project.bounds.seatsPerBookingMax=1,
  q=>q.project.bounds.seatsPerBookingMax=1000,
  q=>q.project.bounds.bookingIdMaxLength=2.5,
  q=>q.project.bounds.unknownSecurityOverride=true,
  q=>q.project.title="Bad"+String.fromCharCode(10)+"@capability(\"public\")",
  q=>delete q.project.bounds.topicMaxLength
 ];
 for(const change of edits){
  const data=structuredClone(original);change(data);x.change(data);
  assert.throws(()=>compileCourseSource(x.file,x.out),/COURSE_SEAT_IR_INVALID/);
  assert.equal(existsSync(x.out),false);
 }
}));
test("unresolved material question within supported scope blocks generation",()=>fixture(x=>{
 const data=parse(x.file);
 data.questions[0].affectsSupported=true;
 x.change(data);
 assert.throws(()=>compileCourseSource(x.file,x.out),/unanswered material questions: CS-Q01/);
 assert.equal(existsSync(x.out),false);
}));
test("agent-authored source cannot silently add operations or impersonate owner",()=>fixture(x=>{
 const data=parse(x.file);data.requirements[0].operations.push("adminSql");x.change(data);
 assert.throws(()=>compileCourseSource(x.file,x.out),/unknown course operation/);
 const forged=parse(source);forged.requirements[0].origin="explicit_owner";x.change(forged);
 assert.throws(()=>compileCourseSource(x.file,x.out),/missing\/unknown fields/);
 assert.equal(existsSync(x.out),false);
}));
test("two separate source constraints produce different typed TypeSpec and identical authorized operations",()=>fixture(x=>{
 compileCourseSource(x.file,x.out);
 const alternate=join(x.temp,"other"),data=parse(x.file);
 data.project.bounds.seatCapacityMax=40;
 data.project.bounds.seatsPerBookingMax=4;
 x.change(data);
 compileCourseSource(x.file,alternate);
 const first=parse(join(x.out,"semantic-ir.json")),second=parse(join(alternate,"semantic-ir.json"));
 assert.deepEqual(first.operations,second.operations);
 assert.equal(first.entities[0].fields[2].max,80);
 assert.equal(second.entities[0].fields[2].max,40);
 assert.equal(second.entities[1].fields[2].max,4);
 assert.notEqual(readFileSync(join(x.out,"contracts/main.tsp"),"utf8"),
  readFileSync(join(alternate,"contracts/main.tsp"),"utf8"));
});
test("source change and post-generation modification both invalidate artifact verification",()=>fixture(x=>{
 compileCourseSource(x.file,x.out);
 const sourceNew=parse(x.file);sourceNew.project.bounds.seatCapacityMax=60;
 x.change(sourceNew);
 assert.throws(()=>compileCourseSource(x.file,x.out,"verify"),/artifact drift/);
 const before=parse(source);x.change(before);
 writeFileSync(join(x.out,"semantic-ir.json"),"{}");
 assert.throws(()=>compileCourseSource(x.file,x.out,"verify"),/artifact drift/);
}));
