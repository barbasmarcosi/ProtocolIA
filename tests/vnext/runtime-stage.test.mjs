import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {sealApp} from "../../packages/cli/ownership.mjs";
import {stageOptions,verifyStageInputs,verifyStageReceipt} from "../../packages/cli/runtime-stage.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"pia-stage-options-"));
  const dir=join(root,"app"),out=join(root,"receipt.json"),
    report=join(root,"report.json"),archive=join(root,"checkpoint.dump");
  const folder=join(dir,"src/migrations");
  mkdirSync(folder,{recursive:true});
  const oldContract="a".repeat(64),newContract="b".repeat(64);
  const ir={irVersion:"vnext-a0.1",operations:[{
    method:"GET",path:"/api/orders",behavior:{kind:"listPage"},capability:"orders.read"
  }]};
  const sql="ALTER TABLE purchase_order ADD COLUMN note VARCHAR(120);";
  writeFileSync(join(folder,"V2__protocolia_additive.sql"),
    "-- Non-destructive TypeSpec contract evolution; original baseline preserved\n"+sql+"\n");
  writeFileSync(join(dir,"protocolia-build.json"),
    JSON.stringify({target:"nestjs",contractSha256:newContract}));
  writeFileSync(join(dir,"protocolia-contract-ir.json"),JSON.stringify(ir));
  writeFileSync(join(dir,"protocolia-contract-openapi.json"),JSON.stringify({openapi:"3.0.0"}));
  writeFileSync(join(dir,"compose.yaml"),"services: {}\n");
  sealApp(dir);
  const bytes=Buffer.concat([Buffer.from("PGDMP"),Buffer.alloc(100,9)]);
  writeFileSync(archive,bytes,{mode:0o600});
  writeFileSync(archive+".json",JSON.stringify({
    version:1,format:"pg_dump-custom",target:"nestjs",
    contractSha256:oldContract,archiveBytes:bytes.length,
    archiveSha256:sha(bytes)
  }),{mode:0o600});
  const passed={schema:2,status:"pass",target:"nestjs",
    rowAttestation:"sha256-sorted-row-json-v1",
    sourceContractSha256:oldContract,checkpointSha256:sha(bytes),
    proposedSqlSha256:sha(sql),proposedIrSha256:sha(JSON.stringify(ir)),
    changeCount:1,isolatedNetwork:"none",originDatabaseAccess:false,
    tablesChecked:3,rowsChecked:7};
  writeFileSync(report,JSON.stringify(passed),{mode:0o600});
  const args=[dir,"--checkpoint",archive,"--report",report,"--out",out];
  return {root,dir,out,archive,report,ir,sql,passed,args};
}
test("runtime staging CLI requires explicit private proof and new output outside generated app",()=>{
  const f=fixture();
  assert.deepEqual(stageOptions(f.args),{
    dir:f.dir,archive:f.archive,report:f.report,out:f.out
  });
  for(const args of [
    f.args.slice(0,6),
    [f.dir,"--checkpoint",f.archive,"--report",f.report,"--oops",f.out],
    [f.dir,"--checkpoint",f.archive,"--report",f.report,"--out",join(f.dir,"unsafe.json")],
    [f.dir,"--checkpoint",f.archive,"--report",f.report,"--out",f.report],
    [f.dir,"--checkpoint",f.archive,"--report",f.report,"--out",join(f.root,"missing","receipt.json")]
  ])assert.throws(()=>stageOptions(args),/Runtime staging refused/);
});
test("staged app, prior archive, TypeSpec IR, SQL and owner seal bind exactly",()=>{
  const f=fixture(),opts=stageOptions(f.args);
  const checked=verifyStageInputs(opts);
  assert.equal(checked.binding.migrationVersion,2);
  assert.equal(checked.binding.migrationSqlSha256,sha(f.sql));
  const receipt={...checked.binding,timestamp:new Date().toISOString(),
    stagedAppHealthy:true,oldRowsPreserved:true,schemaLedgerAdvanced:true,
    genericReadPassed:true,stagedVolumeDestroyed:true};
  writeFileSync(f.out,JSON.stringify(receipt),{mode:0o600});
  assert.equal(verifyStageReceipt(opts).evolvedIrSha256,f.passed.proposedIrSha256);
  for(const [key,value] of [
    ["stagedVolumeDestroyed",false],["checkpointSha256","f".repeat(64)],
    ["migrationSqlSha256","f".repeat(64)],["sourceContractSha256","f".repeat(64)],
    ["installedOwnershipSha256","f".repeat(64)],["status","fail"]
  ]){
    writeFileSync(f.out,JSON.stringify({...receipt,[key]:value}));
    assert.throws(()=>verifyStageReceipt(opts),/Runtime staging refused/,key);
  }
  writeFileSync(f.out,JSON.stringify(receipt));
  chmodSync(f.out,0o644);
  assert.throws(()=>verifyStageReceipt(opts),/owner-only/);
});
test("reject modified SQL, IR, report or actual checkpoint before any Docker work",()=>{
  const f=fixture(),opts=stageOptions(f.args);
  writeFileSync(f.report,JSON.stringify({...f.passed,proposedSqlSha256:"f".repeat(64)}));
  assert.throws(()=>verifyStageInputs(opts),/rehearsed canonical SQL/);
  writeFileSync(f.report,JSON.stringify(f.passed));
  chmodSync(f.report,0o644);
  assert.throws(()=>verifyStageInputs(opts),/owner-only/);
  chmodSync(f.report,0o600);
  writeFileSync(f.archive,Buffer.concat([Buffer.from("PGDMP"),Buffer.alloc(100,1)]));
  assert.throws(()=>verifyStageInputs(opts),/checksum, size or format/);
});
test("reject changed generated contract or source-backed report without refreshing seal",()=>{
  const f=fixture(),opts=stageOptions(f.args);
  writeFileSync(join(f.dir,"protocolia-contract-ir.json"),"{}");
  assert.throws(()=>verifyStageInputs(opts),/Managed files modified/);
  const g=fixture(),gopts=stageOptions(g.args);
  writeFileSync(g.report,JSON.stringify({...g.passed,proposedIrSha256:"0".repeat(64)}));
  assert.throws(()=>verifyStageInputs(gopts),/Evolved app does not match/);
  const alias=g.out+".symlink";
  writeFileSync(g.out,JSON.stringify({...verifyStageInputs(stageOptions(g.args)).binding}),
    {mode:0o600});
  symlinkSync(g.out,alias);
  assert.throws(()=>verifyStageReceipt({...gopts,out:alias}),/owner-only/);
});
