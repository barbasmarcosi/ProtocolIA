// v1.1m: a *read-only* Ed25519 authorization gate for DISPOSABLE CI cutovers.
// This verifies an external signer; it never generates/accepts a private key,
// invokes Docker, starts an app, changes a database or grants production access.
import {createHash,createPublicKey,verify as verifySignature} from "node:crypto";
import {existsSync,lstatSync,readFileSync} from "node:fs";
import {dirname,relative,resolve,sep} from "node:path";
import {verifyCheckpoint} from "./database-checkpoint.mjs";
import {candidateOptions,verifyCandidate} from "./deployment-candidate.mjs";
import {recoveryOptions,verifyRecoveryRecord} from "./cutover-recovery.mjs";
import {ephemeralCutoverProject} from "./cutover-recovery.mjs";

const sha=buf=>createHash("sha256").update(buf).digest("hex");
const deny=m=>{throw Error("Disposable approval refused: "+m);};
const digest=/^[0-9a-f]{64}$/;
const allowedKeys=(data,expected)=>data&&typeof data==="object"&&
  !Array.isArray(data)&&Object.keys(data).sort().join("|")===expected.sort().join("|");
function checkedFile(path,{privateFile=false}={}){
  let st;
  try{st=lstatSync(path);}catch{deny("Required authorization file is missing");}
  if(!st.isFile()||(privateFile&&(st.mode&0o077)!==0))
    deny("Authorization must be a regular file (private JSON must be owner-only; symlinks refused)");
  return readFileSync(path);
}
const inside=(root,p)=>{
  const rel=relative(root,p);
  return !rel||!(rel===".."||rel.startsWith(".."+sep));
};
export function approvalOptions(args){
  const flags=["--checkpoint","--report","--receipt","--candidate",
    "--recovery","--project","--permit","--public-key","--key-sha256"];
  if(args.length!==19||flags.some((flag,i)=>args[i*2+1]!==flag))
    deny("Usage: app:deploy:permit:verify <generated-app> --checkpoint <old.dump> --report <preflight.json> --receipt <stage.json> --candidate <candidate.json> --recovery <recovery.json> --project <pia_ckpt_hex> --permit <signed.json> --public-key <trusted.pem> --key-sha256 <SPKI-hash>");
  const dir=resolve(args[0]),values=flags.map((_,i)=>args[i*2+2]);
  const [archive,report,receipt,candidate,recovery,project,permit,key,pin]=values;
  ephemeralCutoverProject(project);
  if(!digest.test(pin))deny("Trusted public key SPKI SHA-256 pin is required");
  const permitPath=resolve(permit),keyPath=resolve(key);
  const protectedPaths=[permitPath,keyPath].concat([archive,report,receipt,candidate,recovery].map(resolve));
  if(protectedPaths.some((p,i)=>protectedPaths.indexOf(p)!==i)|| 
     [permitPath,keyPath].some(p=>inside(dir,p))||
     !existsSync(dirname(permitPath))||!existsSync(dirname(keyPath)))
    deny("Permit/key paths must be distinct, existing, and outside the generated application");
  return {dir,archive:resolve(archive),report:resolve(report),receipt:resolve(receipt),
    candidate:resolve(candidate),recovery:resolve(recovery),
    project,permit:permitPath,key:keyPath,pin};
}
export function verifySignedPermit(document,key,{now=Date.now()}={}){
  const record=typeof document==="string"?JSON.parse(document):document;
  const claimNames=["audience","project","imageId","checkpointSha256",
    "candidateSha256","recoverySha256","issuedAt","expiresAt","nonce"];
  if(!allowedKeys(record,["schema","algorithm","claims","signature"])||
     record.schema!==1||record.algorithm!=="Ed25519"||
     !allowedKeys(record.claims,claimNames))
    deny("Unsigned/malformed permit or unexpected signed claims");
  const c=record.claims;
  if(c.audience!=="protocolia-disposable-cutover-v1")
    deny("Permit audience is not limited to disposable cutover");
  ephemeralCutoverProject(c.project);
  if(typeof c.imageId!=="string"||!/^sha256:[0-9a-f]{64}$/.test(c.imageId)||
     [c.checkpointSha256,c.candidateSha256,c.recoverySha256].some(s=>!digest.test(s))||
     typeof c.nonce!=="string"||!/^[0-9a-f]{32,64}$/.test(c.nonce))
    deny("Permit contains invalid image, digest or nonce");
  const issued=Date.parse(c.issuedAt),expires=Date.parse(c.expiresAt);
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||
     expires<=issued||expires-issued>15*60_000||
     issued>now+60_000||now<issued-60_000||expires<=now)
    deny("Permit is expired, premature or valid longer than 15 minutes");
  if(typeof record.signature!=="string"||
     !/^[A-Za-z0-9+/]{86}==$/.test(record.signature))
    deny("Expected one Ed25519 detached base64 signature");
  const signature=Buffer.from(record.signature,"base64");
  if(signature.length!==64||signature.toString("base64")!==record.signature)
    deny("Noncanonical Ed25519 signature encoding");
  const trusted=typeof key==="string"?createPublicKey(key):key;
  if(trusted.asymmetricKeyType!=="ed25519"||
     !verifySignature(null,Buffer.from(JSON.stringify(c)),trusted,signature))
    deny("Invalid Ed25519 signature from trusted operator");
  return c;
}
export function verifyExternalApproval(args,{
  imageInspector,stageImageInspector,oldImageInspector,now=Date.now()
}={}){
  const opts=approvalOptions(args);
  const key=createPublicKey(checkedFile(opts.key).toString("utf8"));
  if(key.asymmetricKeyType!=="ed25519")deny("Trusted key must be Ed25519");
  const keyHash=sha(key.export({format:"der",type:"spki"}));
  if(keyHash!==opts.pin)deny("Trusted signer public key differs from the pinned SPKI fingerprint");
  const raw=checkedFile(opts.permit,{privateFile:true});
  let document;
  try{document=JSON.parse(raw.toString("utf8"));}
  catch{deny("Malformed signed approval JSON");}
  const claims=verifySignedPermit(document,key,{now});
  if(claims.project!==opts.project)deny("Signed approval is scoped to a different Compose project");
  const recoveryArgs=[opts.dir,"--checkpoint",opts.archive,"--report",opts.report,
    "--receipt",opts.receipt,"--candidate",opts.candidate,"--out",opts.recovery];
  const evidence=recoveryOptions(recoveryArgs,{verify:true});
  const candidateRecord=verifyCandidate(evidence,{imageInspector,stageImageInspector});
  const recovered=verifyRecoveryRecord(evidence,{
    candidateInspector:imageInspector,stageImageInspector,oldImageInspector
  });
  const checkpoint=verifyCheckpoint(opts.archive);
  if(claims.imageId!==candidateRecord.stagedImageId||
     claims.checkpointSha256!==checkpoint.archiveSha256||
     claims.candidateSha256!==sha(checkedFile(opts.candidate,{privateFile:true}))||
     claims.recoverySha256!==sha(checkedFile(opts.recovery,{privateFile:true}))||
     recovered.stagedImageId!==claims.imageId||
     checkpoint.composeProject!==opts.project)
    deny("Signed approval does not match the tested image, old DB or recovery evidence");
  const result={project:opts.project,imageId:claims.imageId,
    signerKeySha256:keyHash,permitSha256:sha(raw),nonce:claims.nonce,
    expiresAt:claims.expiresAt,
    caution:"Signed disposable approval is a read-only guard; independent human identity and real DB write blocking are not guaranteed."};
  console.log("PROTOCOLIA_V11_DISPOSABLE_PERMIT_PASS "+JSON.stringify(result));
  return result;
}
