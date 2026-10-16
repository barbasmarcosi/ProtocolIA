import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const root="examples/vnext/date-ordering";
const source=readFileSync(join(root,"contracts/main.tsp"),"utf8");
const ir=JSON.parse(readFileSync(join(root,"tsp-output/@protocolia/compiler/ir.json"),"utf8"));
test("afterField is a portable typed non-executable IR constraint",()=>{
  const entity=ir.entities.find(e=>e.name==="Gauge");
  const from=entity.fields.find(f=>f.name==="installedAt");
  const until=entity.fields.find(f=>f.name==="calibratedAt");
  assert.equal(from.type,"utcDateTime");
  assert.equal(from.required,true);
  assert.equal(from.nullable,false);
  assert.equal(until.type,"utcDateTime");
  assert.equal(until.required,false);
  assert.equal(until.nullable,false);
  assert.equal(until.afterField,"installedAt");
  const ceiling=entity.fields.find(f=>f.name==="readingCeiling");
  assert.equal(ceiling.type,"int32");
  assert.equal(ceiling.required,false);
  assert.equal(ceiling.nullable,false);
  assert.equal(ceiling.greaterThanField,"reading");
});
function rejectMutation(label,modify,code){
  const scratch=mkdtempSync(join("examples","vnext",".date-order-negative-"));
  try{
    cpSync(join(root,"tspconfig.yaml"),join(scratch,"tspconfig.yaml"));
    cpSync(join(root,"contracts"),join(scratch,"contracts"),{recursive:true});
    const updated=modify(source);
    assert.notEqual(updated,source,label);
    writeFileSync(join(scratch,"contracts/main.tsp"),updated);
    const run=spawnSync(join(process.cwd(),"node_modules/.bin/tsp"),["compile",scratch],{
      encoding:"utf8",timeout:90000
    });
    assert.notEqual(run.status,0,label+" must not compile");
    assert.match((run.stdout??"")+(run.stderr??""),code,label);
  }finally{rmSync(scratch,{recursive:true,force:true});}
}
test("unknown, self, non-temporal and optional sources reject at compile time",()=>{
  rejectMutation("unknown source",s=>s.replace('@afterField("installedAt")','@afterField("nobody")'),
    /protocolia-invalid-after-field/);
  rejectMutation("self comparison",s=>s.replace('@afterField("installedAt")','@afterField("calibratedAt")'),
    /protocolia-invalid-after-field/);
  rejectMutation("source optional",s=>s.replace('installedAt: utcDateTime;','installedAt?: utcDateTime;'),
    /protocolia-invalid-after-field/);
  rejectMutation("target wrong type",s=>s.replace('calibratedAt?: utcDateTime;','calibratedAt?: string;'),
    /protocolia-invalid-after-field/);
  rejectMutation("source wrong type",s=>s.replace('installedAt: utcDateTime;','installedAt: string;'),
    /protocolia-invalid-after-field/);
});
test("CREATE DTO must preserve both temporal field types",()=>{
  rejectMutation("source DTO string",s=>{
    const n='installedAt: utcDateTime;',at=s.lastIndexOf(n);
    return s.slice(0,at)+'installedAt: string;'+s.slice(at+n.length);
  },/protocolia-after-field-request-mismatch/);
  rejectMutation("target DTO string",s=>{
    const n='calibratedAt?: utcDateTime;',at=s.lastIndexOf(n);
    return s.slice(0,at)+'calibratedAt?: string;'+s.slice(at+n.length);
  },/protocolia-after-field-request-mismatch/);
});

// Strict integer relation is a typed, fail-closed compiler rule, not a UI hint.
test("greaterThanField rejects unknown, self, optional and non-integer operands",()=>{
  rejectMutation("missing operand",s=>s.replace('@greaterThanField("reading")','@greaterThanField("absent")'),
    /protocolia-invalid-greater-than-field/);
  rejectMutation("self operand",s=>s.replace('@greaterThanField("reading")','@greaterThanField("readingCeiling")'),
    /protocolia-invalid-greater-than-field/);
  rejectMutation("optional source",s=>s.replace('reading: int32;','reading?: int32;'),
    /protocolia-invalid-greater-than-field/);
  rejectMutation("wrong target",s=>s.replace('readingCeiling?: int32;','readingCeiling?: string;'),
    /protocolia-invalid-greater-than-field/);
  rejectMutation("non-integer source",s=>s.replace('reading: int32;','reading: string;'),
    /protocolia-invalid-greater-than-field/);
});
test("CREATE cannot weaken compared operands",()=>{
  rejectMutation("DTO target type",s=>{
    const n='readingCeiling?: int32;',at=s.lastIndexOf(n);
    return s.slice(0,at)+'readingCeiling?: string;'+s.slice(at+n.length);
  },/protocolia-greater-than-request-mismatch/);
  rejectMutation("DTO source range",s=>{
    const n='@minValue(0)\n    reading: int32;',at=s.lastIndexOf(n);
    return s.slice(0,at)+'reading: int32;'+s.slice(at+n.length);
  },/protocolia-greater-than-request-mismatch/);
  rejectMutation("DTO target omission",s=>{
    const n='    readingCeiling?: int32;',at=s.lastIndexOf(n);
    return s.slice(0,at)+s.slice(at+n.length);
  },/protocolia-greater-than-request-mismatch/);
});
