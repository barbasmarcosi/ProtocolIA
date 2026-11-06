#!/usr/bin/env node
// One-time independent replay of actual Qwen pilot artifact 42307290079.
// Tests this first trial's fixed negative business-uncertainty outcome.
// Never edits model output, participant instructions, or oracle.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cpSync,mkdtempSync,readFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {verifyApp} from "../../packages/cli/ownership.mjs";
const [inPath,outPath]=process.argv.slice(2);
assert.ok(inPath&&outPath);
const input=resolve(inPath),output=resolve(outPath),repo=resolve(".");
const lock=JSON.parse(readFileSync(join(input,"HANDOFF.lock.json"),"utf8"));
const metadata=JSON.parse(readFileSync(join(output,"trial-metadata.json"),"utf8"));
assert.equal(metadata.provider,"Ollama (local CPU)");
assert.equal(metadata.model,"qwen3:4b-instruct-2507-q4_K_M");
assert.equal(metadata.complete,true);
assert.equal(metadata.rounds,6);
assert.equal(metadata.originalContractSha256,lock.originalContractSha256);
assert.equal(metadata.audit.reduce((sum,x)=>sum+x.toolCallCount,0),13);
const report=JSON.parse(readFileSync(join(output,"candidate/handoff-response.json"),"utf8"));
assert.equal(report.sourceContractSha256,lock.originalContractSha256);
console.log("PROTOCOLIA_R4_REAL_QWEN_PILOT_PROVENANCE_PASS");
const script=join(repo,"scripts/research/r4-handoff-benchmark.mjs");
const grading=spawnSync(process.execPath,[script,"score",input,join(output,"candidate"),
  join(repo,"tests/research/fixtures/r4-cold-handoff/ci-control-oracle.json")],
{cwd:repo,encoding:"utf8",timeout:180000,maxBuffer:1024*1024});
assert.equal(grading.status,1,"Pilot scorer unexpectedly accepted generic unresolved questions");
assert.match(grading.stderr,
  /Material unknown not disclosed in natural language: calibration_cadence/);
console.log("PROTOCOLIA_R4_REAL_PILOT_POLICY_UNCERTAINTY_FAIL_CONFIRMED");
const source=mkdtempSync(join(repo,".r4-real-pilot-"));
try{
  cpSync(join(output,"candidate/contracts"),join(source,"contracts"),{recursive:true});
  cpSync(join(output,"candidate/tspconfig.yaml"),join(source,"tspconfig.yaml"));
  for(const target of ["nestjs","modular-spring"]){
    const app=join(process.env.RUNNER_TEMP??"/tmp","r4-replayed-pilot-"+target);
    const command=spawnSync(process.execPath,[join(repo,"packages/cli/protocolia.mjs"),
      "build",source,"--target",target,"--out",app,"--passport"],
      {cwd:repo,encoding:"utf8",timeout:600000,maxBuffer:3*1024*1024});
    if(command.error||command.status!==0)
      throw Error("Actual model code failed "+target+" build: "+
        (command.stderr??command.error?.message??"").slice(-1200));
    verifyApp(app);
    const ir=JSON.parse(readFileSync(join(app,"protocolia-contract-ir.json"),"utf8"));
    const entity=ir.entities.find(e=>e.name==="Tool");
    const field=entity.fields.find(f=>f.name==="calibrationDueAt");
    assert.equal(field?.type,"utcDateTime");
    assert.equal(field.required,false);assert.equal(field.nullable,true);
    assert.equal(ir.operations.length,6);
    console.log("PROTOCOLIA_R4_REAL_PILOT_CODE_"+target+"_PASS");
  }
}finally{rmSync(source,{recursive:true,force:true})}
console.log("PROTOCOLIA_R4_FIRST_GENUINE_MODEL_CODE_PASS_POLICY_FAIL");
