#!/usr/bin/env node
// Verify immutable archive, restore into isolated DB, and rehearse additive DDL.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,openSync,closeSync,
  appendFileSync,copyFileSync,statSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";

const generated=resolve(process.argv[2]??"");
assert.ok(existsSync(join(generated,"protocolia-build.json")));
const scratch=mkdtempSync(join(tmpdir(),"pia-checkpoint-test-"));
const project="pia_ckpt_"+randomBytes(5).toString("hex");
const port=19000+Math.floor(Math.random()*19000);
const secret=randomBytes(16).toString("hex");
const envFile=join(scratch,"env"),archive=join(scratch,"checkpoint.dump");
writeFileSync(envFile,[
  "PROTOCOLIA_DB_PASSWORD="+randomBytes(16).toString("hex"),
  "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
  "PROTOCOLIA_MANAGER_USERNAME=manager","PROTOCOLIA_MANAGER_PASSWORD="+secret,
  "PROTOCOLIA_READER_USERNAME=reader","PROTOCOLIA_READER_PASSWORD="+randomBytes(16).toString("hex"),
  "PROTOCOLIA_HOST_PORT="+port
].join("\n")+"\n",{mode:0o600});
const compose=["compose","--project-name",project,"--env-file",envFile];
function run(binary,args,{cwd=generated,stdin,timeout=600000,allowFailure=false}={}){
  const p=spawnSync(binary,args,{cwd,encoding:"utf8",timeout,
    stdio:[stdin??"ignore","pipe","pipe"],maxBuffer:4*1024*1024});
  if(!allowFailure&&(p.error||p.status!==0))
    throw Error(binary+" failed: "+(p.stderr??p.error?.message??"").slice(-1000));
  return allowFailure?p.status:(p.stdout??"").trim();
}
const docker=(...args)=>run("docker",[...compose,...args]);
const dbSql=(db,query)=>docker("exec","-T","db","psql","-U","protocolia",
  "-d",db,"-At","-v","ON_ERROR_STOP=1","-c",query);
