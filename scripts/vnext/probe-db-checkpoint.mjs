#!/usr/bin/env node
// Verify immutable archive, restore into isolated DB, and rehearse additive DDL.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes,generateKeyPairSync,sign,createHash} from "node:crypto";
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
  // v1.1i: exercise exactly the operator-facing staging path. The source DB
  // is never a recipient of the restored archive or its staged writes.
  const stageReceipt=join(scratch,"runtime-stage-receipt.json");
  const stageArgs=[generated,"--checkpoint",archive,"--report",report,
    "--out",stageReceipt];
  const {stageRuntime,verifyStageReceipt,stageOptions}=await import(
    "../../packages/cli/runtime-stage.mjs");
  const receipt=await stageRuntime(stageArgs,{inspect:async({request:stageRequest,sql:stageSql})=>{
    const header=await stageRequest("GET","/api/orders/RETAINED");
    assert.equal(header.status,200,header.body);
    assert.equal(header.etag,'"2"',
      "Staged runtime must retain pre-upgrade document ETag");
    assert.equal(stageSql("SELECT status||':'||document_version::text||':'||title "+
      "FROM purchase_order WHERE code='RETAINED'"),original.header);
    assert.equal(stageSql("SELECT string_agg(line_code||':'||product||':'||units::text,',' "+
      "ORDER BY line_code) FROM order_line WHERE order_code='RETAINED'"),original.rows);
    assert.equal(stageSql("SELECT count(*) FROM protocolia_audit_event "+
      "WHERE resource_id IN ('BEFORE-A','BEFORE-B','BEFORE-C')"),original.audit);
    assert.equal(stageSql("SELECT count(*) FROM information_schema.columns "+
      "WHERE table_schema='public' AND table_name='purchase_order' "+
      "AND column_name='note'"),"1",
      "The staged app must apply its new TypeSpec column");
    const create=await stageRequest("POST","/api/orders",{
      code:"STAGED-NEW",title:"Staged new contract",
      note:"Persisted on isolated restored database",
      lines:[{lineCode:"STAGED-CHILD",product:"Independent",units:1}]
    });
    assert.equal(create.status,201,create.body);
    assert.equal(stageSql("SELECT note FROM purchase_order WHERE code='STAGED-NEW'"),
      "Persisted on isolated restored database");
    const stale=await stageRequest("POST","/api/order-lines",{
      lineCode:"STAGED-STALE",orderCode:"RETAINED",product:"Rejected",units:1
    },{"If-Match":'"1"'});
    assert.equal(stale.status,409);
    const appended=await stageRequest("POST","/api/order-lines",{
      lineCode:"STAGED-APPEND",orderCode:"RETAINED",product:"Audited",units:1
    },{"If-Match":'"2"'});
    assert.equal(appended.status,201,appended.body);
    assert.equal((await stageRequest("GET","/api/orders/RETAINED")).etag,'"3"');
    assert.equal(stageSql("SELECT document_version::text FROM purchase_order "+
      "WHERE code='RETAINED'"),"3");
    assert.ok(Number(stageSql("SELECT count(*) FROM protocolia_audit_event "+
      "WHERE resource_id='STAGED-APPEND'"))>=1);
    assert.equal(stageSql("SELECT count(*) FROM order_line "+
      "WHERE line_code='STAGED-STALE'"),"0");
    assert.equal(docker("ps","--quiet","db"),dbBefore);
    assert.deepEqual(snapshot("protocolia"),original,
      "Staging mutations must not reach the original test database");
  }});
  assert.equal(receipt.stagedVolumeDestroyed,true);
  assert.equal(verifyStageReceipt(stageOptions(stageArgs,{verify:true})).evolvedIrSha256,
    summary.proposedIrSha256);
  const verifiedStage=run(process.execPath,[
    appcli,"db:stage:verify",...stageArgs],{cwd:resolve(".")});
  assert.match(verifiedStage,/PROTOCOLIA_V11_RUNTIME_STAGE_RECEIPT_VERIFIED/);
  assert.equal(docker("ps","--quiet","db"),dbBefore);
  assert.deepEqual(snapshot("protocolia"),original);
  console.log("PROTOCOLIA_V11_STAGED_RUNTIME_PASS "+JSON.stringify({
    target:afterBuild.target,checkpointRestored:true,
    originalDatabaseIsolated:true,stagedAppHealthy:true,
    historicalRowsPreserved:true,migrationLedgerValidated:true,
    newContractFieldPersisted:true,staleWriteRejected:true,
    versionEtagsContinue:true,auditWritesContinue:true,
    stageVolumeDestroyed:true,reusableStageCli:true,receiptVerified:true
  }));
  // v1.1j: reject an image ID or source DB that does not exactly match the
  // snapshot staged in an isolated Compose volume. This is *read only*.
  const sourceArgs=[generated,"--checkpoint",archive,"--report",report,
    "--receipt",stageReceipt,"--project",project,"--env-file",envFile,
    "--assert-writes-paused"];
  const sourceCheck=run(process.execPath,[appcli,"db:source:verify",...sourceArgs],
    {cwd:resolve(".")});
  assert.match(sourceCheck,/PROTOCOLIA_V11_SOURCE_FRESHNESS_PASS/);
  assert.equal(docker("ps","--quiet","db"),dbBefore);
  assert.deepEqual(snapshot("protocolia"),original);
  console.log("PROTOCOLIA_V11_FRESHNESS_BEFORE_UPGRADE_PASS "+JSON.stringify({
    target:afterBuild.target,readOnlySourceVerified:true,
    stagedImageIdentityBound:true,pausedWritesOperatorAsserted:true
  }));
  // v1.1k: an immutable candidate MUST be bound to the tested image and
  // preflight inputs. The precheck is read-only and does not deploy it.
  const candidatePath=join(scratch,"deployment-candidate.json");
  const candidateArgs=[generated,"--checkpoint",archive,"--report",report,
    "--receipt",stageReceipt,"--image",receipt.stagedImageId,
    "--out",candidatePath];
  assert.match(run(process.execPath,[appcli,"deploy:candidate",...candidateArgs],
    {cwd:resolve(".")}),/PROTOCOLIA_V11_DEPLOYMENT_CANDIDATE_PASS/);
  assert.match(run(process.execPath,[appcli,"deploy:candidate:verify",...candidateArgs],
    {cwd:resolve(".")}),/PROTOCOLIA_V11_DEPLOYMENT_CANDIDATE_VERIFIED/);
  const checkArgs=[generated,"--checkpoint",archive,"--report",report,
    "--receipt",stageReceipt,"--candidate",candidatePath,
    "--project",project,"--env-file",envFile,
    "--assert-writes-paused","--approve-image",receipt.stagedImageId];
  assert.notEqual(run(process.execPath,[appcli,"deploy:precheck",
    ...checkArgs.slice(0,-1),"sha256:"+"f".repeat(64)],
    {cwd:resolve("."),allowFailure:true}),0,
    "A mismatched, explicitly approved image must fail closed");
  const precheck=run(process.execPath,[appcli,"deploy:precheck",...checkArgs],
    {cwd:resolve(".")});
  assert.match(precheck,/PROTOCOLIA_V11_DEPLOYMENT_PRECHECK_PASS/);
  assert.equal(docker("ps","--quiet","db"),dbBefore);
  assert.deepEqual(snapshot("protocolia"),original);
  console.log("PROTOCOLIA_V11_DEPLOY_CANDIDATE_PRECHECK_PASS "+JSON.stringify({
    target:afterBuild.target,immutableLocalImage:true,
    sourceCheckpointUnchanged:true,readOnly:true,
    candidateVerified:true,operatorImageAssertion:true
  }));
  // v1.1l: restore the OLD runtime into an independently named, disposable
  // Compose project/PG volume and simulate an outage/restart there. No rollback
  // ever touches the source DB, including after a successful migration.
  const recoveryReport=join(scratch,"old-runtime-recovery.json");
  const recoveryArgs=[generated,"--checkpoint",archive,"--report",report,
    "--receipt",stageReceipt,"--candidate",candidatePath,
    "--out",recoveryReport];
  assert.match(run(process.execPath,[appcli,"deploy:recovery:drill",...recoveryArgs],
    {cwd:resolve("."),timeout:600000}),/PROTOCOLIA_V11_ISOLATED_RECOVERY_PASS/,
    "Old runtime must start on a freshly restored copy and recover from an injected outage");
  assert.match(run(process.execPath,[appcli,"deploy:recovery:verify",...recoveryArgs],
    {cwd:resolve(".")}),/PROTOCOLIA_V11_RECOVERY_RECEIPT_VERIFIED/);
  assert.equal(docker("ps","--quiet","db"),dbBefore);
  assert.deepEqual(snapshot("protocolia"),original,
    "Recovery drill must never alter the original PostgreSQL");
  const {pinnedOverlay,ephemeralCutoverProject}=await import(
    "../../packages/cli/cutover-recovery.mjs");
  ephemeralCutoverProject(project);
  assert.throws(()=>ephemeralCutoverProject("production"),/Recovery rehearsal refused/);
  assert.throws(()=>pinnedOverlay("latest"),/Recovery rehearsal refused/);
  const cutoverOverlay=join(scratch,"one-shot-pinned-cutover.yaml");
  assert.match(run(process.execPath,[appcli,"deploy:migrator:overlay",
    generated,"--target",afterBuild.target,"--image",receipt.stagedImageId,
    "--project",project,"--out",cutoverOverlay],{cwd:resolve(".")}),
    /PROTOCOLIA_V11_ONE_SHOT_OVERLAY_READY/);
  assert.equal(statSync(cutoverOverlay).mode&0o077,0);
  const pinnedCompose=[...compose,"-f",join(generated,"compose.yaml"),
    "-f",cutoverOverlay];
  run("docker",[...pinnedCompose,"config","--quiet"]);
  console.log("PROTOCOLIA_V11_RECOVERY_DRILL_PASS "+JSON.stringify({
    target:afterBuild.target,oldImageRestored:true,
    injectedOutageRecovered:true,noSourceDatabaseMutation:true,
    recoveryVolumeDestroyed:true,exactCandidatePinned:true
  }));
  // v1.1m: a separately generated test signer authorizes ONLY this
  // uniquely named disposable CI project, exact candidate and successful
  // old-runtime recovery. Product tooling never issues/private-keys permits.
  const {publicKey:operatorKey,privateKey:operatorSecret}=generateKeyPairSync("ed25519");
  const operatorPublic=join(scratch,"trusted-operator.pem");
  writeFileSync(operatorPublic,operatorKey.export({format:"pem",type:"spki"}),
    {mode:0o644,flag:"wx"});
  const hash=b=>createHash("sha256").update(b).digest("hex");
  const keyPin=hash(operatorKey.export({format:"der",type:"spki"}));
  const issued=Date.now();
  const permitClaims={
    audience:"protocolia-disposable-cutover-v1",project,
    imageId:receipt.stagedImageId,checkpointSha256:receipt.checkpointSha256,
    candidateSha256:hash(readFileSync(candidatePath)),
    recoverySha256:hash(readFileSync(recoveryReport)),
    issuedAt:new Date(issued).toISOString(),
    expiresAt:new Date(issued+12*60_000).toISOString(),
    nonce:randomBytes(20).toString("hex")
  };
  const permitPath=join(scratch,"signed-disposable-approval.json");
  writeFileSync(permitPath,JSON.stringify({schema:1,algorithm:"Ed25519",
    claims:permitClaims,
    signature:sign(null,Buffer.from(JSON.stringify(permitClaims)),
      operatorSecret).toString("base64")
  }),{mode:0o600,flag:"wx"});
  const permitArgs=[generated,"--checkpoint",archive,"--report",report,
    "--receipt",stageReceipt,"--candidate",candidatePath,
    "--recovery",recoveryReport,"--project",project,
    "--permit",permitPath,"--public-key",operatorPublic,"--key-sha256",keyPin];
  assert.notEqual(run(process.execPath,[appcli,"deploy:permit:verify",
    ...permitArgs.slice(0,-1),"f".repeat(64)],
    {cwd:resolve("."),allowFailure:true}),0,
    "Wrong out-of-band signer SPKI fingerprint must fail closed");
  assert.notEqual(run(process.execPath,[appcli,"deploy:permit:verify",
    ...permitArgs.slice(0,12),"pia_ckpt_deadbeef00",...permitArgs.slice(13)],
    {cwd:resolve("."),allowFailure:true}),0,
    "Cross-project signed approval reuse must fail closed");
  const verifiedPermit=run(process.execPath,[appcli,"deploy:permit:verify",...permitArgs],
    {cwd:resolve(".")});
  assert.match(verifiedPermit,/PROTOCOLIA_V11_DISPOSABLE_PERMIT_PASS/,
    "Test cutover requires independently signed scoped permit");
  // A stopped app cannot accept new writes via its HTTP API. This limits
  // the bounded CI project; NOT a durable PostgreSQL write lock in prod.
  const oldAppContainer=docker("ps","--quiet","app");
  assert.match(oldAppContainer,/^[a-f0-9]{12,64}$/i);
  docker("stop","app");
  assert.equal(docker("ps","--quiet","app"),"");
  const fenceArgs=[generated,"--project",project,"--env-file",envFile,
    "--old-app-id",oldAppContainer,"--db-id",dbBefore];
  let fenced=false;
  for(let attempt=0;attempt<12;attempt++){
    const ok=run(process.execPath,[appcli,"deploy:fence:verify",...fenceArgs],
      {cwd:resolve("."),allowFailure:true});
    if(ok===0){fenced=true;break;}
    await new Promise(ok=>setTimeout(ok,300));
  }
  assert.equal(fenced,true,
    "Old app must be stopped and all other SQL client sessions gone");
  const fencedFreshness=run(process.execPath,[appcli,"deploy:precheck",...checkArgs],
    {cwd:resolve(".")});
  assert.match(fencedFreshness,/PROTOCOLIA_V11_DEPLOYMENT_PRECHECK_PASS/);
  assert.equal(docker("ps","--quiet","db"),dbBefore);
  assert.deepEqual(snapshot("protocolia"),original);
  console.log("PROTOCOLIA_V11_SIGNED_FENCED_CUTOVER_READY "+JSON.stringify({
    target:afterBuild.target,independentSignedEd25519Permit:true,
    pinnedSignerKey:true,disposableProjectOnly:true,
    oldAppActuallyStopped:true,noOtherSqlClientSessions:true,
    freshSourceWhileStopped:true
  }));
  // v1.1n: server-level DB connection barrier, not merely zero observed SQL
  // sessions. Its durable ledger in the SEPARATE postgres maintenance DB
  // consumes a signed nonce once. Only this disposable pia_ckpt_* is allowed.
  // v1.1o: only the temporary CI project obtains distinct external SQL
  // reader/writer identities. Both start NOLOGIN. The app's privileged
  // migration account remains unchanged until a later dedicated milestone.
  const externalCredentials=join(scratch,"disposable-external-roles.json");
  const roleArgs=[...permitArgs,"--env-file",envFile,
    "--old-app-id",oldAppContainer,"--db-id",dbBefore,
    "--credentials",externalCredentials];
  const prepared=run(process.execPath,[appcli,"deploy:roles:prepare",...roleArgs],
    {cwd:resolve(".")});
  assert.match(prepared,/PROTOCOLIA_V11_EXTERNAL_ROLES_PREPARED/);
  assert.equal(docker("ps","--quiet","db"),dbBefore);
  // v1.1p: runtime application SQL identity MUST be separate from the
  // privileged migration connection. Generate and grant a non-superuser
  // role only in this disposable, signed and stopped-app Compose project.
  const runtimeCredentialsPath=join(scratch,"app-runtime-credentials.json");
  const runtimePrepareArgs=[...permitArgs,"--env-file",envFile,
    "--old-app-id",oldAppContainer,"--db-id",dbBefore,
    "--credentials",runtimeCredentialsPath];
  const runtimeReady=run(process.execPath,[appcli,"deploy:runtime:prepare",...runtimePrepareArgs],
    {cwd:resolve(".")});
  assert.match(runtimeReady,/PROTOCOLIA_V11_RUNTIME_PRINCIPAL_READY/);
  const runtimeCredential=JSON.parse(readFileSync(runtimeCredentialsPath,"utf8"));
  assert.equal(runtimeCredential.role,"protocolia_app_runtime");
  assert.equal(statSync(runtimeCredentialsPath).mode&0o077,0);
  // Only subsequent starts read these new env values; the original app has
  // been stopped and the DB is not yet changed. Flyway and Nest migrate with
  // their own explicit principal and the same reviewed TypeSpec SQL.
  appendFileSync(envFile,[
    "PROTOCOLIA_RUNTIME_DB_USER="+runtimeCredential.role,
    "PROTOCOLIA_RUNTIME_DB_PASSWORD="+runtimeCredential.password,
    "PROTOCOLIA_MIGRATION_DB_USER=protocolia",
    "PROTOCOLIA_MIGRATION_DB_PASSWORD="+
      readFileSync(envFile,"utf8").match(/^PROTOCOLIA_DB_PASSWORD=(.+)$/m)[1]
  ].join("\n")+"\n");
  const runtimeRoleState=dbSql("postgres",
    "SELECT (NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb)::text FROM pg_roles "+
    "WHERE rolname='protocolia_app_runtime'");
  assert.equal(runtimeRoleState,"true",
    "Request-time SQL principal must not be a PostgreSQL superuser");
  assert.notEqual(run("docker",[...compose,"exec","-T","db","psql","-X",
    "-U","protocolia_app_runtime","-d","protocolia",
    "-v","ON_ERROR_STOP=1","-c","CREATE TABLE public.disallowed_runtime_ddl(id int)"],
    {cwd:generated,allowFailure:true}),0,
    "Runtime account must not have CREATE privilege on application schema");
  console.log("PROTOCOLIA_V11_SQL_PRINCIPALS_PREPARED "+JSON.stringify({
    target:afterBuild.target,runtimeRole:"protocolia_app_runtime",
    runtimeNonSuperuser:true,ddlDenied:true,
    privilegedMigrationPrincipal:"protocolia"
  }));
  const gateArgs=[...permitArgs,"--env-file",envFile,
    "--old-app-id",oldAppContainer,"--db-id",dbBefore];
  const engageGate=run(process.execPath,[appcli,"deploy:db-gate:engage",...gateArgs],
    {cwd:resolve(".")});
  assert.match(engageGate,/PROTOCOLIA_V11_DB_GATE_ENGAGED/);
  const closedStatus=docker("exec","-T","db","psql","-U","protocolia","-d","postgres",
    "-At","-c","SELECT datallowconn::text FROM pg_database WHERE datname='protocolia'");
  assert.equal(closedStatus,"false",
    "PostgreSQL itself must reject all new protocolia DB connections");
  assert.notEqual(run("docker",[...compose,"exec","-T","db","psql",
    "-U","protocolia","-d","protocolia","-c","SELECT 1"],
    {cwd:generated,allowFailure:true}),0,
    "Even the configured PostgreSQL superuser must not reconnect during server gate");
  const opened=run(process.execPath,[appcli,"deploy:db-gate:release",...gateArgs],
    {cwd:resolve(".")});
  assert.match(opened,/PROTOCOLIA_V11_DB_GATE_RELEASED/);
  assert.notEqual(run(process.execPath,[appcli,"deploy:db-gate:engage",...gateArgs],
    {cwd:resolve("."),allowFailure:true}),0,
    "The same signed nonce must never be spent a second time, even after release");
  assert.notEqual(run(process.execPath,[appcli,"deploy:db-gate:release",...gateArgs],
    {cwd:resolve("."),allowFailure:true}),0,
    "A consumed permit cannot release a second gate");
  assert.equal(docker("ps","--quiet","db"),dbBefore);
  assert.deepEqual(snapshot("protocolia"),original,
    "Engage/release DB connection gate must not modify domain rows or schema");
  // After re-opening the DB for migration, an independent EXTERNAL writer
  // still cannot authenticate: NOLOGIN survives the gate release until the
  // exact-image new app is independently healthy and verified.
  assert.match(run(process.execPath,[appcli,"deploy:roles:blocked",...roleArgs],
    {cwd:resolve(".")}),/PROTOCOLIA_V11_EXTERNAL_ROLES_BLOCKED/);
  console.log("PROTOCOLIA_V11_SERVER_WRITE_GATE_PASS "+JSON.stringify({
    target:afterBuild.target,serverConnectionsBlocked:true,
    superuserReconnectRejected:true,nonceDurablyConsumed:true,
    replayEngageRejected:true,replayReleaseRejected:true,
    originalBusinessRowsUnchanged:true
  }));
  // Run the privileged migrator in a SEPARATE ephemeral container, from
  // the SAME staged image. It must exit successfully before starting HTTP.
  // v1.1r: prove failure before transactional commit leaves no V2 SQL, then
  // failure AFTER SQL commit but BEFORE handoff leaves a valid ledger without
  // authorizing the HTTP runtime. Both failures must be retry-safe.
  const isNest=afterBuild.target==="nestjs";
  const migrationLedger=isNest?"protocolia_nest_migration_history":"flyway_schema_history";
  // Nest has an additive V2; Spring preserves baseline V1 and BFF V2,
  // so its NEXT additive migration is V3, not the existing V2.
  const additiveVersion=isNest?"2":"3";
  const ledgerVersion=isNest?"version=2":"version='3' AND success=true";
  const v2Count=()=>dbSql("protocolia","SELECT count(*) FROM public."+
    migrationLedger+" WHERE "+ledgerVersion);
  if(!isNest)
    assert.equal(dbSql("protocolia",
      "SELECT count(*) FROM flyway_schema_history WHERE version='2' AND success"),"1",
      "Spring historical BFF V2 migration must exist before applying additive V3");
  const v2Column=()=>dbSql("protocolia",
    "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' "+
    "AND table_name='purchase_order' AND column_name='note'");
  const handoffTable=()=>dbSql("protocolia",
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "+
    "AND table_name='protocolia_migration_handoff_v1'");
  const assertFailedRun=(args,expect,timeout=600000)=>{
    const processResult=spawnSync("docker",args,{cwd:generated,encoding:"utf8",
      timeout,maxBuffer:4*1024*1024});
    assert.equal(processResult.error,undefined,
      "A failed migration must terminate; hanging/timeout is not a valid fault result");
    assert.notEqual(processResult.status,0,"Fault injection must fail closed");
    assert.match((processResult.stdout??"")+(processResult.stderr??""),expect,
      "Expected deliberate migration fault, not an unrelated deployment failure");
  };
  const beforeFailpoint=isNest?"before-commit":"before-migrate";
  const afterFailpoint=isNest?"after-commit":"after-migrate";
  assert.equal(v2Count(),"0","No V2 ledger before migration");
  assert.equal(v2Column(),"0","No V2 column before migration");
  assertFailedRun([...pinnedCompose,"run","--rm","--no-deps",
    "-e","PROTOCOLIA_MIGRATION_FAILPOINT="+beforeFailpoint,"migrate"],
    /PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_BEFORE_COMMIT/);
  assert.equal(v2Count(),"0","Aborted uncommitted migration cannot create a V2 ledger row");
  assert.equal(v2Column(),"0","Aborted uncommitted migration cannot persist V2 SQL");
  assert.equal(handoffTable(),"0","No migration handoff on pre-commit failure");
  assert.equal(docker("ps","--quiet","app"),"",
    "HTTP server must remain stopped after failed one-shot migration");
  assertFailedRun([...pinnedCompose,"run","--rm","--no-deps",
    "-e","PROTOCOLIA_MIGRATION_FAILPOINT="+afterFailpoint,"migrate"],
    /PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_AFTER_COMMIT/);
  assert.equal(v2Count(),"1","Committed V2 ledger must survive a post-commit process failure");
  assert.equal(v2Column(),"1","Committed V2 DDL must survive a post-commit process failure");
  assert.equal(handoffTable(),"0",
    "A committed migration with an interrupted completion signal cannot authorize HTTP");
  assertFailedRun([...pinnedCompose,"run","--rm","--no-deps","app"],
    /migration.handoff|handoff_v1|relation .*does not exist|relation .*not exist/i,90000);
  assert.equal(docker("ps","--quiet","app"),"",
    "Failed HTTP handoff must not start long-running application service");
  assert.deepEqual(snapshot("protocolia"),original,
    "Fault injection and failed HTTP must leave original rows/audit unchanged");
  console.log("PROTOCOLIA_V11_MIGRATION_FAULTS_REJECTED "+JSON.stringify({
    target:afterBuild.target,rollbackBeforeCommit:true,
    committedSchemaWithoutHandoffRejected:true,oldRowsUnchanged:true,
    httpNotStartedAfterFault:true
  }));
  const oneShot=run("docker",[...pinnedCompose,"run","--rm","--no-deps","migrate"],
    {cwd:generated,timeout:600000});
  const expectedMigrationMarker=afterBuild.target==="nestjs"?
    "PROTOCOLIA_NEST_ONE_SHOT_MIGRATION_PASS":
    "PROTOCOLIA_SPRING_ONE_SHOT_MIGRATION_PASS";
  assert.match(oneShot,new RegExp(expectedMigrationMarker),
    "Independent migrator must finish before request-serving app starts");
  assert.equal(v2Count(),"1","Successful retry cannot duplicate the migration ledger");
  assert.equal(v2Column(),"1","Successful retry cannot duplicate the V2 field");
  assert.equal(handoffTable(),"1","Successful retry must publish a runtime-readable completion gate");
  assert.equal(dbSql("protocolia",
    "SELECT count(*) FROM public.protocolia_migration_handoff_v1 WHERE image_digest='"+
    receipt.stagedImageId.slice(7)+"'"),"1",
    "Runtime handoff must bind exactly to the staged immutable image");
  const retryAgain=run("docker",[...pinnedCompose,"run","--rm","--no-deps","migrate"],
    {cwd:generated,timeout:600000});
  assert.match(retryAgain,new RegExp(expectedMigrationMarker));
  assert.equal(v2Count(),"1","Second successful migrator invocation must be idempotent");
  assert.equal(dbSql("protocolia",
    "SELECT count(*) FROM public.protocolia_migration_handoff_v1 WHERE image_digest='"+
    receipt.stagedImageId.slice(7)+"'"),"1",
    "Second successful migrator invocation cannot duplicate completed handoff");
  console.log("PROTOCOLIA_V11_MIGRATION_RETRY_SAFE_PASS "+JSON.stringify({
    target:afterBuild.target,version2JournalExactlyOnce:true,
    migrationHandoffBoundToImage:true,
    retryAfterPostCommitFaultSafe:true,repeatedSuccessfulMigrationNoop:true
  }));
  assert.equal(docker("ps","--quiet","app"),"",
    "No request-serving app may start before approved one-shot migration exits");
  console.log("PROTOCOLIA_V11_ONE_SHOT_MIGRATION_PASS "+JSON.stringify({
    target:afterBuild.target,exactStagedImage:receipt.stagedImageId,
    separateContainerCompleted:true,appStayedStoppedDuringMigration:true
  }));
  // Only the application is recreated. Preserve the original PostgreSQL
  // container, volume and exact Compose project across the upgrade.
  // NO --build, NO pull, NO mutable tag: start exactly the staged image.
  run("docker",[...pinnedCompose,"up","--detach","--no-build",
    "--no-deps","--force-recreate","app"]);
  // Verify actual generated app environment, not merely a successful DML.
  const appForPrincipal=docker("ps","--quiet","app");
  const envProof=run("docker",["inspect","--format","{{range .Config.Env}}{{println .}}{{end}}",appForPrincipal]);
  assert.match(envProof,/PROTOCOLIA_JDBC_USER=protocolia_app_runtime/);
  assert.match(envProof,/PROTOCOLIA_EXECUTION_MODE=runtime/);
  assert.doesNotMatch(envProof,/PROTOCOLIA_MIGRATION_JDBC_USER=protocolia(?:\\r?\\n|$)/,
    "Runtime must not receive migration SQL user");
  assert.doesNotMatch(envProof,/PROTOCOLIA_MIGRATION_JDBC_PASSWORD=[^\\r\\n]+/,
    "Runtime must not receive a privileged migration SQL password");
  assert.doesNotMatch(envProof,/PROTOCOLIA_JDBC_USER=protocolia(?:\\r?\\n|$)/,
    "Runtime cannot use privileged migration role");
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
  assert.notEqual(run(process.execPath,[appcli,"db:source:verify",...sourceArgs],
    {cwd:resolve("."),allowFailure:true}),0,
    "After the schema upgrade and new writes, the original checkpoint must be stale");
  assert.notEqual(run(process.execPath,[appcli,"deploy:precheck",...checkArgs],
    {cwd:resolve("."),allowFailure:true}),0,
    "Previously approved deployment candidate must reject the changed original database");
  // Observe the *actually running* post-upgrade image, without deploying or
  // restarting it. A rebuild may differ from the staged image and MUST NOT
  // be treated as an approved cutover merely because /health is green.
  const appContainer=docker("ps","--quiet","app");
  assert.match(appContainer,/^[0-9a-f]{12,64}$/i);
  const runningImage=run("docker",["inspect","--format","{{.Image}}",appContainer]);
  const postArgs=[generated,"--checkpoint",archive,"--report",report,
    "--receipt",stageReceipt,"--candidate",candidatePath,
    "--project",project,"--env-file",envFile,
    "--health-url","http://127.0.0.1:"+port+"/health"];
  const observed=run(process.execPath,[appcli,"deploy:postcheck",...postArgs],
    {cwd:resolve("."),allowFailure:runningImage!==receipt.stagedImageId});
  assert.equal(runningImage,receipt.stagedImageId,
    "Pinned test cutover must run the EXACT previously staged image ID");
  assert.match(observed,/PROTOCOLIA_V11_DEPLOYMENT_POSTCHECK_PASS/,
    "Exact staged image must be healthy after original test-app restart");
  assert.match(run(process.execPath,[appcli,"deploy:roles:activate",...roleArgs,
    "--health-url","http://127.0.0.1:"+port+"/health"],{cwd:resolve(".")}),
    /PROTOCOLIA_V11_EXTERNAL_ROLES_ACTIVATED/,
    "External DB clients must be activated only after exact-image health and permission checks");
  // The request-time user must be unable to modify migration journals,
  // despite supporting writes/audited mutations through the generated APIs.
  const roleHistory=afterBuild.target==="nestjs"?
    "protocolia_nest_migration_history":"flyway_schema_history";
  assert.notEqual(run("docker",[...compose,"exec","-T","db","psql","-X",
    "-U","protocolia_app_runtime","-d","protocolia",
    "-v","ON_ERROR_STOP=1","-c","SELECT * FROM public."+roleHistory],
    {cwd:generated,allowFailure:true}),0,
    "Runtime role must never access the migration ledger");
  console.log("PROTOCOLIA_V11_RUNTIME_SECRET_ISOLATION_PASS "+JSON.stringify({
    target:afterBuild.target,oneShotMigrationExitedBeforeRuntime:true,
    privilegedMigrationCredentialsAbsentFromRuntime:true,
    dbRoleNonSuperuser:true,originalDbContainerPreserved:true
  }));
  console.log("PROTOCOLIA_V11_SPLIT_DB_PRINCIPALS_PASS "+JSON.stringify({
    target:afterBuild.target,runtimePrincipal:"protocolia_app_runtime",
    migrationPrincipal:"protocolia",runtimeIsNonSuperuser:true,
    runtimeDdlRejected:true,runtimeMigrationJournalReadRejected:true,
    additiveMigrationApplied:true,newBusinessWritesAudited:true
  }));
  console.log("PROTOCOLIA_V11_ROLE_SEPARATION_PASS "+JSON.stringify({
    target:afterBuild.target,externalReaderSelectOnly:true,
    readerDmlRejected:true,externalWriterBlockedAfterDbReopen:true,
    writerActivatedOnlyAfterVerifiedHealth:true,oldDbContainerPreserved:true,
    generatedAppStillUsesPrivilegedMigrationAccount:true
  }));
  console.log("PROTOCOLIA_V11_DEPLOY_POSTCHECK_GUARD_PASS "+JSON.stringify({
    target:afterBuild.target,
    runningImageEqualsStaged:true,
    actualImageChecked:true,unapprovedRebuildRejected:true,
    cutoverNoBuild:true,
    sourceDatabaseContainerUnchanged:docker("ps","--quiet","db")===dbBefore
  }));
  console.log("PROTOCOLIA_V11_STALE_SOURCE_REJECTED "+JSON.stringify({
    target:afterBuild.target,postUpgradeDriftDetected:true
  }));
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
  if(started)try{docker("down","--volumes","--remove-orphans");}
  catch(error){console.error("DB_TEST_CLEANUP_FAILED "+error.message);process.exitCode=1;}
  rmSync(scratch,{recursive:true,force:true});
}
