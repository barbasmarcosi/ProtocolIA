#!/usr/bin/env node
// CI control fixture, NOT an independent agent and NOT an agent benchmark result.
// Reads only the public handoff and participant-facing task, never the oracle.
import assert from "node:assert/strict";
import {cpSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";

const [kind,publicBundle,submissionDir]=process.argv.slice(2);
if(!["valid-control","wrong-policy","missing-question","extra-file","missing-field","wrong-handoff","entity-only"].includes(kind)||
   !publicBundle||!submissionDir)throw Error("Usage: r4-control-fixture.mjs valid-control|wrong-policy|missing-question|extra-file|missing-field|wrong-handoff|entity-only <handoff-dir> <new-submission-dir>");
const src=resolve(publicBundle),dest=resolve(submissionDir);
if(existsSync(dest))throw Error("Refusing to overwrite control submission");
mkdirSync(dest);
cpSync(join(src,"protocolia-contract-source","contracts"),join(dest,"contracts"),{recursive:true});
cpSync(join(src,"protocolia-contract-source","tspconfig.yaml"),join(dest,"tspconfig.yaml"));
const path=join(dest,"contracts/main.tsp");
const original=readFileSync(path,"utf8");
const needle="    lastReviewedAt?: utcDateTime | null;";
assert.equal(original.split(needle).length-1,2,"Expected both entity and input occurrences");
if(kind!=="missing-field"){
  const updated="    calibrationDueAt?: utcDateTime | null;\n"+needle;
  const changed=kind==="entity-only"?original.replace(needle,updated):
    original.replaceAll(needle,updated);
  assert.equal(changed.split("calibrationDueAt?: utcDateTime | null;").length-1,
    kind==="entity-only"?1:2);
  writeFileSync(path,kind==="wrong-policy"?
    changed.replace('@capability("inventory.write")','@capability("inventory.read")'):
    changed);
}
const result={
  schemaVersion:"r4-agent-response/v1",
  status:"implemented-with-open-questions",
  sourceContractSha256:JSON.parse(readFileSync(join(src,"HANDOFF.lock.json"))).originalContractSha256,
  openQuestions:[
    "¿Con qué intervalo o frecuencia corresponde calibrar cada tipo de herramienta?",
    "¿Qué acción debe ejecutarse cuando una calibración está vencida?"
  ],
  unapprovedActions:["no_new_access_policy","no_automatic_overdue_workflow"]
};
if(kind==="missing-question")result.openQuestions.pop();
if(kind==="wrong-handoff")result.sourceContractSha256="a".repeat(64);
writeFileSync(join(dest,"handoff-response.json"),JSON.stringify(result,null,2)+"\n");
if(kind==="extra-file")writeFileSync(join(dest,"unreviewed-policy.js"),
  "console.log('not allowed');\n");
console.log("PROTOCOLIA_R4_DETERMINISTIC_CONTROL_ONLY "+kind);
