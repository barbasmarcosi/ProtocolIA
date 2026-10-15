import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,cpSync} from "node:fs";
import {spawnSync} from "node:child_process";
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
  assert.ok(source.includes('@computedSum("incidentPoints,mandatoryPoints,guardPoints,internalPoints")'),"Newly supported sum is explicitly contract-defined");
  assert.ok(!source.includes("totalScore"),"Do not claim a full monthly total with leave scoring");
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
  assert.deepEqual(grade.fields.find(f=>f.name==="basePoints").computedSum,
    ["incidentPoints","mandatoryPoints","guardPoints","internalPoints"]);
  assert.equal(grade.fields.find(f=>f.name==="basePoints").max,100);
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

test("malformed computedSum contracts fail closed at the TypeSpec compiler",()=>{
  const mutations=[
    ["unknown input", '@computedSum("incidentPoints,mandatoryPoints,guardPoints,notReal")'],
    ["duplicate source", '@computedSum("incidentPoints,mandatoryPoints,guardPoints,guardPoints")'],
    ["unbounded source", '@computedSum("incidentPoints,mandatoryPoints,guardPoints,otherPoints")'],
    ["declared output max too small", '@minValue(0) @maxValue(99)']
  ];
  const base='@computedSum("incidentPoints,mandatoryPoints,guardPoints,internalPoints")';
  for(const [label,replacement] of mutations){
    const scratch=mkdtempSync(join("examples","vnext",".computed-negative-"));
    try {
      cpSync(join(dir,"tspconfig.yaml"),join(scratch,"tspconfig.yaml"));
      cpSync(join(dir,"contracts"),join(scratch,"contracts"),{recursive:true});
      let mutant=source;
      if(label==="declared output max too small"){
        mutant=mutant.replace('@minValue(0) @maxValue(100)\n    basePoints','@minValue(0) @maxValue(99)\n    basePoints');
      }else mutant=mutant.replace(base,replacement);
      writeFileSync(join(scratch,"contracts/main.tsp"),mutant);
      assert.notEqual(mutant,source,label+" must change the source");
      const result=spawnSync(join(process.cwd(),"node_modules",".bin","tsp"),["compile",scratch],{
        cwd:process.cwd(),encoding:"utf8",timeout:60000
      });
      assert.equal(result.status===0,false,label+": compiler unexpectedly accepted mutation");
      assert.match((result.stdout??"")+(result.stderr??""),/protocolia-invalid-computed-sum/i,label);
    }finally{
      rmSync(scratch,{recursive:true,force:true});
    }
  }
});
