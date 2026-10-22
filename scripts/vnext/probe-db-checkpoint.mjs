#!/usr/bin/env node
// Verify immutable archive, restore into isolated DB, and rehearse additive DDL.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,openSync,closeSync,
  appendFileSync,copyFileSync,statSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:net";

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
let started=false,stageStarted=false,stageCompose=[];
const stageDocker=(...args)=>run("docker",[...stageCompose,...args]);
const stageSql=query=>stageDocker("exec","-T","db","psql",
  "-U","protocolia","-d","protocolia","-At","-v","ON_ERROR_STOP=1","-c",query);
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
  // v1.1e — graduate the SQL-only rehearsal into a real *application* upgrade.
  // This Compose project is ephemeral and created by this test. Never use this
  // procedure on an external/real database without a separate maintenance plan.
  const dbBefore=docker("ps","--quiet","db");
  assert.match(dbBefore,/^[0-9a-f]{12,64}$/i);
  const originalContract=JSON.parse(readFileSync(join(generated,"protocolia-build.json")));
  assert.equal(originalContract.contractSha256,summary.sourceContractSha256);
  const springBffMigration=join(generated,
    "src/main/resources/db/migration/V2__protocolia_bff_http_session.sql");
  const previousBff=originalContract.target==="modular-spring"?
    readFileSync(springBffMigration,"utf8"):null;
  // Guard every upgrade against an actual, reproducible *prior* preflight.
  // A report is not an authorization to reuse a different SQL or archive.
  const verifiedArgs=["evolve:verified",newContract,generated,
    "--checkpoint",archive,"--report",report];
  const untouchedBuild=readFileSync(join(generated,"protocolia-build.json"),"utf8");
  const invalidReports=[
    ["wrong-sql",{...summary,proposedSqlSha256:"0".repeat(64)}],
    ["wrong-ir",{...summary,proposedIrSha256:"f".repeat(64)}],
    ["wrong-checkpoint",{...summary,checkpointSha256:"f".repeat(64)}],
    ["not-passed",{...summary,status:"fail"}]
  ];
  for(const [label,payload] of invalidReports){
    const bad=join(scratch,"invalid-"+label+".json");
    writeFileSync(bad,JSON.stringify(payload),{mode:0o600});
    assert.notEqual(run(process.execPath,[
      appcli,"evolve:verified",newContract,generated,
      "--checkpoint",archive,"--report",bad],
      {cwd:resolve("."),allowFailure:true}),0,
      "Unapproved evolution must fail: "+label);
    assert.equal(readFileSync(join(generated,"protocolia-build.json"),"utf8"),
      untouchedBuild,"A failed approval must never regenerate the application");
  }
  const noReport=run(process.execPath,[
    appcli,"evolve:verified",newContract,generated],
    {cwd:resolve("."),allowFailure:true});
  assert.notEqual(noReport,0,"Verified evolution requires explicit report and archive");
  const evolveLog=run(process.execPath,[
    appcli,...verifiedArgs],{cwd:resolve("."),timeout:600000});
  assert.match(evolveLog,/PROTOCOLIA_EVOLUTION_PREFLIGHT_VERIFIED/);
  assert.match(evolveLog,/PROTOCOLIA_EVOLUTION_APPLIED/);
  const afterBuild=JSON.parse(readFileSync(join(generated,"protocolia-build.json")));
  assert.equal(afterBuild.target,originalContract.target);
  assert.notEqual(afterBuild.contractSha256,originalContract.contractSha256);
  const migrationFiles=afterBuild.target==="nestjs"?
    join(generated,"src/migrations/V2__protocolia_additive.sql"):
    join(generated,"src/main/resources/db/migration/V3__protocolia_additive.sql");
  assert.ok(existsSync(migrationFiles),
    "Next migration must follow the existing immutable versions (Nest V2; Spring V3)");
  if(previousBff!==null)assert.equal(readFileSync(springBffMigration,"utf8"),previousBff,
    "Spring BFF V2 must remain byte-identical after additive V3 migration");
  assert.ok(readFileSync(migrationFiles,"utf8").includes("ALTER TABLE purchase_order"));
  // v1.1h: A migrated runtime must first prove itself on an entirely
  // independent restored PostgreSQL volume. The original app remains running
  // with its old image and old database until the staging oracle passes.
  const stageProject="pia_stage_"+randomBytes(5).toString("hex");
  const stageSecret=randomBytes(16).toString("hex");
  const stagePassword=randomBytes(16).toString("hex");
  const stageEnvFile=join(scratch,"stage.env");
  const stagePort=await new Promise((ok,fail)=>{
    const server=createServer();
    server.once("error",fail);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(error=>error?fail(error):ok(address.port));
    });
  });
  writeFileSync(stageEnvFile,[
    "PROTOCOLIA_DB_PASSWORD="+stagePassword,
    "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
    "PROTOCOLIA_MANAGER_USERNAME=manager","PROTOCOLIA_MANAGER_PASSWORD="+stageSecret,
    "PROTOCOLIA_READER_USERNAME=reader",
    "PROTOCOLIA_READER_PASSWORD="+randomBytes(16).toString("hex"),
    "PROTOCOLIA_HOST_PORT="+stagePort
  ].join("\n")+"\n",{mode:0o600});
  stageCompose=["compose","--project-name",stageProject,"--env-file",stageEnvFile];
  stageDocker("config","--quiet");
  stageStarted=true; // Cleanup remains mandatory even if db bootstrap fails.
  stageDocker("up","--detach","--wait","db");
  const stageDbBefore=stageDocker("ps","--quiet","db");
  assert.match(stageDbBefore,/^[0-9a-f]{12,64}$/i);
  assert.notEqual(stageDbBefore,dbBefore,
    "Staging must never reuse the original PostgreSQL container");
  assert.equal(stageSql("SELECT count(*) FROM information_schema.tables "+
    "WHERE table_schema='public' AND table_name='purchase_order'"),"0",
    "Staged PostgreSQL must be empty before restore");
  const stageFd=openSync(archive,"r");
  try{
    run("docker",[...stageCompose,"exec","-T","db","pg_restore",
      "-U","protocolia","-d","protocolia",
      "--no-owner","--no-acl","--exit-on-error"],{stdin:stageFd});
  }finally{closeSync(stageFd);}
  assert.equal(stageSql("SELECT status||':'||document_version::text||':'||title "+
    "FROM purchase_order WHERE code='RETAINED'"),original.header);
  assert.equal(stageSql("SELECT string_agg(line_code||':'||product||':'||units::text,',' "+
    "ORDER BY line_code) FROM order_line WHERE order_code='RETAINED'"),original.rows);
  assert.equal(stageSql("SELECT count(*) FROM protocolia_audit_event "+
    "WHERE resource_id IN ('BEFORE-A','BEFORE-B','BEFORE-C')"),original.audit);
  assert.deepEqual(snapshot("protocolia"),original,
    "Restoring the staging copy must not change the original database");
  stageDocker("up","--detach","--build","app");
  let stageReady=false;
  for(let i=0;i<135;i++){
    try{
      const response=await fetch("http://127.0.0.1:"+stagePort+"/health",
        {signal:AbortSignal.timeout(2200)});
      if(response.status===200){stageReady=true;break;}
    }catch{}
    await new Promise(ok=>setTimeout(ok,850));
  }
  if(!stageReady)throw Error("Staged generated runtime did not start: "+
    stageDocker("logs","--tail","60","app"));
  const stageAuth="Basic "+Buffer.from("manager:"+stageSecret).toString("base64");
  async function stageRequest(method,path,payload,headers={}){
    const response=await fetch("http://127.0.0.1:"+stagePort+path,{
      method,
      headers:{Authorization:stageAuth,
        ...(payload===undefined?{}:{"Content-Type":"application/json"}),...headers},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
      signal:AbortSignal.timeout(25000)
    });
    return {status:response.status,body:await response.text(),
      etag:response.headers.get("etag")};
  }
  const stagedParent=await stageRequest("GET","/api/orders/RETAINED");
  assert.equal(stagedParent.status,200,stagedParent.body);
  assert.equal(stagedParent.etag,'"2"',
    "Staged generated HTTP must retain historical document versions");
  assert.equal(stageSql("SELECT count(*) FROM information_schema.columns "+
    "WHERE table_schema='public' AND table_name='purchase_order' "+
    "AND column_name='note'"),"1",
    "New generated runtime must apply the additive column in staging");
  const stagedLedger=afterBuild.target==="nestjs"?
    stageSql("SELECT version::text FROM protocolia_nest_migration_history ORDER BY version"):
    stageSql("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank");
  assert.equal(stagedLedger,afterBuild.target==="nestjs"?"2":"1\n2\n3",
    "Restored staging DB must migrate once and preserve its ledger");
  const stageCreate=await stageRequest("POST","/api/orders",{
    code:"STAGED-NEW",title:"Staged new contract",
    note:"Persisted on isolated restored database",
    lines:[{lineCode:"STAGED-CHILD",product:"Independent",units:1}]
  });
  assert.equal(stageCreate.status,201,stageCreate.body);
  assert.equal(stageSql("SELECT note FROM purchase_order WHERE code='STAGED-NEW'"),
    "Persisted on isolated restored database");
  const stageStale=await stageRequest("POST","/api/order-lines",{
    lineCode:"STAGED-STALE",orderCode:"RETAINED",product:"Rejected",units:1
  },{"If-Match":'"1"'});
  assert.equal(stageStale.status,409,
    "Staged runtime must reject an out-of-date document write");
  const stageAppend=await stageRequest("POST","/api/order-lines",{
    lineCode:"STAGED-APPEND",orderCode:"RETAINED",product:"Audited",units:1
  },{"If-Match":'"2"'});
  assert.equal(stageAppend.status,201,stageAppend.body);
  assert.equal((await stageRequest("GET","/api/orders/RETAINED")).etag,'"3"');
  assert.equal(stageSql("SELECT document_version::text FROM purchase_order "+
    "WHERE code='RETAINED'"),"3");
  assert.ok(Number(stageSql("SELECT count(*) FROM protocolia_audit_event "+
    "WHERE resource_id='STAGED-APPEND'"))>=1,
    "Staged mutation must write to its isolated audit journal");
  assert.equal(stageSql("SELECT count(*) FROM order_line "+
    "WHERE line_code='STAGED-STALE'"),"0");
  assert.equal(docker("ps","--quiet","db"),dbBefore);
  assert.deepEqual(snapshot("protocolia"),original,
    "Staging mutations must never affect the original Compose database");
  stageDocker("down","--volumes","--remove-orphans");
  stageStarted=false;
  assert.equal(docker("ps","--quiet","db"),dbBefore);
  console.log("PROTOCOLIA_V11_STAGED_RUNTIME_PASS "+JSON.stringify({
    target:afterBuild.target,checkpointRestored:true,
    originalDatabaseIsolated:true,stagedAppHealthy:true,
    historicalRowsPreserved:true,migrationLedgerValidated:true,
    newContractFieldPersisted:true,staleWriteRejected:true,
    versionEtagsContinue:true,auditWritesContinue:true,
    stageVolumeDestroyed:true
  }));
  // Only the application is recreated. Preserve the original PostgreSQL
  // container, volume and exact Compose project across the upgrade.
  docker("up","--detach","--build","--force-recreate","--no-deps","app");
  assert.equal(docker("ps","--quiet","db"),dbBefore,
    "The existing database container must remain unchanged during upgrade");
  let upgraded=false;
  for(let i=0;i<135;i++){
    try{
      const response=await fetch("http://127.0.0.1:"+port+"/health",
        {signal:AbortSignal.timeout(2200)});
      if(response.status===200){upgraded=true;break;}
    }catch{}
    await new Promise(ok=>setTimeout(ok,850));
  }
  if(!upgraded)throw Error("Generated app failed to start after applying V2 migration: "+
    docker("logs","--tail","60","app"));
  assert.deepEqual(snapshot("protocolia"),original,
    "Real V2 startup must preserve the pre-upgrade document, children and audit");
  assert.equal(dbSql("protocolia",
    "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' "+
    "AND table_name='purchase_order' AND column_name='note'"),"1",
    "New optional TypeSpec field must be present in the existing PostgreSQL schema");
  const ledger=afterBuild.target==="nestjs"?
    dbSql("protocolia","SELECT version::text FROM protocolia_nest_migration_history ORDER BY version"):
    dbSql("protocolia","SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank");
  assert.equal(ledger,afterBuild.target==="nestjs"?"2":"1\n2\n3",
    "Version journal must record the next migration after the preserved history");
  const createdAfterUpgrade=await request("POST","/api/orders",{
    code:"POST-V2",title:"Works after migration",note:"Preserved new optional field",
    lines:[{lineCode:"POST-V2-CHILD",product:"New version",units:1}]
  });
  assert.equal(createdAfterUpgrade.status,201,createdAfterUpgrade.body);
  assert.equal(dbSql("protocolia",
    "SELECT note FROM purchase_order WHERE code='POST-V2'"),
    "Preserved new optional field","Regenerated backend must write the new TypeSpec field");
  // A post-upgrade child mutation still needs document-wide If-Match and
  // continues appending journal entries within the same PostgreSQL database.
  const postUpgradeChild=await request("POST","/api/order-lines",{
    lineCode:"AFTER-V2-CHILD",orderCode:"RETAINED",product:"Still writable",units:1
  },{"If-Match":'"2"'});
  assert.equal(postUpgradeChild.status,201,postUpgradeChild.body);
  assert.equal(dbSql("protocolia",
    "SELECT document_version::text FROM purchase_order WHERE code='RETAINED'"),"3");
  assert.equal(dbSql("protocolia",
    "SELECT count(*) FROM order_line WHERE order_code='RETAINED'"),"4");
  assert.ok(Number(dbSql("protocolia",
    "SELECT count(*) FROM protocolia_audit_event "+
    "WHERE resource_id IN ('BEFORE-A','BEFORE-B','BEFORE-C','AFTER-V2-CHILD')"))>
    Number(original.audit));
  const postEvolveSnapshot=snapshot("protocolia");
  const evolutionEvidence={
    generatedTarget:afterBuild.target,
    typeSpecMigrationAfterExistingHistory:true,
    databaseContainerUnchanged:true,
    preexistingRowsPreserved:true,
    preexistingJournalPreserved:true,
    migrationLedgerVersion2:true,
    newFieldPersisted:true,
    postUpgradeAuditedWrite:true,
    versionEtagsContinue:true,
    preflightReportMatchedOldContract:true,
    verifiedEvolutionGate:true,
    mismatchedSqlRejected:true,mismatchedIrRejected:true,
    mismatchedArchiveRejected:true,
    failedOrMissingReportRejected:true
  };
  console.log("PROTOCOLIA_V11_APP_EVOLUTION_PASS "+JSON.stringify(evolutionEvidence));
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
  // Cryptographic regression on the independent restored copy: changing
  // one row's original value WITHOUT changing row count must be detected.
  const {tableSnapshot,verifyRows}=await import("../../packages/cli/database-preflight.mjs");
  const oldDigest=tableSnapshot(dbBefore,restoreDb);
  dbSql(restoreDb,"UPDATE order_line SET product='ALTERED-ROW-CHECK' "+
    "WHERE line_code='BEFORE-A'");
  assert.equal(dbSql(restoreDb,
    "SELECT count(*) FROM order_line WHERE order_code='RETAINED'"),"3",
    "The tampered restore must keep its original row count");
  assert.throws(()=>verifyRows(dbBefore,oldDigest,restoreDb),
    /cryptographic digest differs/,
    "A changed historical value cannot be hidden by unchanged row counts");
  dbSql(restoreDb,"UPDATE order_line SET product='Unchanged' "+
    "WHERE line_code='BEFORE-A'");
  assert.doesNotThrow(()=>verifyRows(dbBefore,oldDigest,restoreDb),
    "Undoing the mutation must recover the exact digest");
  assert.deepEqual(snapshot(restoreDb),original,
    "The isolated tamper test must not alter restored business data");
  const corrupt=join(scratch,"damaged.dump");
  copyFileSync(archive,corrupt);
  copyFileSync(archive+".json",corrupt+".json");
  appendFileSync(corrupt,Buffer.from("tampered"));
  assert.notEqual(run(process.execPath,[appcli,"db:verify",corrupt],
    {cwd:resolve("."),allowFailure:true}),0,"Corrupted archive must fail checksum");
  assert.deepEqual(snapshot("protocolia"),postEvolveSnapshot,
    "Restoring an independent copy must not change the successfully upgraded source");
  console.log("PROTOCOLIA_V11_DB_PREFLIGHT_PASS "+JSON.stringify({
    migrationSqlFromTypeSpec:true,isolatedPostgresNoNetwork:true,
    restoredOldData:true,allExistingRowsPreserved:true,
    sqlDigestBoundToReport:true,cryptographicOldRows:true,
    countPreservingTamperRejected:true,noAutoDeploy:true,
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
  if(stageStarted)try{stageDocker("down","--volumes","--remove-orphans");}
  catch(error){console.error("STAGE_TEST_CLEANUP_FAILED "+error.message);process.exitCode=1;}
  if(started)try{docker("down","--volumes","--remove-orphans");}
  catch(error){console.error("DB_TEST_CLEANUP_FAILED "+error.message);process.exitCode=1;}
  rmSync(scratch,{recursive:true,force:true});
}