const appcli=resolve("packages/cli/protocolia.mjs");
const snapshot=db=>({
  header:dbSql(db,"SELECT status||':'||document_version::text||':'||title "+
    "FROM purchase_order WHERE code='RETAINED'"),
  rows:dbSql(db,"SELECT string_agg(line_code||':'||product||':'||units::text,',' ORDER BY line_code) "+
    "FROM order_line WHERE order_code='RETAINED'"),
  audit:dbSql(db,"SELECT count(*) FROM protocolia_audit_event "+
    "WHERE resource_id IN ('BEFORE-A','BEFORE-B','BEFORE-C')")
});
let started=false;
try{
  docker("config","--quiet");
  started=true;
  docker("up","--detach","--build");
  let ready=false;
  for(let i=0;i<120;i++){
    try{
      const res=await fetch("http://127.0.0.1:"+port+"/health",
        {signal:AbortSignal.timeout(2200)});
      if(res.ok){ready=true;break;}
    }catch{}
    await new Promise(ok=>setTimeout(ok,900));
  }
  assert.ok(ready,"Generated app failed health check");
  const auth="Basic "+Buffer.from("manager:"+secret).toString("base64");
  async function request(method,path,payload,headers={}){
    const r=await fetch("http://127.0.0.1:"+port+path,{
      method,headers:{Authorization:auth,...(payload?{"Content-Type":"application/json"}:{}),...headers},
      ...(payload?{body:JSON.stringify(payload)}:{})
    });
    return {status:r.status,body:await r.text()};
  }
  const created=await request("POST","/api/orders",{
    code:"RETAINED",title:"Durable document",lines:[
      {lineCode:"BEFORE-A",product:"Unchanged",units:2},
      {lineCode:"BEFORE-B",product:"Preserved",units:3}
    ]
  });
  assert.equal(created.status,201,created.body);
  const appended=await request("POST","/api/order-lines",{
    lineCode:"BEFORE-C",orderCode:"RETAINED",product:"Audited",units:4
  },{"If-Match":'"1"'});
  assert.equal(appended.status,201,appended.body);
  const original=snapshot("protocolia");
  assert.equal(original.header,"draft:2:Durable document");
  assert.match(original.rows,/BEFORE-C/);
  assert.ok(Number(original.audit)>=1);
  const options=["db:checkpoint",generated,"--project",project,
    "--env-file",envFile,"--out",archive];
  assert.match(run(process.execPath,[appcli,...options],{cwd:resolve(".")}),
    /PROTOCOLIA_DB_CHECKPOINT_CREATED/);
  assert.equal(statSync(archive).mode&0o077,0);
  assert.match(run(process.execPath,[appcli,"db:verify",archive],{cwd:resolve(".")}),
    /PROTOCOLIA_DB_CHECKPOINT_VERIFY_PASS/);
  assert.notEqual(run(process.execPath,[appcli,...options],
    {cwd:resolve("."),allowFailure:true}),0,"Checkpoint overwrite must be refused");
  // v1.1d: run the exact canonical TypeSpec additive migration SQL in a
  // separate network-isolated PG container using this proven old-data dump.
  const newContract=resolve("examples/vnext/dynamic-order-versioned-additive");
  const report=join(scratch,"migration-preflight.json");
  const probeArgs=["db:preflight",newContract,generated,
    "--checkpoint",archive,"--report",report];
  const preview=run(process.execPath,[appcli,...probeArgs],{cwd:resolve(".")});
  assert.match(preview,/PROTOCOLIA_EVOLUTION_SQL_PREVIEW/);
  assert.match(preview,/PROTOCOLIA_DB_PREFLIGHT_PASS/);
  const summary=JSON.parse(readFileSync(report,"utf8"));
  assert.equal(summary.status,"pass");
  assert.equal(summary.target,JSON.parse(readFileSync(
    join(generated,"protocolia-build.json"))).target);
  assert.ok(summary.tablesChecked>=3 && summary.rowsChecked>=3);
  assert.equal(summary.originDatabaseAccess,false);
  assert.equal(summary.isolatedNetwork,"none");
  assert.match(summary.proposedSqlSha256,/^[0-9a-f]{64}$/);
  assert.notEqual(run(process.execPath,[appcli,...probeArgs],{
    cwd:resolve("."),allowFailure:true}),0,
    "Migration preflight must never overwrite a report");
  const incompatible=resolve("examples/vnext/dynamic-order-versioned-breaking");
  assert.notEqual(run(process.execPath,[appcli,"db:preflight",
    incompatible,generated,"--checkpoint",archive,
    "--report",join(scratch,"should-not-exist.json")],
    {cwd:resolve("."),allowFailure:true}),0,
    "An incompatible contract must never reach the migration container");
  assert.equal(existsSync(join(scratch,"should-not-exist.json")),false);
  const forged=join(scratch,"wrong-source.dump");
  copyFileSync(archive,forged);
  const forgedMeta=JSON.parse(readFileSync(archive+".json","utf8"));
  forgedMeta.contractSha256="f".repeat(64);
  writeFileSync(forged+".json",JSON.stringify(forgedMeta),{mode:0o600});
  assert.notEqual(run(process.execPath,[appcli,"db:preflight",
    newContract,generated,"--checkpoint",forged,
    "--report",join(scratch,"wrong-source.json")],
    {cwd:resolve("."),allowFailure:true}),0,
    "A checkpoint from the wrong contract must be rejected");
  assert.equal(existsSync(join(scratch,"wrong-source.json")),false);
  assert.deepEqual(snapshot("protocolia"),original,
    "Offline preflight must never modify the source database");
  const restoreDb="restore_"+randomBytes(5).toString("hex");
  docker("exec","-T","db","createdb","-U","protocolia","-T","template0",restoreDb);
  const fd=openSync(archive,"r");
  try{
    run("docker",[...compose,"exec","-T","db","pg_restore","-U","protocolia",
      "-d",restoreDb,"--no-owner","--no-acl","--exit-on-error"],{stdin:fd});
  }finally{closeSync(fd);}
  assert.deepEqual(snapshot(restoreDb),original,"Isolated full restore must preserve all data");
  dbSql(restoreDb,"ALTER TABLE purchase_order ADD COLUMN recovery_note VARCHAR(120)");
  assert.deepEqual(snapshot(restoreDb),original,"Additive migration must retain existing records");
  // A failing constraint inside a transaction must not leave partial DDL.
  assert.notEqual(run("docker",[...compose,"exec","-T","db","psql",
    "-U","protocolia","-d",restoreDb,"-v","ON_ERROR_STOP=1","-c",
    "BEGIN; ALTER TABLE purchase_order ADD COLUMN must_rollback BOOLEAN; "+
      "ALTER TABLE purchase_order ADD CONSTRAINT impossible_state "+
      "CHECK (document_version<1); COMMIT;"],{allowFailure:true}),0);
  assert.equal(dbSql(restoreDb,"SELECT count(*) FROM information_schema.columns "+
    "WHERE table_name='purchase_order' AND column_name='must_rollback'"),"0");
  assert.deepEqual(snapshot(restoreDb),original,"Failed migration must roll back all DDL");
  const corrupt=join(scratch,"damaged.dump");
  copyFileSync(archive,corrupt);
  copyFileSync(archive+".json",corrupt+".json");
  appendFileSync(corrupt,Buffer.from("tampered"));
  assert.notEqual(run(process.execPath,[appcli,"db:verify",corrupt],
    {cwd:resolve("."),allowFailure:true}),0,"Corrupted archive must fail checksum");
  assert.deepEqual(snapshot("protocolia"),original,"Source database must not change");
  console.log("PROTOCOLIA_V11_DB_PREFLIGHT_PASS "+JSON.stringify({
    migrationSqlFromTypeSpec:true,isolatedPostgresNoNetwork:true,
    restoredOldData:true,allExistingRowsPreserved:true,
    sqlDigestBoundToReport:true,noAutoDeploy:true,
    wrongContractRejected:true,wrongSourceSnapshotRejected:true,
    noOverwrite:true,originalDatabaseUntouched:true
  }));
  console.log("PROTOCOLIA_V11_DB_BACKUP_RESTORE_PASS "+JSON.stringify({
    adapter:JSON.parse(readFileSync(join(generated,"protocolia-build.json"))).target,
    postgresCustomDump:true,checkedSha256:true,restoreIsolated:true,
    oldRowsPreserved:true,oldAuditPreserved:true,additiveDdlTested:true,
    incompatibleDdlRolledBack:true,sourceUnchanged:true,overwriteRefused:true
  }));
}finally{
  if(started)try{docker("down","--volumes","--remove-orphans");}
  catch(error){console.error("DB_TEST_CLEANUP_FAILED "+error.message);process.exitCode=1;}
  rmSync(scratch,{recursive:true,force:true});
}
