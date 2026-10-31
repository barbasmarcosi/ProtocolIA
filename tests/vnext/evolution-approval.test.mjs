import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyEvolutionApproval} from "../../packages/cli/evolution-approval.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),"pia-approval-"));
  const archive=join(dir,"source.dump"),report=join(dir,"preflight.json");
  const bytes=Buffer.concat([Buffer.from("PGDMP"),Buffer.alloc(96,6)]);
  writeFileSync(archive,bytes,{mode:0o600});
  const build={target:"nestjs",contractSha256:"a".repeat(64)};
  const nextIr={irVersion:"vnext-a0.1",entities:[{name:"PurchaseOrder"}]};
  const sql='ALTER TABLE purchase_order ADD COLUMN "note" varchar(80);\n';
  const checkpoint={version:1,format:"pg_dump-custom",target:build.target,
    contractSha256:build.contractSha256,
    archiveBytes:bytes.length,archiveSha256:sha(bytes)};
  writeFileSync(archive+".json",JSON.stringify(checkpoint),{mode:0o600});
  const passed={schema:2,status:"pass",target:build.target,
    rowAttestation:"sha256-sorted-row-json-v1",
    sourceContractSha256:build.contractSha256,
    checkpointSha256:sha(bytes),proposedSqlSha256:sha(sql),
    proposedIrSha256:sha(JSON.stringify(nextIr)),
    changeCount:1,isolatedNetwork:"none",originDatabaseAccess:false,
    tablesChecked:3,rowsChecked:14};
  writeFileSync(report,JSON.stringify(passed),{mode:0o600});
  return {archive,report,archivePath:archive,reportPath:report,
    passed,build,newIr:nextIr,sql,changeCount:1};
}
test("verified evolution binds to exact typed contract, SQL and checkpoint bytes",()=>{
  const args=fixture();
  assert.equal(verifyEvolutionApproval(args).proposedSqlSha256,sha(args.sql));
  for(const [field,value] of [
    ["proposedIrSha256","f".repeat(64)],
    ["proposedSqlSha256","0".repeat(64)],
    ["checkpointSha256","f".repeat(64)],
    ["status","fail"],["target","modular-spring"],
    ["sourceContractSha256","b".repeat(64)],
    ["isolatedNetwork","default"],
    ["originDatabaseAccess",true],["rowsChecked",-1],
    ["schema",1],["rowAttestation","legacy-non-cryptographic"],
  ]){
    writeFileSync(args.report,JSON.stringify({...args.passed,[field]:value}));
    assert.throws(()=>verifyEvolutionApproval(args),
      /Verified evolution refused/,field+" must not pass");
  }
});
test("verified evolution fails closed on unsafe reports and archive damage",()=>{
  const args=fixture();
  assert.throws(()=>verifyEvolutionApproval({...args,reportPath:""}),
    /Verified evolution refused/);
  assert.throws(()=>verifyEvolutionApproval({...args,archivePath:""}),
    /Verified evolution refused/);
  chmodSync(args.report,0o644);
  assert.throws(()=>verifyEvolutionApproval(args),/owner-only/);
  chmodSync(args.report,0o600);
  const alias=args.report+".symlink";symlinkSync(args.report,alias);
  assert.throws(()=>verifyEvolutionApproval({...args,reportPath:alias}),
    /owner-only/);
  writeFileSync(args.archive,Buffer.concat([Buffer.from("PGDMP"),Buffer.alloc(96,5)]));
  assert.throws(()=>verifyEvolutionApproval(args),/checkpoint|checksum|mismatch/i);
});
test("verified evolution refuses approval reused for another target IR, SQL or count",()=>{
  const args=fixture();
  for(const changes of [
    {sql:args.sql+"\nALTER TABLE order_line ADD COLUMN flags INTEGER;"},
    {newIr:{...args.nextIr,extra:"changed"}},
    {changeCount:2},
    {build:{...args.build,contractSha256:"f".repeat(64)}}
  ]){
    assert.throws(()=>verifyEvolutionApproval({...args,...changes}),
      /Verified evolution refused/);
  }
});
