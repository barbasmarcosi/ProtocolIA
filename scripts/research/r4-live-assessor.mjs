#!/usr/bin/env node
// Post-inference assessor. Run ONLY in a separate GitHub Actions job with the
// evaluator repository checked out; never copy this to the model job.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cpSync,mkdtempSync,readFileSync,rmSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";

const [participant,resultDir]=process.argv.slice(2).map(resolve);
assert.ok(participant&&resultDir);
const repo=resolve("."),candidate=join(resultDir,"candidate");
const manifest=JSON.parse(readFileSync(join(participant,"HANDOFF.lock.json"),"utf8"));
const trial=JSON.parse(readFileSync(join(resultDir,"trial-metadata.json"),"utf8"));
assert.equal(trial.schemaVersion,"r4-external-model-trial/v1");
assert.equal(trial.provider,"GitHub Models");
assert.equal(trial.complete,true,"No independent model submission completed");
assert.equal(trial.originalContractSha256,manifest.originalContractSha256);
assert.ok(trial.rounds>=1&&trial.rounds<=10);
assert.ok(trial.usage.prompt_tokens>0);
const tools=trial.audit.flatMap(x=>x.toolNames);
for(const name of ["read_file","write_candidate","finish"])
  assert.ok(tools.includes(name),"No real model invocation of "+name);
console.log("PROTOCOLIA_R4_EXTERNAL_AGENT_PROVENANCE_PASS "+
  JSON.stringify({model:trial.model,rounds:trial.rounds,tools:tools.length,usage:trial.usage}));
function run(cmd,args,timeout=600000){
  const p=spawnSync(cmd,args,{cwd:repo,encoding:"utf8",timeout,maxBuffer:5*1024*1024});
  if(p.error||p.status!==0)throw Error("Assessor "+cmd+" "+args.slice(0,4).join(" ")+
    " failed: "+String(p.stderr??p.error?.message??"").slice(-900)+" "+
    String(p.stdout??"").slice(-1000));
  return p.stdout??"";
}
const scorer=join(repo,"scripts/research/r4-handoff-benchmark.mjs");
run(process.execPath,[scorer,"verify",participant]);
const score=run(process.execPath,[scorer,"score",participant,candidate,
  join(repo,"tests/research/fixtures/r4-cold-handoff/ci-control-oracle.json")]);
assert.match(score,/PROTOCOLIA_R4_SUBMISSION_SEMANTICALLY_ACCEPTED/);
console.log("PROTOCOLIA_R4_EXTERNAL_MODEL_HELDOUT_SCORER_PASS");
const dir=mkdtempSync(join(repo,".r4-live-agent-"));
try{
  cpSync(join(candidate,"contracts"),join(dir,"contracts"),{recursive:true});
  cpSync(join(candidate,"tspconfig.yaml"),join(dir,"tspconfig.yaml"));
  for(const target of ["nestjs","modular-spring"]){
    const app=join(process.env.RUNNER_TEMP??"/tmp",
      "r4-independent-agent-generated-"+target);
    assert.equal(existsSync(app),false,"Fresh generated app path required");
    run(process.execPath,[join(repo,"packages/cli/protocolia.mjs"),
      "build",dir,"--target",target,"--out",app,"--passport"]);
    const ir=JSON.parse(readFileSync(join(app,"protocolia-contract-ir.json"),"utf8"));
    const field=ir.entities.find(e=>e.name==="Tool")?.fields
      .filter(f=>f.name==="calibrationDueAt");
    assert.equal(field?.length,1);
    assert.equal(field[0].type,"utcDateTime");
    assert.equal(field[0].required,false);
    assert.equal(field[0].nullable,true);
    assert.equal(ir.operations.length,6);
    const {verifyApp}=await import("../../packages/cli/ownership.mjs");
    verifyApp(app);
    console.log("PROTOCOLIA_R4_EXTERNAL_MODEL_GENERATED_"+target+"_PASS");
  }
}finally{rmSync(dir,{recursive:true,force:true})}
console.log("PROTOCOLIA_R4_REAL_FRESH_MODEL_COMPILED_BOTH_ADAPTERS_PASS");
