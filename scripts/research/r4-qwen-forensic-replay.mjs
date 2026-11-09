#!/usr/bin/env node
// R4 forensic evidence: EXACT original Qwen3 archive replay, NEVER a clean-room
// success assertion. The model FAILED to call finish, and its natural-language
// "exceeded" question was rejected by a narrow lexical oracle. Prove only
// technical safety of the unmodified bytes against disposable PostgreSQL.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";

const repo=resolve(".");
const [originalArg,target]=process.argv.slice(2);
assert.ok(originalArg&&["nestjs","modular-spring"].includes(target),
  "Usage: r4-qwen-forensic-replay.mjs <source-bound-original-app> <nestjs|modular-spring>");
const original=resolve(originalArg);
const root=join(repo,"experiments/r4-frozen-qwen-20261107");
const provenance=JSON.parse(readFileSync(join(root,"provenance.json"),"utf8"));
assert.equal(provenance.schemaVersion,"r4-frozen-model-artifact/v1");
assert.equal(provenance.sourceRunId,42329470874);
assert.equal(provenance.sourceArtifactId,13557256844);
assert.equal(provenance.outcome,"INCOMPLETE_HANDOFF_PROTOCOL_BUT_CANDIDATE_FILES_WRITTEN");
const encoded=readFileSync(join(root,"model-artifact.zip.base64"),"utf8").trim();
assert.match(encoded,/^[A-Za-z0-9+/]+={0,2}$/);
assert.ok(encoded.length<30000);
const zip=Buffer.from(encoded,"base64");
assert.equal(zip.toString("base64"),encoded,"Noncanonical artifact encoding");
assert.equal(createHash("sha256").update(zip).digest("hex"),
  provenance.sourceArchiveSha256,"Archived original model bytes changed");

function call(bin,args,{allowFailure=false,timeout=900000}={}){
  const p=spawnSync(bin,args,{
    cwd:repo,encoding:"utf8",timeout,maxBuffer:10*1024*1024});
  if(p.error||(!allowFailure&&p.status!==0))
    throw Error("R4 forensic "+bin+" failed "+String(p.error?.message??"")+
      "\n"+String(p.stderr??"").slice(-1500)+"\n"+String(p.stdout??"").slice(-1400));
  return p;
}
const tmp=mkdtempSync(join(repo,".r4-frozen-observation-"));
try{
  const archive=join(tmp,"original-model-output.zip");
  writeFileSync(archive,zip,{flag:"wx"});
  const names=call("unzip",["-Z","-1",archive]).stdout.trim().split("\n").sort();
  assert.deepEqual(names,[
    "candidate/contracts/main.tsp",
    "candidate/handoff-response.json",
    "candidate/tspconfig.yaml",
    "trial-metadata.json"
  ].sort(),"Unexpected ZIP member: cannot extract unreviewed paths");
  call("unzip",["-q",archive,"-d",tmp]);
  const candidate=join(tmp,"candidate");
  for(const name of names){
    const file=join(tmp,name);
    assert.ok(existsSync(file));
    const st=lstatSync(file);
    assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<15000);
  }
  const trial=JSON.parse(readFileSync(join(tmp,"trial-metadata.json"),"utf8"));
  const answer=JSON.parse(readFileSync(join(candidate,"handoff-response.json"),"utf8"));
  assert.equal(trial.schemaVersion,"r4-external-model-trial/v1");
  assert.equal(trial.provider,"Ollama (local CPU)");
  assert.equal(trial.model,provenance.model);
  assert.equal(trial.complete,false,"Original agent was not finished; do not forge provenance");
  assert.match(trial.error,/Model did not finish candidate within bounded turns/);
  assert.equal(trial.rounds,10);
  assert.equal(trial.originalContractSha256,provenance.originalContractSha256);
  assert.equal(answer.sourceContractSha256,provenance.originalContractSha256);
  assert.ok(answer.openQuestions.length>=2);
  const toolNames=trial.audit.flatMap(x=>x.toolNames);
  for(const required of ["read_file","write_candidate","check_candidate"])
    assert.ok(toolNames.includes(required),"Missing genuine tool usage: "+required);
  assert.equal(toolNames.includes("finish"),false,"A finish call must NOT be invented");
  assert.equal(toolNames.filter(x=>x==="write_candidate").length,2);
  console.log("PROTOCOLIA_R4_ORIGINAL_QWEN_UNFINISHED_MODEL_EVIDENCE_AUTHENTIC "+JSON.stringify({
    sourceRun:provenance.sourceRunId,model:trial.model,rounds:trial.rounds,
    originalArchiveSha256:provenance.sourceArchiveSha256,
    toolCalls:toolNames.length,finishCalled:false
  }));
  const participant=join(tmp,"source-bound-participant");
  call(process.execPath,["scripts/research/r4-handoff-benchmark.mjs","package",
    original,"tests/research/fixtures/r4-cold-handoff/CHANGE_REQUEST.md",participant]);
  // Reproduce the ORIGINAL v1 keyword-only rejection independently of the
  // evolving scorer. Preserve the observed failure even after correcting it.
  assert.equal(provenance.categories.businessOracle,"UNACCEPTED_KNOWN_LEXICAL_GAP");
  const legacyOverdueWords=["overdue","vencid","caducad","expir","past due","atrasad"];
  assert.equal(answer.openQuestions.some(q=>legacyOverdueWords.some(term=>
    q.toLocaleLowerCase("es").includes(term))),false,
    "Frozen answer must still demonstrate the historical lexical blind spot");
  console.log("PROTOCOLIA_R4_HISTORICAL_QWEN_LEXICAL_REJECTION_PRESERVED");

  // A v2 scorer result is a RETROSPECTIVE re-evaluation, never a rewrite of
  // the historical run's rejected score or missing finish call.
  const scorer=call(process.execPath,["scripts/research/r4-handoff-benchmark.mjs",
    "score",participant,candidate,
    "tests/research/fixtures/r4-cold-handoff/ci-control-oracle.json"],
    {timeout:180000});
  assert.match(scorer.stdout,/PROTOCOLIA_R4_SUBMISSION_SEMANTICALLY_ACCEPTED/);
  console.log("PROTOCOLIA_R4_UPDATED_SCORER_RETROSPECTIVE_ACCEPTANCE_ONLY");

  // The model-written CONTRACT itself may be safe although the finish protocol
  // failed and the keyword oracle rejected a legitimate English paraphrase.
  // Evolve a disposable POPULATED database with EXACT model-authored bytes.
  const test=call(process.execPath,["scripts/research/r4-verified-checkpoint-restore.mjs",
    original,target,"--submission",candidate],{timeout:1200000});
  assert.match(test.stdout,/PROTOCOLIA_R4_AGENT_AUTHORED_CANDIDATE_VERIFIED_SQL_RESTORE_PASS/);
  console.log("PROTOCOLIA_R4_ORIGINAL_QWEN_TECHNICAL_POSTGRESQL_"+target+"_PASS");
  console.log("PROTOCOLIA_R4_FORENSIC_RESULT_TECHNICAL_ONLY_NO_AGENT_COMPLETION");
}finally{
  rmSync(tmp,{recursive:true,force:true});
}
