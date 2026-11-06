#!/usr/bin/env node
// R4 verified checkpoint/recovery drill. CI-owned disposable Docker projects
// only. No production credentials, external databases, deploy or cutover.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,
  chmodSync,openSync,closeSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {verifyApp} from "../../packages/cli/ownership.mjs";
import {verifyCheckpoint} from "../../packages/cli/database-checkpoint.mjs";

const app=resolve(process.argv[2]??"");
const target=process.argv[3];
assert.ok(["nestjs","modular-spring"].includes(target),"Expected generated target");
const beforeBuild=JSON.parse(readFileSync(join(app,"protocolia-build.json"),"utf8"));
assert.equal(beforeBuild.target,target);
assert.equal(beforeBuild.passport?.status,"GENERATED_PORTABLE_INTEGRITY_ONLY");
verifyApp(app);
const tmp=mkdtempSync(join(tmpdir(),"pia-r4-verified-"));
const project="pia_ckpt_"+randomBytes(5).toString("hex");
const restoreName="pia_r4_restore_"+randomBytes(6).toString("hex");
const volumeName="pia_r4_volume_"+randomBytes(6).toString("hex");
const env=join(tmp,"disposable.env"),archive=join(tmp,"checkpoint.dump");
const report=join(tmp,"rehearsal.json"),source=join(tmp,"extracted-typespec");
const cli=resolve("packages/cli/protocolia.mjs");
const exercise=resolve("scripts/research/r4-evolution-exercise.mjs");
const localEnv={
  ...process.env,PROTOCOLIA_MANAGER_PASSWORD:"r4-"+randomBytes(16).toString("hex"),
  PROTOCOLIA_READER_PASSWORD:"r4-"+randomBytes(16).toString("hex")
};
const compose=["compose","--project-name",project,"--env-file",env];
writeFileSync(env,[
  "PROTOCOLIA_DB_PASSWORD="+randomBytes(18).toString("hex"),
  "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
  "PROTOCOLIA_AUTH_MODE=demo",
  "PROTOCOLIA_MANAGER_USERNAME=manager",
  "PROTOCOLIA_MANAGER_PASSWORD="+localEnv.PROTOCOLIA_MANAGER_PASSWORD,
  "PROTOCOLIA_READER_USERNAME=reader",
  "PROTOCOLIA_READER_PASSWORD="+localEnv.PROTOCOLIA_READER_PASSWORD,
  "PROTOCOLIA_HOST_PORT=8080"
].join("\n")+"\n",{mode:0o600,flag:"wx"});

function execute(bin,args,{cwd=resolve("."),envVars=localEnv,allowFailure=false,
  timeout=600000,stdin}={}){
  const proc=spawnSync(bin,args,{cwd,env:envVars,timeout,
    encoding:"utf8",maxBuffer:8*1024*1024,
    stdio:[stdin??"ignore","pipe","pipe"]});
  if(proc.error&&!allowFailure)throw proc.error;
  if(!allowFailure&&proc.status!==0)
    throw Error(bin+" "+args.slice(0,6).join(" ")+" failed ("+proc.status+"): "+
      (proc.stderr??"").slice(-1600)+"\n"+(proc.stdout??"").slice(-1200));
  return allowFailure?{status:proc.status,stdout:proc.stdout,stderr:proc.stderr}:
    (proc.stdout??"").trim();
}
const docker=(...args)=>execute("docker",args);
const dc=(...args)=>execute("docker",[...compose,...args],{cwd:app});
const protocol=(...args)=>execute(process.execPath,[cli,...args]);
const dbQuery=(sql)=>dc("exec","-T","db","psql","-X","-U","protocolia",
  "-d","protocolia","-v","ON_ERROR_STOP=1","-At","-c",sql);
