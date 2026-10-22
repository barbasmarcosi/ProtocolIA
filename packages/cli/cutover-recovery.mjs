// v1.1l: recovery rehearsal in a NEW random Compose project ONLY.
// NEVER target, stop or restore the original Compose database. There is no
// production cutover or rollback command in this module.
import {spawnSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {closeSync,existsSync,mkdtempSync,openSync,readFileSync,rmSync,writeFileSync,lstatSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {dirname,join,resolve,relative,isAbsolute,sep} from "node:path";
import {verifyCheckpoint} from "./database-checkpoint.mjs";
import {candidateOptions,verifyCandidate,inspectCandidateImage} from "./deployment-candidate.mjs";
import {verifyStageReceipt,stageOptions,inspectLocalImage} from "./runtime-stage.mjs";
import {tableSnapshot,verifyRows} from "./database-preflight.mjs";

const deny=message=>{throw Error("Recovery rehearsal refused: "+message);};
const sha=value=>createHash("sha256").update(value).digest("hex");
const idPattern=/^sha256:[0-9a-f]{64}$/;
const inside=(root,target)=>{const r=relative(root,target);return r===""||
  (r!==".."&&!r.startsWith(".."+sep)&&!isAbsolute(r));};
export function pinnedOverlay(imageId){
  if(!idPattern.test(imageId))deny("An exact local Docker image ID is required; tags are prohibited");
  return "services:\n  app:\n    image: "+imageId+
    "\n    pull_policy: never\n    build: !reset null\n";
}
export function ephemeralCutoverProject(project){
  if(typeof project!=="string"||!/^pia_ckpt_[0-9a-f]{10}$/.test(project))
    deny("Pinned cutover test is allowed only on a freshly named CI-owned pia_ckpt_<hex> project");
  return project;
}
export function recoveryOptions(args,{verify=false}={}){
  if(args.length!==11||args[1]!=="--checkpoint"||args[3]!=="--report"||
     args[5]!=="--receipt"||args[7]!=="--candidate"||args[9]!=="--out")
    deny("Usage: app:deploy:recovery:drill <evolved-app> --checkpoint <old.dump> --report <preflight.json> --receipt <stage.json> --candidate <candidate.json> --out <new-recovery.json>");
  const [dir,,archive,,report,,receipt,,candidate,,reportOut]=args;
  const candidatePath=resolve(candidate),out=resolve(reportOut);
  const privateStat=lstatSync(candidatePath);
  if(!privateStat.isFile()||(privateStat.mode&0o077)!==0)
    deny("Candidate must be a private regular file");
  let record;
  try{record=JSON.parse(readFileSync(candidatePath,"utf8"));}
  catch{deny("Candidate JSON is invalid");}
  const opts=candidateOptions([dir,"--checkpoint",archive,"--report",report,
    "--receipt",receipt,"--image",record.imageRef,"--out",candidate],{verify:true});
  if(!out.endsWith(".json")||!existsSync(dirname(out))||inside(opts.dir,out)||
     [opts.archive,opts.report,opts.stageReceiptPath,candidatePath,
      opts.archive+".json"].includes(out)||
     (verify&&!existsSync(out))||(!verify&&existsSync(out)))
    deny("Recovery report path must be new, private and outside the generated application");
  return {...opts,recoveryPath:out};
}
function execDocker(args,{cwd,stdin,timeout=600000}={}){
  const child=spawnSync("docker",args,{cwd,encoding:"utf8",timeout,
    stdio:[stdin??"ignore","pipe","pipe"],maxBuffer:4*1024*1024});
  if(child.error||child.status!==0)
    deny("Temporary recovery Docker operation failed: "+
      (child.stderr??child.error?.message??"").slice(-700));
  return (child.stdout??"").trim();
}
async function portOnLoopback(){
  return new Promise((ok,fail)=>{
    const s=createServer();
    s.once("error",fail);
    s.listen(0,"127.0.0.1",()=>{
      const port=s.address().port;
      s.close(e=>e?fail(e):ok(port));
    });
  });
}
function checkImage(id){
  inspectLocalImage(id);
  return id;
}
export function verifyRecoveryRecord(options,{candidateInspector=inspectCandidateImage,
  stageImageInspector=inspectLocalImage,oldImageInspector=checkImage}={}){
  const candidate=verifyCandidate(options,{
    imageInspector:candidateInspector,stageImageInspector
  });
  const stage=verifyStageReceipt({...options,out:options.stageReceiptPath},
    {imageInspector:stageImageInspector});
  const checkpoint=verifyCheckpoint(options.archive);
  const old=checkpoint.sourceAppImageId;
  if(!idPattern.test(old)||old===stage.stagedImageId||
     oldImageInspector(old)!==old)deny("Checkpoint lacks the original immutable application image");
  const stat=lstatSync(options.recoveryPath);
  if(!stat.isFile()||(stat.mode&0o077)!==0)deny("Recovery report must be owner-only regular file");
  let record;
  try{record=JSON.parse(readFileSync(options.recoveryPath,"utf8"));}
  catch{deny("Recovery report is invalid JSON");}
  const expected={schema:1,status:"pass",oldImageId:old,
    stagedImageId:stage.stagedImageId,
    originalCheckpointSha256:checkpoint.archiveSha256,
    candidateSha256:sha(readFileSync(options.candidatePath)),
    originalRowsSha256:sha(JSON.stringify(stage.sourceSnapshot)),
    restoredOldSchema:true,restoredOldRows:true,
    originalRuntimeHealthy:true,recoveredFromInjectedOutage:true,
    isolatedVolumeDestroyed:true};
  if(candidate.stagedImageId!==stage.stagedImageId)deny("Candidate and stage diverged");
  for(const [key,value] of Object.entries(expected))
    if(record[key]!==value)deny("Recovery report mismatch: "+key);
  if(!Number.isFinite(Date.parse(record.completedAt)))
    deny("Recovery report lacks a completion timestamp");
  return record;
}
export async function rehearseRecovery(args,{inspectOld=checkImage}={}){
  const options=recoveryOptions(args);
  const candidate=verifyCandidate(options);
  const stage=verifyStageReceipt({...options,out:options.stageReceiptPath});
  const checkpoint=verifyCheckpoint(options.archive);
  if(!idPattern.test(checkpoint.sourceAppImageId)||
     checkpoint.sourceAppImageId===stage.stagedImageId)
    deny("Exact old-runtime image was not captured before contract evolution");
  inspectOld(checkpoint.sourceAppImageId);
  if(candidate.stagedImageId!==stage.stagedImageId)
    deny("Recovery inputs do not bind to the staged candidate");
  const work=mkdtempSync(join(tmpdir(),"pia-recovery-drill-"));
  const project="pia_recover_"+randomBytes(7).toString("hex");
  const pwd=randomBytes(24).toString("hex");
  const manager=randomBytes(24).toString("hex");
  const port=await portOnLoopback();
  const env=join(work,"recovery.env"),overlay=join(work,"pinned-old-image.yaml");
  writeFileSync(env,[
    "PROTOCOLIA_DB_PASSWORD="+pwd,
    "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
    "PROTOCOLIA_AUTH_MODE=demo",
    "PROTOCOLIA_BFF_ENABLED=false",
    "PROTOCOLIA_HOST_PORT="+port,
    "PROTOCOLIA_MANAGER_USERNAME=manager",
    "PROTOCOLIA_MANAGER_PASSWORD="+manager,
    "PROTOCOLIA_READER_USERNAME=reader",
    "PROTOCOLIA_READER_PASSWORD="+randomBytes(24).toString("hex")
  ].join("\n")+"\n",{mode:0o600,flag:"wx"});
  writeFileSync(overlay,pinnedOverlay(checkpoint.sourceAppImageId),
    {mode:0o600,flag:"wx"});
  const compose=["compose","--project-name",project,"--env-file",env,
    "-f",join(options.dir,"compose.yaml"),"-f",overlay];
  const docker=(...args)=>execDocker([...compose,...args],{cwd:options.dir});
  let started=false,completed=false,report=null;
  const healthy=async()=>{
    try{
      const response=await fetch("http://127.0.0.1:"+port+"/health",{
        redirect:"manual",signal:AbortSignal.timeout(1600)});
      return response.status===200;
    }catch{return false;}
  };
  const awaitHealthy=async()=>{
    for(let i=0;i<90;i++){
      if(await healthy())return;
      await new Promise(ok=>setTimeout(ok,800));
    }
    deny("Recovered old runtime was not healthy");
  };
  try{
    docker("config","--quiet");
    started=true;
    docker("up","--detach","--wait","db");
    const db=docker("ps","--quiet","db");
    if(!/^[0-9a-f]{12,64}$/i.test(db))
      deny("No distinct disposable recovery DB container was started");
    const pre=execDocker(["exec",db,"psql","-X","-U","protocolia",
      "-d","protocolia","-At","-c",
      "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'"]);
    if(pre!=="0")deny("Recovery DB was not empty before checkpoint restore");
    const fd=openSync(options.archive,"r");
    try{
      execDocker([...compose,"exec","-T","db","pg_restore",
        "-U","protocolia","-d","protocolia","--no-owner","--no-acl",
        "--exit-on-error","--single-transaction"],{cwd:options.dir,stdin:fd});
    }finally{closeSync(fd);}
    verifyRows(db,stage.sourceSnapshot);
    const before=tableSnapshot(db);
    if(sha(JSON.stringify(before))!==sha(JSON.stringify(stage.sourceSnapshot)))
      deny("Restored historic checkpoint differs from staged snapshot");
    docker("up","--detach","--no-build","--no-deps","app");
    const app=docker("ps","--quiet","app");
    if(!/^[0-9a-f]{12,64}$/i.test(app))deny("No old recovery app container");
    const image=execDocker(["inspect","--format","{{.Image}}",app]);
    if(image!==checkpoint.sourceAppImageId)
      deny("Recovery runtime was rebuilt or ran the wrong old image");
    await awaitHealthy();
    const auth="Basic "+Buffer.from("manager:"+manager).toString("base64");
    const old=await fetch("http://127.0.0.1:"+port+"/api/orders/RETAINED",{
      headers:{Authorization:auth},signal:AbortSignal.timeout(5000)});
    if(old.status!==200||old.headers.get("etag")!=='"2"')
      deny("Recovered old runtime could not read the historical versioned document");
    // Inject outage in the RECOVERY project only. No original app/db touched.
    docker("stop","app");
    if(await healthy())deny("Outage injection did not actually stop the recovered service");
    docker("up","--detach","--no-build","--no-deps","--force-recreate","app");
    await awaitHealthy();
    const newApp=docker("ps","--quiet","app");
    const newImage=execDocker(["inspect","--format","{{.Image}}",newApp]);
    if(newImage!==checkpoint.sourceAppImageId)
      deny("Recovery restart changed the old approved application image");
    const after=tableSnapshot(db);
    if(sha(JSON.stringify(after))!==sha(JSON.stringify(before)))
      deny("Recovery restart modified historical rows/schema");
    report={schema:1,status:"pass",oldImageId:checkpoint.sourceAppImageId,
      stagedImageId:stage.stagedImageId,
      originalCheckpointSha256:checkpoint.archiveSha256,
      candidateSha256:sha(readFileSync(options.candidatePath)),
      originalRowsSha256:sha(JSON.stringify(stage.sourceSnapshot)),
      restoredOldSchema:true,restoredOldRows:true,
      originalRuntimeHealthy:true,recoveredFromInjectedOutage:true,
      isolatedVolumeDestroyed:true,completedAt:new Date().toISOString(),
      warning:"Recovery was exercised ONLY on a new isolated restored copy. Never restore this checkpoint over a migrated live DB: later writes would be lost."};
    completed=true;
  }finally{
    let error;
    if(started)try{docker("down","--volumes","--remove-orphans");}
    catch(e){error=e;}
    rmSync(work,{recursive:true,force:true});
    if(error)throw Error("Disposable recovery cleanup failed: "+error.message);
  }
  if(!completed||!report)deny("Recovery rehearsal did not complete");
  writeFileSync(options.recoveryPath,JSON.stringify(report,null,2)+"\n",
    {flag:"wx",mode:0o600});
  verifyRecoveryRecord(recoveryOptions(args,{verify:true}));
  console.log("PROTOCOLIA_V11_ISOLATED_RECOVERY_PASS "+JSON.stringify({
    target:stage.target,restoredOldRows:true,oldRuntimeStarted:true,
    injectedOutageRecovered:true,originalNeverTouched:true,
    volumeDestroyed:true,report:options.recoveryPath
  }));
  return report;
}
