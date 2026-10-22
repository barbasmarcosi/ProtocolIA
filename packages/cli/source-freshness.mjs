// Read-only maintenance-time comparison of the current source PostgreSQL with
// the exact archived snapshot exercised by the staged generated runtime.
// This does NOT freeze writes, lock the source, deploy or authorize a cutover.
import {spawnSync} from "node:child_process";
import {existsSync,lstatSync} from "node:fs";
import {resolve} from "node:path";
import {verifyCheckpoint} from "./database-checkpoint.mjs";
import {stageOptions,verifyStageReceipt,validateSnapshot} from "./runtime-stage.mjs";
import {tableSnapshot} from "./database-preflight.mjs";

const refuse=message=>{throw Error("Source freshness refused: "+message);};
const safeProject=/^[a-z][a-z0-9_-]{1,62}$/;
export function sourceOptions(args){
  if(args.length!==12||args[1]!=="--checkpoint"||args[3]!=="--report"||
     args[5]!=="--receipt"||args[7]!=="--project"||
     args[9]!=="--env-file"||args[11]!=="--assert-writes-paused")
    refuse("Usage: app:db:source:verify <evolved-app> --checkpoint <old.dump> --report <preflight.json> --receipt <existing-stage.json> --project <existing-compose> --env-file <private.env> --assert-writes-paused");
  const [dir,,archive,,report,,receipt,,project,,envFile]=args;
  const environment=resolve(envFile);
  if(!safeProject.test(project)||!existsSync(environment))refuse("Missing or invalid explicit Compose project/environment");
  const stat=lstatSync(environment);
  if(!stat.isFile()||(stat.mode&0o077)!==0)
    refuse("Compose environment file must be owner-only regular file");
  const stage=stageOptions([dir,"--checkpoint",archive,"--report",report,
    "--out",receipt],{verify:true});
  return {...stage,project,environment};
}
export function compareSourceSnapshots(expected,actual){
  validateSnapshot(expected);validateSnapshot(actual);
  const oldNames=Object.keys(expected.snapshot).sort();
  const newNames=Object.keys(actual.snapshot).sort();
  if(JSON.stringify(oldNames)!==JSON.stringify(newNames))
    refuse("Current source PostgreSQL table set differs from the archived checkpoint");
  for(const name of oldNames){
    const old=expected.snapshot[name],now=actual.snapshot[name];
    if(JSON.stringify(old.columns)!==JSON.stringify(now.columns)||
       old.count!==now.count||old.sha256!==now.sha256)
      refuse("Source PostgreSQL has changed since the checkpoint: "+name);
  }
  if(expected.totalRows!==actual.totalRows)refuse("Source row total changed");
  return {tablesCompared:oldNames.length,rowsCompared:expected.totalRows};
}
function docker(args,{cwd,timeout=30000}={}){
  const p=spawnSync("docker",args,{cwd,encoding:"utf8",timeout,maxBuffer:2*1024*1024});
  if(p.error||p.status!==0)
    refuse("Read-only source inspection failed: "+(p.stderr??p.error?.message??"").slice(-400));
  return (p.stdout??"").trim();
}
export function verifySourceFreshness(args,{getSnapshot=tableSnapshot,imageInspector}={}){
  const opts=sourceOptions(args);
  const checkpoint=verifyCheckpoint(opts.archive);
  const receipt=verifyStageReceipt(opts,imageInspector?{imageInspector}:undefined);
  if(checkpoint.composeProject!==opts.project||
     typeof checkpoint.databaseContainerId!=="string"||
     !/^[a-f0-9]{12,64}$/i.test(checkpoint.databaseContainerId))
    refuse("Checkpoint lacks this exact original Compose project and source DB identity");
  const base=["compose","--project-name",opts.project,"--env-file",opts.environment];
  docker([...base,"config","--quiet"],{cwd:opts.dir});
  const container=docker([...base,"ps","--quiet","db"],{cwd:opts.dir});
  if(!/^[a-f0-9]{12,64}$/i.test(container)||
     container!==checkpoint.databaseContainerId)
    refuse("Original database container identity changed since the checkpoint");
  // Full schema and all original-column rows, including migration journals.
  // The caller must maintain the write pause until their separate cutover;
  // this is a read-only point-in-time observation, not a durable DB lock.
  const actual=getSnapshot(container);
  const counts=compareSourceSnapshots(receipt.sourceSnapshot,actual);
  const repeated=docker([...base,"ps","--quiet","db"],{cwd:opts.dir});
  if(repeated!==container)refuse("Source DB container changed while comparing rows");
  const result={...counts,composeProject:opts.project,
    databaseContainerId:container,stagedImageId:receipt.stagedImageId,
    observedAt:new Date().toISOString(),
    caution:"PASS covers a read-only observation with operator-asserted paused writes. It does not lock DB, deploy image, authorize production or prevent writes after verification."};
  console.log("PROTOCOLIA_V11_SOURCE_FRESHNESS_PASS "+JSON.stringify(result));
  return result;
}
