// Read-only-to-source rehearsal of a verified additive evolution. The only
// database we start, restore, migrate, query or delete is a NEW Compose volume.
// A passing receipt is local evidence, not signed production authorization.
import {spawnSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {closeSync,existsSync,lstatSync,mkdtempSync,openSync,readFileSync,
  rmSync,writeFileSync,readdirSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {dirname,join,relative,resolve,sep} from "node:path";
import {verifyApp} from "./ownership.mjs";
import {verifyCheckpoint} from "./database-checkpoint.mjs";
import {tableSnapshot,verifyRows} from "./database-preflight.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
const refuse=message=>{throw Error("Runtime staging refused: "+message);};
const inside=(root,path)=>{
  const rel=relative(root,path);
  return rel===""||(!rel.startsWith(".."+sep)&&rel!==".."&&!rel.startsWith(sep));
};
function privateJson(path){
  let st;
  try{st=lstatSync(path);}catch{refuse("Required private JSON file is missing");}
  if(!st.isFile()||(st.mode&0o077)!==0)refuse("JSON must be owner-only regular file (no symlinks)");
  try{return JSON.parse(readFileSync(path,"utf8"));}catch{refuse("Invalid JSON document");}
}
export function stageOptions(args,{verify=false}={}){
  if(args.length!==7||args[1]!=="--checkpoint"||
     args[3]!=="--report"||args[5]!=="--out")
    refuse("Usage: app:db:stage <evolved-generated-dir> --checkpoint <old.dump> --report <preflight.json> --out <new-receipt.json>");
  const dir=resolve(args[0]),archive=resolve(args[2]),
    report=resolve(args[4]),out=resolve(args[6]);
  if(!existsSync(dir)||!archive.endsWith(".dump")||!report.endsWith(".json")||
     !out.endsWith(".json")||inside(dir,out)||out===report||
     out===archive+".json"||(!verify&&existsSync(out))||
     (verify&&!existsSync(out))||!existsSync(dirname(out)))
    refuse("Invalid or pre-existing receipt destination; it must be outside the generated app");
  return {dir,archive,report,out};
}
function latestMigration(dir,target){
  const path=join(dir,target==="nestjs"?"src/migrations":"src/main/resources/db/migration");
  const files=readdirSync(path).filter(f=>/^V[1-9]\d*__protocolia_additive\.sql$/.test(f))
    .sort((a,b)=>Number(a.match(/^V(\d+)/)[1])-Number(b.match(/^V(\d+)/)[1]));
  if(!files.length)refuse("Generated app has no additive migration");
  const version=Number(files.at(-1).match(/^V(\d+)/)[1]);
  const source=readFileSync(join(path,files.at(-1)),"utf8");
  const prefix="-- Non-destructive TypeSpec contract evolution; original baseline preserved\n";
  if(!source.startsWith(prefix)||!source.endsWith("\n"))
    refuse("Unexpected generated migration format");
  return {version,sql:source.slice(prefix.length,-1)};
}
export function verifyStageInputs(options){
  const {dir,archive,report}=options;
  const seal=verifyApp(dir);
  const build=JSON.parse(readFileSync(join(dir,"protocolia-build.json"),"utf8"));
  const ir=JSON.parse(readFileSync(join(dir,"protocolia-contract-ir.json"),"utf8"));
  const checkpoint=verifyCheckpoint(archive);
  const approval=privateJson(report);
  if(!["nestjs","modular-spring"].includes(build.target)||
     build.target!==checkpoint.target||build.target!==approval.target||
     checkpoint.contractSha256!==approval.sourceContractSha256||
     build.contractSha256===checkpoint.contractSha256||
     approval.schema!==2||approval.status!=="pass"||
     approval.rowAttestation!=="sha256-sorted-row-json-v1"||
     approval.originDatabaseAccess!==false||approval.isolatedNetwork!=="none"||
     !Number.isSafeInteger(approval.tablesChecked)||approval.tablesChecked<1||
     !Number.isSafeInteger(approval.rowsChecked)||approval.rowsChecked<0||
     approval.checkpointSha256!==checkpoint.archiveSha256||
     approval.proposedIrSha256!==sha(JSON.stringify(ir)))
    refuse("Evolved app does not match the verified source archive, IR or preflight report");
  const migration=latestMigration(dir,build.target);
  if(approval.proposedSqlSha256!==sha(migration.sql))
    refuse("Installed additive migration differs from rehearsed canonical SQL");
  const receiptBinding={
    schema:1,status:"pass",target:build.target,
    sourceContractSha256:checkpoint.contractSha256,
    evolvedContractSha256:build.contractSha256,
    evolvedIrSha256:approval.proposedIrSha256,
    checkpointSha256:checkpoint.archiveSha256,
    preflightReportSha256:sha(readFileSync(report)),
    migrationSqlSha256:approval.proposedSqlSha256,
    installedOwnershipSha256:sha(JSON.stringify(seal.files)),
    migrationVersion:migration.version
  };
  return {binding:receiptBinding,build,ir,approval};
}
function composeExec(args,{cwd,env,stdin,timeout=600000}={}){
  const p=spawnSync("docker",args,{cwd,env,encoding:"utf8",
    stdio:[stdin??"ignore","pipe","pipe"],timeout,maxBuffer:4*1024*1024});
  if(p.error||p.status!==0)
    refuse("Ephemeral Docker Compose failed: "+(p.stderr??p.error?.message??"").slice(-700));
  return (p.stdout??"").trim();
}
async function freePort(){
  return new Promise((ok,fail)=>{
    const server=createServer();
    server.once("error",fail);
    server.listen(0,"127.0.0.1",()=>{
      const port=server.address().port;
      server.close(err=>err?fail(err):ok(port));
    });
  });
}
export function inspectLocalImage(imageId){
  if(typeof imageId!=="string"||!/^sha256:[a-f0-9]{64}$/.test(imageId))
    refuse("Missing content-addressed local Docker image ID");
  const p=spawnSync("docker",["image","inspect","--format","{{.Id}}",imageId],
    {encoding:"utf8",timeout:15000,maxBuffer:4096});
  if(p.error||p.status!==0||p.stdout?.trim()!==imageId)
    refuse("Staged Docker image no longer exists with its exact content ID");
  return imageId;
}
export function validateSnapshot(snapshot){
  if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot)||
     !snapshot.snapshot||typeof snapshot.snapshot!=="object"||
     Array.isArray(snapshot.snapshot)||!Number.isSafeInteger(snapshot.totalRows)||
     snapshot.totalRows<0)refuse("Invalid historic source database snapshot");
  const names=Object.keys(snapshot.snapshot);
  if(!names.length||names.some(n=>!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)))
    refuse("Invalid historic table names");
  let count=0;
  for(const name of names){
    const item=snapshot.snapshot[name];
    if(!item||!Number.isSafeInteger(item.count)||item.count<0||
       !/^[a-f0-9]{64}$/.test(item.sha256)||
       !Array.isArray(item.columns)||!item.columns.length||
       item.columns.some(n=>typeof n!=="string"||!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n))||
       new Set(item.columns).size!==item.columns.length)
      refuse("Invalid historic table digest or column definition");
    count+=item.count;
  }
  if(count!==snapshot.totalRows)refuse("Historic snapshot row counts do not add up");
  return snapshot;
}
export function verifyStageReceipt(options,{imageInspector=inspectLocalImage}={}){
  const {binding}=verifyStageInputs(options);
  const receipt=privateJson(options.out);
  for(const [key,value] of Object.entries(binding))
    if(receipt[key]!==value)refuse("Staged runtime receipt binding changed: "+key);
  if(receipt.receiptSchema!==2||receipt.stagedAppHealthy!==true||
     receipt.oldRowsPreserved!==true||receipt.schemaLedgerAdvanced!==true||
     receipt.genericReadPassed!==true||receipt.stagedVolumeDestroyed!==true)
    refuse("Staging receipt lacks verified runtime acceptance");
  if(typeof receipt.timestamp!=="string"||Number.isNaN(Date.parse(receipt.timestamp)))
    refuse("Staging receipt missing timestamp");
  if(typeof receipt.stagedImageId!=="string"||
     !/^sha256:[0-9a-f]{64}$/.test(receipt.stagedImageId)||
     imageInspector(receipt.stagedImageId)!==receipt.stagedImageId)
    refuse("Staged container image identity differs from the local tested image");
  validateSnapshot(receipt.sourceSnapshot);
  if(receipt.sourceSnapshotSha256!==sha(JSON.stringify(receipt.sourceSnapshot))||
     receipt.rowsAttested!==receipt.sourceSnapshot.totalRows||
     receipt.tablesAttested!==Object.keys(receipt.sourceSnapshot.snapshot).length)
    refuse("Historic backup snapshot or digest differs from staged receipt");
  return receipt;
}
export async function stageRuntime(args,{inspect}={}){
  const options=stageOptions(args);
  const {dir,archive,report,out}=options;
  const {binding,ir}=verifyStageInputs(options);
  const temp=mkdtempSync(join(tmpdir(),"pia-runtime-stage-"));
  const project="pia_stage_"+randomBytes(7).toString("hex");
  const port=await freePort();
  const password=randomBytes(24).toString("hex");
  const managerPassword=randomBytes(24).toString("hex");
  const vars={
    PROTOCOLIA_DB_PASSWORD:password,
    PROTOCOLIA_ALLOW_DEMO_AUTH:"true",
    PROTOCOLIA_MANAGER_USERNAME:"manager",
    PROTOCOLIA_MANAGER_PASSWORD:managerPassword,
    PROTOCOLIA_READER_USERNAME:"reader",
    PROTOCOLIA_READER_PASSWORD:randomBytes(24).toString("hex"),
    PROTOCOLIA_HOST_PORT:String(port),
    // Ensure the disposable test never inherits a consumer OIDC or BFF mode.
    PROTOCOLIA_AUTH_MODE:"demo",
    PROTOCOLIA_BFF_ENABLED:"false"
  };
  const file=join(temp,"stage.env");
  writeFileSync(file,Object.entries(vars).map(([k,v])=>k+"="+v).join("\n")+"\n",
    {mode:0o600,flag:"wx"});
  const env={...process.env,...vars},prefix=["compose","--project-name",project,"--env-file",file];
  let started=false,complete=false,receipt;
  // Deliberately avoid receiving an existing project name, DB URL, volume or
  // credentials from the operator. There is no connection to the origin DB.
  const call=(...args)=>composeExec([...prefix,...args],{cwd:dir,env});
  const sql=query=>call("exec","-T","db","psql","-X","-U","protocolia",
    "-d","protocolia","-At","-v","ON_ERROR_STOP=1","-c",query);
  try{
    call("config","--quiet");
    started=true;
    call("up","--detach","--wait","db");
    const dbId=call("ps","--quiet","db");
    if(!/^[0-9a-f]{12,64}$/i.test(dbId))refuse("Missing fresh staged PostgreSQL container");
    if(sql("SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'")!=="0")
      refuse("Staging database was not empty before restoring checkpoint");
    const fd=openSync(archive,"r");
    try{
      composeExec([...prefix,"exec","-T","db","pg_restore",
        "-U","protocolia","-d","protocolia","--no-owner","--no-acl",
        "--exit-on-error","--single-transaction"],{cwd:dir,env,stdin:fd});
    }finally{closeSync(fd);}
    const before=tableSnapshot(dbId);
    if(before.totalRows<0||!Object.keys(before.snapshot).length)
      refuse("Restored checkpoint contains no business tables");
    const oldTables=Object.fromEntries(Object.entries(before.snapshot).filter(([name])=>
      name!=="flyway_schema_history"&&name!=="protocolia_nest_migration_history"));
    const retained={snapshot:oldTables,totalRows:Object.values(oldTables)
      .reduce((sum,v)=>sum+v.count,0)};
    if(Object.keys(oldTables).length<1)refuse("No stable historic tables to attest");
    const sourceLedger=sql(binding.target==="nestjs"?
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "+
        "AND table_name='protocolia_nest_migration_history'":
      "SELECT count(*) FROM flyway_schema_history WHERE success");
    call("up","--detach","--build","app");
    const appId=call("ps","--quiet","app");
    if(!/^[0-9a-f]{12,64}$/i.test(appId))refuse("No single staged application container");
    const stagedImageId=composeExec(["inspect","--format","{{.Image}}",appId],{cwd:dir,env});
    inspectLocalImage(stagedImageId);
    let healthy=false;
    for(let i=0;i<135;i++){
      try{
        const response=await fetch("http://127.0.0.1:"+port+"/health",
          {signal:AbortSignal.timeout(2200)});
        if(response.status===200){healthy=true;break;}
      }catch{}
      await new Promise(ok=>setTimeout(ok,850));
    }
    if(!healthy)refuse("New generated runtime failed /health: "+call("logs","--tail","40","app"));
    verifyRows(dbId,retained);
    const ledger=sql(binding.target==="nestjs"?
      "SELECT version::text FROM protocolia_nest_migration_history ORDER BY version::int DESC LIMIT 1":
      "SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1");
    if(ledger!==String(binding.migrationVersion))
      refuse("PostgreSQL migration history does not match staged migration version");
    const count=sql(binding.target==="nestjs"?
      "SELECT count(*) FROM protocolia_nest_migration_history":
      "SELECT count(*) FROM flyway_schema_history WHERE success");
    if(binding.target==="nestjs"?(Number(count)!==binding.migrationVersion-1):
      (Number(count)!==Number(sourceLedger)+1))
      refuse("PostgreSQL migration ledger did not advance exactly once");
    const auth="Basic "+Buffer.from("manager:"+managerPassword).toString("base64");
    const request=async(method,path,payload,headers={})=>{
      const response=await fetch("http://127.0.0.1:"+port+path,{
        method,headers:{Authorization:auth,
          ...(payload===undefined?{}:{"Content-Type":"application/json"}),...headers},
        ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
        signal:AbortSignal.timeout(25000)
      });
      return {status:response.status,body:await response.text(),
        etag:response.headers.get("etag")};
    };
    const reads=ir.operations.filter(op=>op.behavior?.kind==="listPage"&&
      op.method==="GET"&&/^\/api\/[A-Za-z0-9/_-]+$/.test(op.path));
    if(!reads.length)refuse("Contract has no safe generic list-read operation for runtime test");
    const response=await request("GET",reads[0].path);
    if(response.status!==200)refuse("Staged contract-derived HTTP list read failed: "+response.status);
    if(typeof inspect==="function")await inspect({request,sql,build:binding});
    receipt={...binding,receiptSchema:2,timestamp:new Date().toISOString(),
      stagedImageId,sourceSnapshot:before,sourceSnapshotSha256:sha(JSON.stringify(before)),
      stagedAppHealthy:true,oldRowsPreserved:true,
      schemaLedgerAdvanced:true,genericReadPassed:true,stagedVolumeDestroyed:true,
      rowsAttested:before.totalRows,tablesAttested:Object.keys(before.snapshot).length,
      note:"Local content-addressed Docker image ID and restored DB row digests; unsigned, not a registry OCI digest, not production authorization or live-DB freshness."};
    complete=true;
  }finally{
    let cleanupError;
    if(started)try{call("down","--volumes","--remove-orphans");}
    catch(error){cleanupError=error;}
    rmSync(temp,{recursive:true,force:true});
    if(cleanupError)throw Error("Runtime staging cleanup failed: "+cleanupError.message);
  }
  if(!complete||!receipt)refuse("Incomplete staged acceptance");
  writeFileSync(out,JSON.stringify(receipt,null,2)+"\n",{flag:"wx",mode:0o600});
  verifyStageReceipt(options);
  console.log("PROTOCOLIA_V11_RUNTIME_STAGE_PASS "+JSON.stringify({
    target:receipt.target,checkpointSha256:receipt.checkpointSha256,
    evolvedIrSha256:receipt.evolvedIrSha256,
    rowsAttested:receipt.rowsAttested,
    stagedImageId:receipt.stagedImageId,
    stageVolumeDestroyed:true,receipt:out
  }));
  return receipt;
}
