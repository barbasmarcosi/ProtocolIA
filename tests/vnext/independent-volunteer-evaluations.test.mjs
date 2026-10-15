import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
const dir="examples/vnext/volunteer-evaluations";
const source=readFileSync(join(dir,"contracts/main.tsp"),"utf8");
const freeze=readFileSync(join(dir,"ACCEPTANCE_FREEZE.md"),"utf8");
const ir=JSON.parse(readFileSync(join(dir,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
const entities=new Map(ir.entities.map(e=>[e.name,e]));
test("independent benchmark freezes 16 externally sourced requirements",()=>{
  for(let i=1;i<=16;i++)assert.match(freeze,new RegExp("BV-"+String(i).padStart(2,"0")+"\\b"));
  assert.match(freeze,/UNSUPPORTED/);assert.match(freeze,/Ambiguit/);
  assert.ok(!source.includes("totalScore"),"Do not fake a computed score");
  assert.ok(!source.includes("@computed"),"Do not invent unsupported decorators");
});
test("TypeSpec compiled five independent FK-related domain entities",()=>{
  assert.deepEqual([...entities.keys()].sort(),["GuardDuty","LeaveRecord","MonthlyEvaluation","Section","Volunteer"].sort());
  assert.equal(entities.get("GuardDuty").fields.find(f=>f.name==="sectionCode").reference.target,"Section");
  assert.equal(entities.get("Volunteer").fields.find(f=>f.name==="guardCode").reference.target,"GuardDuty");
  for(const n of ["MonthlyEvaluation","LeaveRecord"])
    assert.equal(entities.get(n).fields.find(f=>f.name==="volunteerBadge").reference.target,"Volunteer");
});
test("source-defined category caps survive the compiler",()=>{
  const grade=entities.get("MonthlyEvaluation");
  for(const [field,max] of [["incidentPoints",25],["mandatoryPoints",35],["guardPoints",20],["internalPoints",20]]){
    const f=grade.fields.find(f=>f.name===field);
    assert.equal(f.min,0,field);assert.equal(f.max,max,field);
  }
  assert.equal(grade.fields.find(f=>f.name==="status").initial,"draft");
  assert.equal(grade.fields.find(f=>f.name==="otherPoints").min,0);
});
test("generated operations include guarded reassignment, publish, filtered history and independent audit authority",()=>{
  const byName=new Map(ir.operations.map(o=>[o.name,o]));
  for(const e of entities.keys())for(const k of ["create","get","list"])
    assert.ok(byName.has(k+e),"Missing "+k+e);
  assert.equal(byName.get("changeVolunteerGuard").behavior.kind,"reassignReference");
  assert.equal(byName.get("closeMonthlyEvaluation").behavior.kind,"transition");
  assert.equal(byName.get("queryMonthlyEvaluations").behavior.kind,"queryPage");
  assert.equal(byName.get("evaluationAudit").behavior.kind,"auditPage");
  assert.notEqual(byName.get("evaluationAudit").capability,byName.get("listMonthlyEvaluation").capability);
});
