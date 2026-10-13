import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const from = resolve("examples/vnext/taller/tsp-output/@protocolia/compiler");
const decision = JSON.parse(readFileSync(join(from,"jhipster-capability-report.json"),"utf8"));
assert.equal(decision.fullContractSupported,false,"Do not claim fidelity before runtime conformance");
const root=mkdtempSync(join(tmpdir(),"protocolia-jdl-a0-"));
cpSync(join(from,"jhipster-app.jdl"),join(root,"generated.jdl"));
const binary = resolve("node_modules/.bin/jhipster");
if(!existsSync(binary))throw Error("Install pinned generator-jhipster@9.4.0 before running probe");
const result=spawnSync(binary,["jdl","generated.jdl","--skip-install","--skip-git","--no-insight"],{
  cwd:root,encoding:"utf8",timeout:240000,maxBuffer:4_000_000,env:{...process.env,JHIPSTER_SKIP_INSTALL:"true"},
});
console.log("JHIPSTER_PROBE_COMMAND=jhipster jdl generated.jdl --skip-install --skip-git --no-insight");
console.log("JHIPSTER_PROBE_EXIT="+(result.status??"null"));
console.log("JHIPSTER_PROBE_STDOUT_TAIL="+(result.stdout||"").slice(-1800));
console.log("JHIPSTER_PROBE_STDERR_TAIL="+(result.stderr||"").slice(-1800));
if(result.error) throw result.error;
if(result.status!==0)process.exit(result.status??1);
const entries=readdirSync(root,{recursive:true}).map(String);
console.log("JHIPSTER_PROBE_GENERATED_ENTRIES="+entries.length);
console.log("JHIPSTER_PROBE_TOP_LEVEL="+readdirSync(root).join(","));
const entity=entries.filter((p)=>p.endsWith("Tool.json"));
const ui=entries.filter((p)=>p.includes("tool")&&p.endsWith(".tsx"));
const java=entries.filter((p)=>p.endsWith("ToolResource.java"));
console.log("JHIPSTER_PROBE_ENTITY_JSON="+JSON.stringify(entity));
console.log("JHIPSTER_PROBE_REACT_FILES="+JSON.stringify(ui.slice(0,12)));
console.log("JHIPSTER_PROBE_TOOL_RESOURCE="+JSON.stringify(java));
if(!entity.length)throw Error("JHipster returned 0 but did not generate Tool entity JSON");

const resourceFile=join(root,java[0]);
const resourceText=readFileSync(resourceFile,"utf8");
console.log("JHIPSTER_REAL_JAVA_HTTP_BINDINGS="+JSON.stringify(
  resourceText.split("\n").map((x)=>x.trim()).filter((x)=>/Mapping\(|PathVariable/.test(x)).slice(0,32)
));
const uiDetail=entries.find((p)=>p.endsWith("entities/tool/tool-detail.tsx"));
const uiContent=uiDetail?readFileSync(join(root,uiDetail),"utf8"):"";
console.log("JHIPSTER_REACT_ID_REFERENCES="+JSON.stringify(
  uiContent.split("\n").map((x)=>x.trim()).filter((x)=>/id|code/.test(x)).slice(0,18)
));
console.log("JHIPSTER_JAVA_AVAILABLE="+(spawnSync("java",["-version"],{encoding:"utf8"}).status===0));
console.log("JHIPSTER_MAVEN_AVAILABLE="+existsSync(join(root,"mvnw")));

const ext=join(root,"extensions","consumer-owned.txt");
mkdirSync(join(root,"extensions"),{recursive:true});
writeFileSync(ext,"keep this untouched\n");
const sha=(x)=>createHash("sha256").update(x).digest("hex");
const sourceBefore=sha(resourceText);
const replay=spawnSync(binary,["jdl","generated.jdl","--skip-install","--skip-git","--no-insight"],{
 cwd:root,encoding:"utf8",timeout:90000,maxBuffer:4_000_000,env:{...process.env,CI:"true",JHIPSTER_SKIP_INSTALL:"true"}
});
console.log("JHIPSTER_REGENERATE_EXIT="+(replay.status??"null"));
console.log("JHIPSTER_REGENERATE_STDERR_TAIL="+(replay.stderr||"").slice(-500));
console.log("JHIPSTER_REGENERATE_EXTENSION_UNCHANGED="+
  (existsSync(ext)&&readFileSync(ext,"utf8")==="keep this untouched\n"));
console.log("JHIPSTER_REGENERATE_RESOURCE_IDENTICAL="+
  (existsSync(resourceFile)&&sha(readFileSync(resourceFile,"utf8"))===sourceBefore));
