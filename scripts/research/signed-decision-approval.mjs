#!/usr/bin/env node
// Domain decision approval — verified ed25519 key pin, not a claim of owner identity.
// The signing key MUST live outside model-visible workspaces and CI PRs.
import {createHash,createPublicKey,verify as cryptoVerify} from "node:crypto";
import {readFileSync,lstatSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const hash=x=>createHash("sha256").update(x).digest("hex");
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function requireThat(condition,message){if(!condition)throw Error(message);}
function readBounded(path,max=262144){
 const info=lstatSync(resolve(path));
 requireThat(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=max,"unsafe decision-gate input");
 return readFileSync(resolve(path));
}
function normalize(v){
 if(Array.isArray(v))return v.map(normalize);
 if(isObject(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])]));
 return v;
}
const same=(a,b)=>JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
function keys(x,fields,label){
 requireThat(isObject(x)&&Object.keys(x).length===fields.length&&
  Object.keys(x).every(k=>fields.includes(k)),label+" unexpected or missing fields");
}
function questionMap(input){
 requireThat(isObject(input)&&Array.isArray(input.questions)&&Array.isArray(input.requirements)&&isObject(input.project),
  "invalid intake structure");
 const m=new Map();
 for(const q of input.questions){
  requireThat(isObject(q)&&typeof q.id==="string"&&!m.has(q.id),"duplicate or malformed question");
  m.set(q.id,q);
 }
 return m;
}
function allowedChoice(q){
 return q.affectsSupported===true&&
  ["material_business","reversible_technical"].includes(q.classification);
}
function blockedState(q){
 return q.affectsSupported===true&&(q.state!=="resolved"||q.classification!=="reversible_technical");
}
export function createDecisionPayload(sourceBytes,candidateBytes){
 const source=JSON.parse(sourceBytes.toString("utf8"));
 const candidate=JSON.parse(candidateBytes.toString("utf8"));
 requireThat(source.schemaVersion==="protocolia-intake-project/v0.1"&&
  candidate.schemaVersion===source.schemaVersion,"incompatible intake schema");
 requireThat(same(source.project,candidate.project)&&same(source.requirements,candidate.requirements),
  "approval must not alter project or source requirements");
 const before=questionMap(source),after=questionMap(candidate);
 requireThat(before.size===after.size&&[...before.keys()].every(id=>after.has(id)),
  "approval cannot add, delete or relabel questions");
 const resolvedIds=[];
 for(const [id,original] of before){
  const current=after.get(id);
  const unchangedKeys=["id","question","classification","affectsSupported"];
  for(const k of unchangedKeys)requireThat(same(original[k],current[k]),"approval may not rewrite question "+id);
  // Candidate may only modify state, origin, evidenceRefs and decision, never unknown keys.
  requireThat(Object.keys(current).every(k=>[...unchangedKeys,"state","origin","evidenceRefs","decision"].includes(k)),
   "unexpected candidate question field");
  const changed=!same(original,current);
  if(!changed)continue;
  requireThat(allowedChoice(original),"protected question cannot be resolved through this approval flow: "+id);
  requireThat(original.state!=="resolved","already resolved question cannot be changed");
  requireThat(current.state==="resolved"&&current.origin==="approved_policy"&&
    typeof current.decision==="string"&&current.decision.trim().length>=12&&
    current.decision.length<=800&&!/[\u0000-\u001f\u007f]/.test(current.decision)&&
    Array.isArray(current.evidenceRefs)&&current.evidenceRefs.length===1&&
    current.evidenceRefs[0]==="signed-domain-scope-approval",
   "candidate requires explicit bounded reviewed decision and placeholder: "+id);
  resolvedIds.push(id);
 }
 requireThat(resolvedIds.length>0,"no reviewable changes");
 // No privileged/external/destructive operation can be approved through a mere domain scope attestation.
 for(const q of after.values())if(q.affectsSupported&&
  ["security_privilege","external_effect","destructive_change"].includes(q.classification))
  throw Error("privileged or external question requires separate policy/authorization: "+q.id);
 for(const q of after.values())if(blockedState(q)&&!resolvedIds.includes(q.id))
  throw Error("supported scope remains unresolved: "+q.id);
 return {
  schemaVersion:"protocolia-decision-approval/v1",
  purpose:"accept-existing-typed-profile-only",
  sourceSha256:hash(sourceBytes),
  candidateSha256:hash(candidateBytes),
  resolvedIds:resolvedIds.sort(),
  disclaimer:"Signature attests a reviewed scope decision, NOT actual implementation, production rights or personal identity."
 };
}
function payloadBytes(payload){return Buffer.from("PROTOCOLIA_DECISION_APPROVAL_V1\n"+JSON.stringify(payload),"utf8");}
export function validateSignedApproval({sourceBytes,candidateBytes,approval,publicKeyPem,pinnedPublicKeySha256}){
 const expected=createDecisionPayload(sourceBytes,candidateBytes);
 keys(approval,["payload","signatureBase64"],"signed approval");
 requireThat(same(approval.payload,expected),"signed approval payload does not match source and candidate");
 requireThat(typeof approval.signatureBase64==="string"&&/^[A-Za-z0-9+/]+={0,2}$/.test(approval.signatureBase64)&&
  approval.signatureBase64.length<=200,"malformed signature");
 requireThat(typeof pinnedPublicKeySha256==="string"&&/^[0-9a-f]{64}$/.test(pinnedPublicKeySha256),
  "trusted signer key fingerprint is mandatory");
 const key=createPublicKey(publicKeyPem);
 requireThat(key.asymmetricKeyType==="ed25519","only pinned Ed25519 keys permitted");
 const fingerprint=hash(key.export({type:"spki",format:"der"}));
 requireThat(fingerprint===pinnedPublicKeySha256,"untrusted signer key fingerprint");
 const signature=Buffer.from(approval.signatureBase64,"base64");
 requireThat(signature.length===64&&signature.toString("base64")===approval.signatureBase64,
  "noncanonical signature encoding");
 requireThat(cryptoVerify(null,payloadBytes(expected),key,signature),"invalid signed domain decision");
 return {status:"CRYPTOGRAPHICALLY_VERIFIED_SCOPE_DECISION_ONLY",
  sourceSha256:expected.sourceSha256,candidateSha256:expected.candidateSha256,
  signerPublicKeySha256:fingerprint,resolvedIds:expected.resolvedIds,
  limitation:"Key pin verifies a signature, not the person's identity or semantic accuracy of decisions."};
}
export function verifyFromFiles({sourcePath,candidatePath,approvalPath,publicKeyPath,pin}){
 const sourceBytes=readBounded(sourcePath),candidateBytes=readBounded(candidatePath),
 approval=JSON.parse(readBounded(approvalPath)),publicKeyPem=readBounded(publicKeyPath,16384);
 return validateSignedApproval({sourceBytes,candidateBytes,approval,publicKeyPem,pinnedPublicKeySha256:pin});
}
export function main(argv){
 if(argv[0]==="request"&&argv.length===3){
  const p=createDecisionPayload(readBounded(argv[1]),readBounded(argv[2]));
  process.stdout.write(JSON.stringify(p,null,2)+"\n");
  return 0;
 }
 if(argv[0]==="verify"&&argv.length===8&&argv[3]==="--approval"&&argv[5]==="--public-key"&&argv[7].startsWith("sha256:")){
  const x=verifyFromFiles({sourcePath:argv[1],candidatePath:argv[2],approvalPath:argv[4],
   publicKeyPath:argv[6],pin:argv[7].slice(7)});
  process.stdout.write(JSON.stringify(x,null,2)+"\n");return 0;
 }
 throw Error("Usage: signed-decision-approval.mjs request SOURCE.json CANDIDATE.json | verify SOURCE.json CANDIDATE.json --approval SIGNED.json --public-key PUB.pem sha256:PIN");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=main(process.argv.slice(2));}
 catch(e){process.stderr.write("DECISION_APPROVAL_REJECTED: "+String(e.message).slice(0,180)+"\n");process.exitCode=1;}
}