const tableRows=()=>{
  return dbQuery("SELECT code||':'||name||':'||quantity::text FROM tool ORDER BY code");
};
function verifyPortable(){
  execute(process.execPath,[join(app,"protocolia-contract-source-verify.mjs"),
    "verify",join(app,"protocolia-contract-source"),join(app,"protocolia-contract-source.lock.json")]);
  execute(process.execPath,[join(app,"protocolia-passport-verify.mjs"),
    "verify","--ir",join(app,"protocolia-contract-ir.json"),"--out",join(app,"passport")]);
  verifyApp(app);
}
async function ready(){
  for(let attempt=0;attempt<120;attempt++){
    try{
      const res=await fetch("http://127.0.0.1:8080/health",
        {signal:AbortSignal.timeout(2000)});
      if(res.status===200)return;
    }catch{}
    await new Promise(ok=>setTimeout(ok,800));
  }
  throw Error("Expected disposable Compose application HTTP /health");
}
async function recoveredReady(){
  for(let i=0;i<95;i++){
    // The official PostgreSQL image temporarily accepts local connections
    // during initdb, then restarts. Do not restore until the FINAL service.
    const logs=execute("docker",["logs",restoreName],{allowFailure:true,timeout:15000});
    const initialized=logs.status===0&&
      (String(logs.stderr??"")+String(logs.stdout??""))
        .includes("PostgreSQL init process complete; ready for start up.");
    const r=initialized?execute("docker",["exec",restoreName,"psql","-X","-U","protocolia",
      "-d","protocolia","-At","-c","SELECT 1"],{allowFailure:true,timeout:15000}):
      {status:1};
    if(r.status===0)return;
    await new Promise(ok=>setTimeout(ok,700));
  }
  throw Error("Isolated recovered database did not become ready");
}
const recoveredRows=()=>docker("exec",restoreName,"psql","-X","-U","protocolia",
  "-d","protocolia","-At","-c",
  "SELECT code||':'||name||':'||quantity::text FROM tool ORDER BY code");
const recoveredColumn=()=>docker("exec",restoreName,"psql","-X","-U","protocolia",
  "-d","protocolia","-At","-c",
  "SELECT count(*) FROM information_schema.columns "+
  "WHERE table_schema='public' AND table_name='tool' AND column_name='service_note'");
