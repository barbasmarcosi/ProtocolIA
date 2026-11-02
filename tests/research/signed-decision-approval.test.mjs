import test from "node:test";
import assert from "node:assert/strict";
import {createHash,createPublicKey,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {gateway} from "../../scripts/research/agent-intake-gateway.mjs";
import {compileDraft} from "../../scripts/research/intake-to-typespec.mjs";
import {createDecisionPayload,validateSignedApproval,verifyFromFiles} from "../../scripts/research/signed-decision-approval.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const brief=join(root,"research/autonomous-engineering/samples/kiosk-owner-brief.json");
const proposal=join(root,"research/autonomous-engineering/trials/chat-agent-kiosk/proposal.json");
const sha=x=>createHash("sha256").update(x).digest("hex");
function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),"protocolia-signed-gate-"));
 const admitted=join(dir,"admitted"),original=join(admitted,"intake.json"),candidate=join(dir,"reviewed-intake.json");
 const approvedPath=join(dir,"signed-approval.json"),publicPath=join(dir,"trusted-key.pem"),out=join(dir,"contracts");
 try{
  gateway(brief,proposal,admitted);
  const copy=JSON.parse(readFileSync(original,"utf8"));
  for(const q of copy.questions.filter(q=>q.id==="K-Q03"||q.id==="K-Q04")){
   q.state="resolved";q.origin="approved_policy";q.evidenceRefs=["signed-domain-scope-approval"];
   q.decision=q.id==="K-Q03"?
    "Accept the bounded admin profile: positive stock increments only. Debits, sales and reconciliation remain out of scope.":
    "Accept exact stored string SKU uniqueness only. Case folding, trimming and Unicode canonicalization remain out of scope.";
  }
  writeFileSync(candidate,JSON.stringify(copy,null,2)+"\n");
  const sourceBytes=readFileSync(original),candidateBytes=readFileSync(candidate);
  const payload=createDecisionPayload(sourceBytes,candidateBytes);
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const pub=publicKey.export({type:"spki",format:"pem"});
  const pin=sha(publicKey.export({type:"spki",format:"der"}));
  const message=Buffer.from("PROTOCOLIA_DECISION_APPROVAL_V1\n"+JSON.stringify(payload));
  const signatureBase64=sign(null,message,privateKey).toString("base64");
  const approved={payload,signatureBase64};
  writeFileSync(publicPath,pub);
  writeFileSync(approvedPath,JSON.stringify(approved,null,2)+"\n");
  return fn({dir,original,candidate,approvedPath,publicPath,out,pin,approved,sourceBytes,candidateBytes,privateKey,publicKey});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
const args=x=>({sourcePath:x.original,candidatePath:x.candidate,approvalPath:x.approvedPath,publicKeyPath:x.publicPath,pin:x.pin});
test("unresolved material questions still block the original input",()=>fixture(x=>{
 assert.throws(()=>compileDraft(x.original,x.out),/K-Q03,K-Q04/);
 assert.equal(existsSync(x.out),false);
}));
test("resolved material questions cannot bypass approval by spoofing origin or evidence refs",()=>fixture(x=>{
 assert.throws(()=>compileDraft(x.candidate,x.out),/K-Q03,K-Q04/);
 assert.equal(existsSync(x.out),false);
}));
test("ephemeral pinned owner-decision key verifies scope-only attestation and enables existing profile",()=>fixture(x=>{
 const verified=verifyFromFiles(args(x));
 assert.equal(verified.status,"CRYPTOGRAPHICALLY_VERIFIED_SCOPE_DECISION_ONLY");
 assert.deepEqual(verified.resolvedIds,["K-Q03","K-Q04"]);
 assert.equal(verified.signerPublicKeySha256,x.pin);
 const build=compileDraft(x.candidate,x.out,"generate",args(x));
 assert.equal(build.status,"PARTIAL_DRAFT_UNVERIFIED");
 assert.equal(compileDraft(x.candidate,x.out,"verify",args(x)).status,"CONSISTENT_DRAFT_NOT_ATTESTED");
 const tsp=readFileSync(join(x.out,"contracts/main.tsp"),"utf8");
 assert.match(tsp,/atomicIncrement/);
 assert.ok(!tsp.includes("stockDebit")&&!tsp.includes("canonicalizeSku"));
 const report=JSON.parse(readFileSync(join(x.out,"protocolia-intake-report.json"),"utf8"));
 assert.deepEqual(report.signedScopeApproval.resolvedIds,["K-Q03","K-Q04"]);
 assert.equal(report.signedScopeApproval.signerPublicKeySha256,x.pin);
 assert.deepEqual(report.deferredRequirements,["K-04","K-05","K-06","K-07"]);
}));
test("signed material choice must preserve project and every source requirement",()=>fixture(x=>{
 const bad=JSON.parse(readFileSync(x.candidate,"utf8"));
 bad.requirements[0].text="Agent rewrote frozen business requirement";
 writeFileSync(x.candidate,JSON.stringify(bad));
 assert.throws(()=>verifyFromFiles(args(x)),/must not alter project or source requirements/);
 assert.throws(()=>compileDraft(x.candidate,x.out,"generate",args(x)),/must not alter project or source requirements/);
}));
test("cannot alter question meaning, classification or supported scope under a valid signature",()=>fixture(x=>{
 const bad=JSON.parse(readFileSync(x.candidate,"utf8"));
 bad.questions.find(q=>q.id==="K-Q03").classification="reversible_technical";
 writeFileSync(x.candidate,JSON.stringify(bad));
 assert.throws(()=>verifyFromFiles(args(x)),/may not rewrite question/);
}));
test("signature fails if candidate bytes change even when semantic fields remain identical",()=>fixture(x=>{
 const raw=readFileSync(x.candidate,"utf8");
 writeFileSync(x.candidate,raw.replace('"state": "resolved"','"state":"resolved"'));
 assert.throws(()=>verifyFromFiles(args(x)),/payload does not match/);
 assert.equal(existsSync(x.out),false);
}));
test("cannot substitute a public key, an unpinned key or a forged signature",()=>fixture(x=>{
 const {publicKey}=generateKeyPairSync("ed25519");
 const otherPem=publicKey.export({type:"spki",format:"pem"});
 assert.throws(()=>validateSignedApproval({sourceBytes:x.sourceBytes,candidateBytes:x.candidateBytes,
  approval:x.approved,publicKeyPem:otherPem,pinnedPublicKeySha256:x.pin}),/untrusted signer/);
 assert.throws(()=>validateSignedApproval({sourceBytes:x.sourceBytes,candidateBytes:x.candidateBytes,
  approval:x.approved,publicKeyPem:readFileSync(x.publicPath),pinnedPublicKeySha256:"0".repeat(64)}),/untrusted signer/);
 const forged=structuredClone(x.approved);
 forged.signatureBase64="A".repeat(86)+"==";
 assert.throws(()=>validateSignedApproval({sourceBytes:x.sourceBytes,candidateBytes:x.candidateBytes,
  approval:forged,publicKeyPem:readFileSync(x.publicPath),pinnedPublicKeySha256:x.pin}),/invalid signed domain decision/);
}));
test("signed material approval cannot authorize security, external or destructive actions",()=>fixture(x=>{
 const original=JSON.parse(readFileSync(x.original,"utf8"));
 const candidate=JSON.parse(readFileSync(x.candidate,"utf8"));
 const before=original.questions.find(q=>q.id==="K-Q03");
 const after=candidate.questions.find(q=>q.id==="K-Q03");
 before.classification="security_privilege";after.classification="security_privilege";
 writeFileSync(x.original,JSON.stringify(original));
 writeFileSync(x.candidate,JSON.stringify(candidate));
 assert.throws(()=>createDecisionPayload(readFileSync(x.original),readFileSync(x.candidate)),/protected question/);
}));
test("missing one signed material resolution cannot approve partial contract",()=>fixture(x=>{
 const edited=JSON.parse(readFileSync(x.candidate,"utf8"));
 const source=JSON.parse(readFileSync(x.original,"utf8"));
 edited.questions[edited.questions.findIndex(q=>q.id==="K-Q04")]=structuredClone(source.questions.find(q=>q.id==="K-Q04"));
 writeFileSync(x.candidate,JSON.stringify(edited));
 assert.throws(()=>createDecisionPayload(readFileSync(x.original),readFileSync(x.candidate)),/scope remains unresolved/);
}));
test("reproducible signed request has no private key, credentials or external action authority",()=>fixture(x=>{
 const request=createDecisionPayload(x.sourceBytes,x.candidateBytes);
 assert.deepEqual(request.resolvedIds,["K-Q03","K-Q04"]);
 assert.equal(request.purpose,"accept-existing-typed-profile-only");
 assert.equal(request.sourceSha256,sha(x.sourceBytes));
 assert.equal(request.candidateSha256,sha(x.candidateBytes));
 assert.doesNotMatch(JSON.stringify(request),/BEGIN PRIVATE KEY/);
 assert.match(request.disclaimer,/NOT actual implementation/);
}));
