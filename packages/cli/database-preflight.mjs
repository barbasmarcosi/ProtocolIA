// Offline migration rehearsal. Never attach to, restore into, or alter the
// original Compose database. Only a SHA-256 verified snapshot is accepted.
import {spawnSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {closeSync,existsSync,openSync,readFileSync,readSync,rmSync,
  mkdtempSync,writeFileSync,unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,relative,resolve,sep} from "node:path";
import {verifyApp} from "./ownership.mjs";
import {verifyCheckpoint} from "./database-checkpoint.mjs";
import {evolve,additiveSql} from "./regeneration.mjs";

const deny=message=>{throw Error("DB preflight refused: "+message);};
const sha256=value=>createHash("sha256").update(value).digest("hex");
const quoted=value=>'"'+value.replaceAll('"','""')+'"';
function docker(args,{input,stdin,allowFailure=false,timeout=120000}={}){
  const child=spawnSync("docker",args,{encoding:"utf8",
    stdio:[stdin??"pipe","pipe","pipe"],input:stdin?undefined:input??"",
    timeout,maxBuffer:4*1024*1024});
  if(child.error)deny("Docker unavailable: "+child.error.message);
  if(!allowFailure&&child.status!==0)
    deny("Isolated PostgreSQL command failed: "+(child.stderr??"").slice(-750));
  return allowFailure?{status:child.status,stderr:child.stderr??"",
    stdout:child.stdout??""}:(child.stdout??"").trim();
}
const inside=(root,path)=>{
  const rel=relative(root,path);
  return rel===""||(!rel.startsWith(".."+sep)&&rel!==".."&&!rel.startsWith(sep));
};
export function preflightOptions(args){
  if(args.length!==6||args[2]!=="--checkpoint"||args[4]!=="--report")
    deny("Usage: app:db:preflight <TypeSpec-project> <generated-dir> --checkpoint <verified.dump> --report <new-report.json>");
  const project=resolve(args[0]),dir=resolve(args[1]),
    archive=resolve(args[3]),report=resolve(args[5]);
  if(!archive.endsWith(".dump")||!report.endsWith(".json")||
    inside(dir,report)||inside(project,report)||
    archive===report||archive+".json"===report)
    deny("Unsafe checkpoint or report destination");
  if(existsSync(report)||!existsSync(dirname(report)))
    deny("Report must be a new file in an existing directory (no overwrite)");
  if(!existsSync(join(project,"tspconfig.yaml"))||
    !existsSync(join(dir,"protocolia-build.json")))
    deny("Explicit source contracts and sealed generated application required");
  return {project,dir,archive,report};
}
// Hash each complete *old-column* row with PostgreSQL's built-in SHA-256,
// sort the row digests (including duplicates) and stream the result to a
// private temporary file. A second SHA-256 attests to the ordered multiset.
// Unlike SUM(hashtextextended), no cancellation can hide two changed rows.
function exactRowsDigest(container,table,columns){
  const select=columns.map(quoted).join(",");
  const sql="COPY (SELECT h FROM (SELECT encode(sha256(convert_to("+
    "row_to_json(t)::text,'UTF8')),'hex') AS h FROM (SELECT "+select+
    " FROM "+quoted(table)+") t) hashes ORDER BY h) TO STDOUT";
  const path=join(tmpdir(),"pia-row-digest-"+randomBytes(16).toString("hex")+".tmp");
  let fd;
  try{
    fd=openSync(path,"wx",0o600);
    const proc=spawnSync("docker",["exec",container,"psql","-X","-q",
      "-U","protocolia","-d","protocolia","-v","ON_ERROR_STOP=1","-c",sql],
      {encoding:"utf8",timeout:600000,maxBuffer:1024*1024,
        stdio:["ignore",fd,"pipe"]});
    if(proc.error||proc.status!==0)
      deny("Failed to stream the isolated PostgreSQL row digest: "+
        (proc.stderr??proc.error?.message??"").slice(-450));
    closeSync(fd);fd=undefined;
    const reader=openSync(path,"r"),buf=Buffer.allocUnsafe(1024*1024);
    const sha=createHash("sha256");
    let rows=0,lineLength=0,n=0;
    try{
      while((n=readSync(reader,buf,0,buf.length,null))!==0){
        sha.update(buf.subarray(0,n));
        for(let i=0;i<n;i++){
          const byte=buf[i];
          if(byte===10){
            if(lineLength!==64)deny("Unexpected PostgreSQL digest row format");
            rows++;lineLength=0;
          }else if((byte>=48&&byte<=57)||(byte>=97&&byte<=102)){
            lineLength++;
            if(lineLength>64)deny("Invalid PostgreSQL digest row length");
          }else deny("Unexpected nonhexadecimal PostgreSQL digest output");
        }
      }
      if(lineLength!==0)deny("Truncated PostgreSQL digest stream");
      return {count:rows,sha256:sha.digest("hex")};
    }finally{closeSync(reader);}
  }finally{
    if(fd!==undefined)closeSync(fd);
    if(existsSync(path))unlinkSync(path);
  }
}
function queryCatalog(container,sql){
  return docker(["exec",container,"psql","-X","-U","protocolia",
    "-d","protocolia","-v","ON_ERROR_STOP=1","-At","-c",sql]);
}
export function tableSnapshot(container){
  const tables=queryCatalog(container,"SELECT tablename FROM pg_catalog.pg_tables "+
    "WHERE schemaname='public' ORDER BY tablename").split("\n").filter(Boolean);
  const snapshot={};
  let totalRows=0;
  for(const name of tables){
    const escaped=name.replaceAll("'","''");
    const columns=queryCatalog(container,"SELECT column_name FROM information_schema.columns "+
      "WHERE table_schema='public' AND table_name='"+escaped+"' "+
      "ORDER BY ordinal_position").split("\n").filter(Boolean);
    if(!columns.length)deny("Missing columns in "+name);
    const result=exactRowsDigest(container,name,columns);
    snapshot[name]={columns,...result};
    totalRows+=result.count;
  }
  return {snapshot,totalRows};
}
export function verifyRows(container,before){
  const current=queryCatalog(container,"SELECT tablename FROM pg_catalog.pg_tables "+
    "WHERE schemaname='public' ORDER BY tablename").split("\n").filter(Boolean);
  const oldTables=Object.keys(before.snapshot);
  for(const table of oldTables){
    if(!current.includes(table))deny("Existing table disappeared: "+table);
    const {columns,count,sha256}=before.snapshot[table];
    const result=exactRowsDigest(container,table,columns);
    if(result.count!==count||result.sha256!==sha256)
      deny("Existing row count/cryptographic digest differs after SQL: "+table);
  }
  return {tablesChecked:oldTables.length,rowsChecked:before.totalRows,
    newTables:current.length-oldTables.length};
}
export async function preflightMigration(args){
  const options=preflightOptions(args);
  verifyApp(options.dir);
  const build=JSON.parse(readFileSync(join(options.dir,"protocolia-build.json"),"utf8"));
  const archive=verifyCheckpoint(options.archive);
  if(!archive.contractSha256||archive.contractSha256!==build.contractSha256||
    archive.target!==build.target)
    deny("Checkpoint source contract/adapter differs from the generated app");
  const plan=await evolve("plan",options.project,options.dir);
  if(!plan.compatible)deny("TypeSpec evolution is not additive: "+plan.blockers.join("; "));
  const nextIr=JSON.parse(readFileSync(join(options.project,
    "tsp-output/@protocolia/compiler/ir.json"),"utf8"));
  const sql=additiveSql(plan,nextIr);
  if(!sql.trim())deny("No SQL schema migration to rehearse");
  const sqlHash=sha256(sql);
  const id="pia_preflight_"+randomBytes(8).toString("hex");
  const temp=mkdtempSync(join(tmpdir(),"pia-preflight-"));
  const started=Date.now();
  let startedContainer=false;
  try{
    const env=join(temp,"db.env");
    writeFileSync(env,"POSTGRES_DB=protocolia\nPOSTGRES_USER=protocolia\n"+
      "POSTGRES_PASSWORD="+randomBytes(24).toString("hex")+"\n",
      {mode:0o600,flag:"wx"});
    // Network access is categorically disabled. The container has its own
    // anonymous PGDATA volume, removed with --rm. The user DB is never mounted.
    docker(["run","--detach","--rm","--network","none","--name",id,
      "--memory","1g","--cpus","2","--env-file",env,
      "postgres:16.15-alpine"],{timeout:120000});
    startedContainer=true;
    let ready=false;
    for(let i=0;i<90;i++){
      // The official PostgreSQL image briefly runs a bootstrap server and
      // shuts it down. A premature pg_isready succeeds on that server;
      // restoration must wait until initdb finishes and the final server starts.
      const logs=docker(["logs",id],{allowFailure:true,timeout:10000});
      const initialized=logs.status===0&&
        (logs.stderr+logs.stdout).includes("PostgreSQL init process complete; ready for start up.");
      if(initialized){
        const response=docker(["exec",id,"psql","-X","-U","protocolia",
          "-d","protocolia","-At","-c","SELECT 1"],{allowFailure:true,timeout:10000});
        if(response.status===0){ready=true;break;}
      }
      await new Promise(done=>setTimeout(done,550));
    }
    if(!ready)deny("Isolated PostgreSQL final server did not become ready");
    const fd=openSync(options.archive,"r");
    try{
      docker(["exec","-i",id,"pg_restore","-U","protocolia","-d","protocolia",
        "--no-owner","--no-acl","--exit-on-error","--single-transaction"],
        {stdin:fd,timeout:600000});
    }finally{closeSync(fd);}
    const before=tableSnapshot(id);
    // Applying only the SQL built from the already validated canonical diff.
    // -1 enforces transactional DDL: incompatible old rows leave no partial
    // schema changes. Network, application volume and original DB are absent.
    docker(["exec","-i",id,"psql","-X","-1","-v","ON_ERROR_STOP=1",
      "-U","protocolia","-d","protocolia","-f","-"],
      {input:sql+"\n",timeout:600000});
    const preserved=verifyRows(id,before);
    const report={schema:2,status:"pass",target:build.target,
      rowAttestation:"sha256-sorted-row-json-v1",
      sourceContractSha256:build.contractSha256,
      checkpointSha256:archive.archiveSha256,
      proposedSqlSha256:sqlHash,
      proposedIrSha256:sha256(JSON.stringify(nextIr)),
      changeCount:plan.changes.length,
      ...preserved,postgresImage:"postgres:16.15-alpine",
      isolatedNetwork:"none",originDatabaseAccess:false,
      elapsedSeconds:Math.round((Date.now()-started)/1000),
      warning:"Streams PostgreSQL SHA-256 of every old-column row in every public table, verifies exact row multiset after SQL. This is a single restored snapshot, not proof of live-db freshness, DB isolation from local Docker admins or production readiness."};
    writeFileSync(options.report,JSON.stringify(report,null,2)+"\n",
      {flag:"wx",mode:0o600});
    console.log("PROTOCOLIA_DB_PREFLIGHT_PASS "+JSON.stringify(report));
    return report;
  }finally{
    if(startedContainer)try{
      docker(["rm","--force","--volumes",id],{timeout:60000});
    }catch(error){
      console.error("PROTOCOLIA_DB_PREFLIGHT_CLEANUP_FAILED "+error.message);
      process.exitCode=1;
    }
    rmSync(temp,{recursive:true,force:true});
  }
}
