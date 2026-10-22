// v1.1k: read-only deployment preparation. This module NEVER updates a
// Compose service, pushes/pulls an image, restarts containers or writes SQL.
// Candidate checks are local integrity checks, NOT signed authorization.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,lstatSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {stageOptions,verifyStageReceipt} from "./runtime-stage.mjs";
import {verifySourceFreshness} from "./source-freshness.mjs";

const hash=value=>createHash("sha256").update(value).digest("hex");
const deny=message=>{throw Error("Deployment candidate refused: "+message);};
const imageIdPattern=/^sha256:[0-9a-f]{64}$/;
const registryPattern=/^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$/;
function privateJson(path){
  let stat;
  try{stat=lstatSync(path);}catch{deny("Private JSON document is absent");}
  if(!stat.isFile()||(stat.mode&0o077)!==0)
    deny("Private JSON must be an owner-only regular file without symlinks");
  try{return JSON.parse(readFileSync(path,"utf8"));}
  catch{deny("Private JSON is malformed");}
}
export function parseImageRef(value){
  if(typeof value!=="string"||value.length>255)
    deny("Image reference is missing or too long");
  if(imageIdPattern.test(value))return "local";
  if(registryPattern.test(value)&&!value.includes("..")&&
     !value.includes("//")&&!value.includes("/./")&&!value.includes(":/"))
    return "registry";
  deny("Expected immutable local sha256:<64 hex> or registry/repository@sha256:<64 hex>; mutable tags are refused");
}
export function inspectCandidateImage(reference){
  parseImageRef(reference);
  const p=spawnSync("docker",["image","inspect","--format","{{json .}}",reference],
    {encoding:"utf8",timeout:15000,maxBuffer:1024*1024});
  if(p.error||p.status!==0)deny("Pinned candidate image is not locally inspectable");
  let inspected;
  try{inspected=JSON.parse(p.stdout.trim());}
  catch{deny("Docker returned an invalid image inspection record");}
  return inspected;
}
export function assertCandidateImage(reference,expectedId,inspector=inspectCandidateImage){
  const mode=parseImageRef(reference);
  if(!imageIdPattern.test(expectedId))deny("Staging receipt lacks an exact Docker image ID");
  const inspected=inspector(reference);
  if(!inspected||inspected.Id!==expectedId)
    deny("Candidate image differs from the exact runtime staged image");
  if(mode==="local"&&reference!==expectedId)
    deny("Local candidate image must equal the staged content ID");
  if(mode==="registry"&&(!Array.isArray(inspected.RepoDigests)||
      !inspected.RepoDigests.includes(reference)))
    deny("Registry image reference was not pinned to an inspected local RepoDigest");
  return mode;
}
export function candidateOptions(args,{verify=false}={}){
  if(args.length!==11||args[1]!=="--checkpoint"||args[3]!=="--report"||
     args[5]!=="--receipt"||args[7]!=="--image"||args[9]!=="--out")
    deny("Usage: app:deploy:candidate <generated-app> --checkpoint <old.dump> --report <preflight.json> --receipt <stage.json> --image <immutable-image-ref> --out <new-candidate.json>");
  const [dir,,archive,,report,,receipt,,imageRef,,output]=args;
  parseImageRef(imageRef);
  const stage=stageOptions([dir,"--checkpoint",archive,"--report",report,
    "--out",receipt],{verify:true});
  const out=resolve(output);
  if(!out.endsWith(".json")||!existsSync(dirname(out))||
     [stage.dir,stage.archive,stage.report,stage.out].includes(out)||
     out===stage.archive+".json"||out.startsWith(stage.dir+"/")||
     (verify&&!existsSync(out))||(!verify&&existsSync(out)))
    deny("Candidate output must be a new JSON outside the app and existing evidence");
  return {...stage,imageRef,out,stageReceiptPath:stage.out,candidatePath:out};
}
function expectedCandidate(options,{imageInspector=inspectCandidateImage,stageImageInspector}={}){
  const stage=verifyStageReceipt({...options,out:options.stageReceiptPath},
    stageImageInspector?{imageInspector:stageImageInspector}:undefined);
  const imageMode=assertCandidateImage(options.imageRef,stage.stagedImageId,imageInspector);
  return {
    schema:1,status:"ready-for-read-only-precheck",target:stage.target,
    imageMode,imageRef:options.imageRef,stagedImageId:stage.stagedImageId,
    stageReceiptSha256:hash(readFileSync(options.stageReceiptPath)),
    sourceContractSha256:stage.sourceContractSha256,
    evolvedIrSha256:stage.evolvedIrSha256,
    checkpointSha256:stage.checkpointSha256,
    migrationSqlSha256:stage.migrationSqlSha256,
    sourceSnapshotSha256:stage.sourceSnapshotSha256
  };
}
export function createCandidate(args,adapters={}){
  const options=candidateOptions(args);
  const expected=expectedCandidate(options,adapters);
  const document={...expected,createdAt:new Date().toISOString(),
    warning:"Unsigned local release candidate. No deployment, source lock, external artifact attestation or production authorization."};
  writeFileSync(options.candidatePath,JSON.stringify(document,null,2)+"\n",
    {flag:"wx",mode:0o600});
  const result=verifyCandidate(candidateOptions(args,{verify:true}),adapters);
  console.log("PROTOCOLIA_V11_DEPLOYMENT_CANDIDATE_PASS "+JSON.stringify({
    imageMode:result.imageMode,stagedImageId:result.stagedImageId,
    candidate:options.candidatePath
  }));
  return result;
}
export function verifyCandidate(options,adapters={}){
  const expected=expectedCandidate(options,adapters);
  const actual=privateJson(options.candidatePath);
  for(const [key,value] of Object.entries(expected))
    if(actual[key]!==value)deny("Candidate no longer matches verified image/stage: "+key);
  if(typeof actual.createdAt!=="string"||
     !Number.isFinite(Date.parse(actual.createdAt))||
     typeof actual.warning!=="string")
    deny("Candidate record is incomplete");
  return actual;
}
export function precheckOptions(args){
  if(args.length!==16||args[1]!=="--checkpoint"||args[3]!=="--report"||
     args[5]!=="--receipt"||args[7]!=="--candidate"||
     args[9]!=="--project"||args[11]!=="--env-file"||
     args[13]!=="--assert-writes-paused"||args[14]!=="--approve-image")
    deny("Usage: app:deploy:precheck <generated-app> --checkpoint <dump> --report <preflight.json> --receipt <stage.json> --candidate <candidate.json> --project <compose> --env-file <private.env> --assert-writes-paused --approve-image <immutable-image-ref>");
  const [dir,,archive,,report,,receipt,,candidate,,project,,envFile,,,approved]=args;
  const doc=privateJson(resolve(candidate));
  const imageRef=doc.imageRef;
  if(imageRef!==approved)deny("Explicit approved immutable image must match candidate");
  const candidateArgs=[dir,"--checkpoint",archive,"--report",report,
    "--receipt",receipt,"--image",imageRef,"--out",candidate];
  const options=candidateOptions(candidateArgs,{verify:true});
  const sourceArgs=[dir,"--checkpoint",archive,"--report",report,
    "--receipt",receipt,"--project",project,"--env-file",envFile,
    "--assert-writes-paused"];
  return {options,sourceArgs};
}
export function precheckCandidate(args,{imageInspector,stageImageInspector,verifySource=verifySourceFreshness}={}){
  const parsed=precheckOptions(args);
  const adapters={imageInspector,stageImageInspector};
  const candidate=verifyCandidate(parsed.options,adapters);
  const source=verifySource(parsed.sourceArgs,
    stageImageInspector?{imageInspector:stageImageInspector}:undefined);
  // Check candidate again after the source DB read: abort if its local image
  // or evidence disappeared/changed before we return the verdict.
  verifyCandidate(parsed.options,adapters);
  const result={imageRef:candidate.imageRef,imageMode:candidate.imageMode,
    imageId:candidate.stagedImageId,project:source.composeProject,
    databaseContainerId:source.databaseContainerId,
    observedAt:source.observedAt,
    warning:"Read-only point-in-time precheck. Caller must keep writes paused and separately authorize, execute and validate any cutover."};
  console.log("PROTOCOLIA_V11_DEPLOYMENT_PRECHECK_PASS "+JSON.stringify(result));
  return result;
}