let sourceStarted=false,restoredCreated=false,volumeCreated=false;
try{
  dc("config","--quiet");
  sourceStarted=true;
  dc("up","--detach","--build");
  await ready();
  execute(process.execPath,[exercise,"seed"],{envVars:localEnv});
  const oldRows=tableRows();
  assert.equal(oldRows,"R4-T1:Torque wrench:7\nR4-T2:Diagnostic probe:11");
  const dbId=dc("ps","--quiet","db");
  assert.match(dbId,/^[0-9a-f]{12,64}$/);

  // A real, generated and sealed Compose project is the backup origin.
  const options=["db:checkpoint",app,"--project",project,"--env-file",env,"--out",archive];
  assert.match(protocol(...options),/PROTOCOLIA_DB_CHECKPOINT_CREATED/);
  const verified=verifyCheckpoint(archive);
  assert.equal(verified.target,target);
  assert.equal(verified.contractSha256,beforeBuild.contractSha256);
  assert.equal(verified.composeProject,project);
  assert.notEqual(execute(process.execPath,[cli,...options],{allowFailure:true}).status,0,
    "An existing checkpoint must never be overwritten");

  // Integrity failure must prevent even an isolated restore/preflight.
  const damaged=join(tmp,"damaged.dump");
  const bytes=readFileSync(archive);
  const wrong=Buffer.from(bytes);
  wrong[wrong.length-1]^=1;
  writeFileSync(damaged,wrong,{mode:0o600});
  writeFileSync(damaged+".json",readFileSync(archive+".json"),{mode:0o600});
  assert.throws(()=>verifyCheckpoint(damaged),/checksum|format/);

  mkdirSync(source);
  cpSync(join(app,"protocolia-contract-source","contracts"),join(source,"contracts"),{recursive:true});
  cpSync(join(app,"protocolia-contract-source","tspconfig.yaml"),join(source,"tspconfig.yaml"));
  execute(process.execPath,[join(app,"protocolia-contract-source-verify.mjs"),
    "verify",source,join(app,"protocolia-contract-source.lock.json")]);
  execute(process.execPath,[exercise,"prepare",source]);

  const preflight=protocol("db:preflight",source,app,"--checkpoint",archive,"--report",report);
  assert.match(preflight,/PROTOCOLIA_DB_PREFLIGHT_PASS/);
  const evidence=JSON.parse(readFileSync(report,"utf8"));
  assert.equal(evidence.status,"pass");
  assert.equal(evidence.isolatedNetwork,"none");
  assert.equal(evidence.originDatabaseAccess,false);
  assert.ok(evidence.rowsChecked>=2&&evidence.tablesChecked>=1);
  assert.equal(evidence.checkpointSha256,verified.archiveSha256);
  assert.equal(dc("ps","--quiet","db"),dbId);
  assert.equal(tableRows(),oldRows,"Offline preflight touched original data");

  // The exact preflight may not be substituted with a forged review.
  const wrongReport=join(tmp,"wrong-report.json");
  writeFileSync(wrongReport,JSON.stringify({...evidence,
    proposedSqlSha256:"0".repeat(64)}),{mode:0o600});
  const initialBuild=readFileSync(join(app,"protocolia-build.json"));
  assert.notEqual(execute(process.execPath,[cli,"evolve:verified",source,app,
    "--checkpoint",archive,"--report",wrongReport],{allowFailure:true}).status,0);
  assert.deepEqual(readFileSync(join(app,"protocolia-build.json")),initialBuild);
  verifyPortable();
  assert.equal(tableRows(),oldRows);

  const evolved=protocol("evolve:verified",source,app,
    "--checkpoint",archive,"--report",report);
  assert.match(evolved,/PROTOCOLIA_EVOLUTION_PREFLIGHT_VERIFIED/);
  assert.match(evolved,/PROTOCOLIA_EVOLUTION_APPLIED/);
  verifyPortable();
  const newBuild=JSON.parse(readFileSync(join(app,"protocolia-build.json"),"utf8"));
  assert.equal(newBuild.passport.contractSource.contractSha256,newBuild.contractSha256);
  assert.notEqual(newBuild.contractSha256,beforeBuild.contractSha256);
  assert.equal(dc("ps","--quiet","db"),dbId,"Verified code update replaced source DB");
  assert.equal(tableRows(),oldRows,"Code upgrade alone modified original rows");

  // Recreate ONLY the app container, using the existing Compose DB and its
  // exact container/volume identity. Schema migrates on next app startup.
  dc("up","--detach","--build","--no-deps","app");
  await ready();
  execute(process.execPath,[exercise,"verify"],{envVars:localEnv});
  const afterRows=tableRows();
  assert.equal(afterRows,
    "R4-T1:Torque wrench:9\nR4-T2:Diagnostic probe:11\nR4-T3:Current clamp:4");
  assert.equal(dc("ps","--quiet","db"),dbId);
  assert.equal(dbQuery("SELECT service_note FROM tool WHERE code='R4-T3'"),
    "Verified after handoff");

  // Restore the PRE-UPGRADE checkpoint into a separate, network-disabled
  // database with its own volume. Never restore into the source Compose DB.
  docker("volume","create",volumeName);volumeCreated=true;
  docker("run","--detach","--name",restoreName,"--network","none",
    "--env","POSTGRES_DB=protocolia","--env","POSTGRES_USER=protocolia",
    "--env","POSTGRES_PASSWORD="+randomBytes(20).toString("hex"),
    "--volume",volumeName+":/var/lib/postgresql/data","postgres:16.15-alpine");
  restoredCreated=true;
  await recoveredReady();
  const fd=openSync(archive,"r");
  try{
    execute("docker",["exec","-i",restoreName,"pg_restore","-U","protocolia",
      "-d","protocolia","--no-owner","--no-acl","--exit-on-error",
      "--single-transaction"],{stdin:fd,timeout:600000});
  }finally{closeSync(fd);}
  assert.equal(recoveredRows(),oldRows,"Recovered backup must preserve old rows");
  assert.equal(recoveredColumn(),"0","Recovered old schema unexpectedly contains new field");

  // Simulate a forced server crash against the RESTORED database; PostgreSQL
  // must recover via WAL on the same separate volume.
  docker("kill","--signal=KILL",restoreName);
  docker("start",restoreName);
  await recoveredReady();
  assert.equal(recoveredRows(),oldRows,"Old rows lost in isolated crash recovery");
  assert.equal(recoveredColumn(),"0");
  assert.equal(dc("ps","--quiet","db"),dbId);
  assert.equal(tableRows(),afterRows,"Recovery drill changed source DB");
  execute(process.execPath,[exercise,"persist"],{envVars:localEnv});
  verifyPortable();
  console.log("PROTOCOLIA_R4_VERIFIED_CHECKPOINT_ISOLATED_RESTORE_CRASH_PASS "+
    JSON.stringify({target,checkpointSha256:verified.archiveSha256,
      originalRows:evidence.rowsChecked,isolatedPreflight:true,
      verifiedEvolution:true,passportPreserved:true,
      originalDatabaseContainerUnchanged:true,oldRowsRestored:true,
      isolatedCrashRestart:true}));
}finally{
  if(restoredCreated)execute("docker",["rm","--force","--volumes",restoreName],
    {allowFailure:true,timeout:45000});
  if(volumeCreated)execute("docker",["volume","rm","--force",volumeName],
    {allowFailure:true,timeout:45000});
  if(sourceStarted)execute("docker",[...compose,"down","--volumes","--remove-orphans"],
    {cwd:app,allowFailure:true,timeout:90000});
  rmSync(tmp,{recursive:true,force:true});
}
