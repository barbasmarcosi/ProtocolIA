import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {OPERATOR_VERSIONS,operatorCatalogSnapshot,operatorCatalogDigest,
 requireOperatorVersions,classifyOperatorCatalogChange,
 validateReservePrimitive,validateTerminalTransitionPrimitives}
 from "../../scripts/research/operator-catalog-v1.mjs";
import {composeOperatorGraph,emitOperatorTypeSpec,validateOperatorGraph}
 from "../../scripts/research/composable-operator-grammar.mjs";
import {compileOperators} from "../../scripts/research/composable-operator-intake.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const oldPath=join(root,"research/autonomous-engineering/samples/composable-equipment-allocation.json");
const versionedPath=join(root,"research/autonomous-engineering/samples/composable-equipment-operators-v02.json");
const parse=p=>JSON.parse(readFileSync(p,"utf8"));
function temp(fn){
 const dir=mkdtempSync(join(tmpdir(),"p2-operator-v2-"));
 const old=join(dir,"legacy.json"),input=join(dir,"versioned.json");
 writeFileSync(old,readFileSync(oldPath));
 writeFileSync(input,readFileSync(versionedPath));
 try{return fn({dir,old,input,output:join(dir,"out"),update:x=>writeFileSync(input,JSON.stringify(x,null,2)+"\n")});}
 finally{rmSync(dir,{recursive:true,force:true});}
}
test("catalog exposes reviewed immutable metadata, deterministic digest, and required pinned versions",()=>{
 const first=operatorCatalogSnapshot(),second=operatorCatalogSnapshot();
 assert.deepEqual(first,second);
 assert.equal(first.operators.length,3);
 assert.deepEqual(Object.keys(OPERATOR_VERSIONS).sort(),["release","reserve","transition"]);
 assert.match(operatorCatalogDigest(),/^[0-9a-f]{64}$/);
 const binding=requireOperatorVersions({...OPERATOR_VERSIONS});
 assert.equal(binding.catalogSha256,operatorCatalogDigest());
 first.operators[0].invariants.push("malicious-secret");
 assert.notDeepEqual(first,operatorCatalogSnapshot());
 assert.equal(operatorCatalogDigest(),binding.catalogSha256);
});
test("v0.1 and explicitly version-pinned v0.2 render identical operational TypeSpec",()=>temp(x=>{
 const a=composeOperatorGraph(parse(x.old)),b=composeOperatorGraph(parse(x.input));
 assert.equal(a.schemaVersion,"protocolia-composable-operator-ir/v0.1");
 assert.equal(b.schemaVersion,"protocolia-composable-operator-ir/v0.2");
 assert.equal(a.operatorCatalog,undefined);
 assert.deepEqual(b.operatorCatalog.pins,OPERATOR_VERSIONS);
 assert.equal(validateOperatorGraph(b),b);
 assert.equal(emitOperatorTypeSpec(a),emitOperatorTypeSpec(b));
 const oldDir=join(x.dir,"legacy");compileOperators(x.old,oldDir);
 assert.equal(parse(join(oldDir,"protocolia-intake.lock.json")).schemaVersion,
  "protocolia-operator-lock/v0.1");
 assert.equal(parse(join(oldDir,"protocolia-intake-report.json")).operatorCatalogSha256,undefined);
 const out=compileOperators(x.input,x.output);
 assert.equal(out.files,8);
 assert.equal(compileOperators(x.input,x.output,"verify").status,"CONSISTENT_DRAFT_NOT_ATTESTED");
 const lock=parse(join(x.output,"protocolia-intake.lock.json"));
 assert.equal(lock.schemaVersion,"protocolia-operator-lock/v0.2");
 assert.equal(lock.operatorCatalogSha256,operatorCatalogDigest());
 const catalog=parse(join(x.output,"operator-catalog.json"));
 assert.equal(catalog.catalogSha256,operatorCatalogDigest());
 assert.deepEqual(catalog.pins,OPERATOR_VERSIONS);
 assert.deepEqual(catalog.catalog,operatorCatalogSnapshot());
 const report=parse(join(x.output,"protocolia-intake-report.json"));
 assert.equal(report.generatorProfile,"composable-operator-grammar/v0.2");
 assert.equal(report.operatorCatalogSha256,operatorCatalogDigest());
 assert.equal(readFileSync(join(oldDir,"contracts/main.tsp"),"utf8"),
  readFileSync(join(x.output,"contracts/main.tsp"),"utf8"));
}));
test("unknown major versions, downgrade, extra pins and missing pins fail before any files",()=>temp(x=>{
 const source=parse(x.input);
 const edits=[
  q=>q.operatorVersions.reserve="capacity.reserve@2",
  q=>q.operatorVersions.release="capacity.release-terminal@0",
  q=>q.operatorVersions.transition="state.transition-audited@2",
  q=>q.operatorVersions.erase="sql.unsafe@1",
  q=>delete q.operatorVersions.reserve,
  q=>delete q.operatorVersions,
  q=>q.operators[0].kind="paid-reserve",
  q=>q.schemaVersion="protocolia-operator-assembly/v0.3"
 ];
 for(const edit of edits){
  const candidate=structuredClone(source);edit(candidate);x.update(candidate);
  assert.throws(()=>compileOperators(x.input,x.output),/OPERATOR_ASSEMBLY_INVALID/);
  assert.equal(existsSync(x.output),false);
 }
}));
test("v0.2 catalog binding is sealed in the IR and locked generated artifacts",()=>temp(x=>{
 const valid=composeOperatorGraph(parse(x.input));
 for(const change of [
  ir=>ir.operatorCatalog.pins.release="capacity.release-terminal@2",
  ir=>ir.operatorCatalog.catalogSha256="0".repeat(64),
  ir=>{delete ir.operatorCatalog;},
  ir=>ir.grammarSource.operatorVersions.reserve="capacity.reserve@2",
  ir=>ir.operations.find(o=>o.release).release.availableField="bogus"
 ]){
  const modified=structuredClone(valid);change(modified);
  assert.throws(()=>emitOperatorTypeSpec(modified),/OPERATOR_ASSEMBLY_INVALID/);
 }
 compileOperators(x.input,x.output);
 const p=join(x.output,"operator-catalog.json");
 writeFileSync(p,readFileSync(p,"utf8").replace("capacity.reserve@1","capacity.reserve@2"));
 assert.throws(()=>compileOperators(x.input,x.output,"verify"),/artifact drift/);
}));
test("reserve primitive validates exact edge; release policy rejects cycles, joins and double credit",()=>{
 assert.equal(validateReservePrimitive({kind:"reserve",journal:"Claim",parent:"Pool"},"Pool","Claim"),true);
 assert.throws(()=>validateReservePrimitive({kind:"reserve",journal:"Claim",parent:"Other"},"Pool","Claim"),
  /reserve edge mismatch/);
 const yes={kind:"transition",name:"approveClaim",suffix:"approve",from:"pending",to:"approved",release:false};
 const no={kind:"transition",name:"rejectClaim",suffix:"reject",from:"pending",to:"rejected",release:true};
 assert.equal(validateTerminalTransitionPrimitives([yes,no],"pending").releaseName,"rejectClaim");
 const invalid=[
  [yes,{...no,release:false}],
  [{...yes,release:true},no],
  [{...yes,to:"rejected"},no],
  [yes,{...no,from:"rejected",to:"pending"}],
  [{...yes,from:"alien"},no],
  [yes,{...no,name:"approveClaim"}],
  [yes,{...no,to:"staged"},{...yes,name:"restoreClaim",suffix:"restore",from:"staged",to:"rejected",release:false}],
 ];
 for(const transitions of invalid)
  assert.throws(()=>validateTerminalTransitionPrimitives(transitions,"pending"),
   /OPERATOR_ASSEMBLY_INVALID/);
});
test("catalog compatibility never authorizes execution, including additions",()=>{
 const baseline=operatorCatalogSnapshot();
 const unchanged=classifyOperatorCatalogChange(baseline,structuredClone(baseline));
 assert.equal(unchanged.classification,"identical");
 assert.equal(unchanged.executable,false);
 const add=structuredClone(baseline);
 add.operators.push({...add.operators[0],id:"capacity.new-operator",version:1});
 const pending=classifyOperatorCatalogChange(baseline,add);
 assert.equal(pending.classification,"requires-review");
 assert.deepEqual(pending.added,["capacity.new-operator"]);
 assert.equal(pending.executable,false);
 const altered=structuredClone(baseline);
 altered.operators[0].transaction="non-atomic";
 assert.equal(classifyOperatorCatalogChange(baseline,altered).classification,"breaking");
 const deleted=structuredClone(baseline);deleted.operators.pop();
 assert.equal(classifyOperatorCatalogChange(baseline,deleted).classification,"breaking");
 const spoofed=structuredClone(baseline);spoofed.operators[1].id=spoofed.operators[0].id;
 assert.throws(()=>classifyOperatorCatalogChange(baseline,spoofed),/duplicate catalog descriptor/);
});
