// Offline migration rehearsal. Never attach to, restore into, or alter the
// original Compose database. Only a SHA-256 verified snapshot is accepted.
import {spawnSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {closeSync,existsSync,openSync,readFileSync,readSync,rmSync,
  mkdtempSync,writeFileSync} from "node:fs";
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
  return allowFailure?{status:child.status,stderr:child.stderr??""}:(child.stdout??"").trim();
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
function tableSnapshot(container){
  const query=sql=>docker(["exec",container,"psql","-X","-U","protocolia",
    "-d","protocolia","-v","ON_ERROR_STOP=1","-At","-c",sql]);
  const tables=query("SELECT tablename FROM pg_catalog.pg_tables "+
    "WHERE schemaname='public' ORDER BY tablename").split("\n").filter(Boolean);
  const snapshot={};
  let totalRows=0;
  for(const name of tables){
    const escaped=name.replaceAll("'","''");
    const columns=query("SELECT column_name FROM information_schema.columns "+
      "WHERE table_schema='public' AND table_name='"+escaped+"' "+
      "ORDER BY ordinal_position").split("\n").filter(Boolean);
    if(!columns.length)deny("Missing columns in "+name);
    // This exact set of *old columns* is reused after the migration; additions
    // cannot hide changes to old data behind changed row_to_json shape.
    const expression=columns.map(quoted).join(",");
    const digest=query("SELECT count(*)::text||'|'||"+
      "coalesce(sum(hashtextextended(row_to_json(t)::text,0)::numeric),0)::text"+
      " FROM (SELECT "+expression+" FROM "+quoted(name)+") t");
    const [count,hash]=digest.split("|");
    if(!/^\d+$/.test(count)||!/^[-\d]+$/.test(hash))
      deny("Invalid data digest for table "+name);
    snapshot[name]={columns,count:Number(count),hash};
    totalRows+=Number(count);
  }
  return {snapshot,totalRows};
}
function verifyRows(container,before){
  const query=sql=>docker(["exec",container,"psql","-X","-U","protocolia",
    "-d","protocolia","-v","ON_ERROR_STOP=1","-At","-c",sql]);
  const current=query("SELECT tablename FROM pg_catalog.pg_tables "+
    "WHERE schemaname='public' ORDER BY tablename").split("\n").filter(Boolean);
  const oldTables=Object.keys(before.snapshot);
  for(const table of oldTables){
    if(!current.includes(table))deny("Existing table disappeared: "+table);
    const {columns,count,hash}=before.snapshot[table];
    const sql="SELECT count(*)::text||'|'||"+
      "coalesce(sum(hashtextextended(row_to_json(t)::text,0)::numeric),0)::text"+
      " FROM (SELECT "+columns.map(quoted).join(",")+" FROM "+quoted(table)+") t";
    const [afterCount,afterHash]=query(sql).split("|");
    if(Number(afterCount)!==count||afterHash!==hash)
      deny("Existing row count/content differs after SQL: "+table);
  }
  return {tablesChecked:oldTables.length,
    rowsChecked:before.totalRows,newTables:current.length-oldTables.length};
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
    for(let i=0;i<70;i++){
      const result=docker(["exec",id,"pg_isready","-U","protocolia",
        "-d","protocolia"],{allowFailure:true,timeout:10000});
      if(result.status===0){ready=true;break;}
      await new Promise(done=>setTimeout(done,450));
    }
    if(!ready)deny("Isolated PostgreSQL did not become ready");
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
    const report={schema:1,status:"pass",target:build.target,
      sourceContractSha256:build.contractSha256,
      checkpointSha256:archive.archiveSha256,
      proposedSqlSha256:sqlHash,changeCount:plan.changes.length,
      ...preserved,postgresImage:"postgres:16.15-alpine",
      isolatedNetwork:"none",originDatabaseAccess:false,
      elapsedSeconds:Math.round((Date.now()-started)/1000),
      warning:"Checks old-column row count and bounded hash summary; not a cryptographic row proof or production upgrade."};
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
