import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,symlinkSync,writeFileSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {sealApp} from "../../packages/cli/ownership.mjs";
import {stageOptions,verifyStageInputs,verifyStageReceipt} from "../../packages/cli/runtime-stage.mjs";
import {sourceOptions,compareSourceSnapshots} from "../../packages/cli/source-freshness.mjs";
import {parseImageRef,assertCandidateImage,createCandidate,verifyCandidate,candidateOptions,precheckCandidate,precheckOptions,postcheckCandidate,postcheckOptions} from "../../packages/cli/deployment-candidate.mjs";
import {pinnedOverlay,ephemeralCutoverProject,recoveryOptions,verifyRecoveryRecord} from "../../packages/cli/cutover-recovery.mjs";
import {verifySignedPermit,verifyExternalApproval,approvalOptions} from "../../packages/cli/disposable-approval.mjs";
import {fenceOptions,verifyDisposableFence} from "../../packages/cli/disposable-fence.mjs";
import {gateOptions,databaseGate,ledgerSQL,gateDatabaseStatements} from "../../packages/cli/disposable-db-gate.mjs";
import {roleSQL,roleOptions,disposableRolePolicy} from "../../packages/cli/disposable-role-policy.mjs";
import {runtimeRoleStatements,runtimePrincipalOptions,readRuntimeCredentials} from "../../packages/cli/disposable-runtime-principal.mjs";
import {oneShotOverlay,oneShotOverlayOptions,writeOneShotOverlay} from "../../packages/cli/disposable-one-shot-migrator.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"pia-stage-options-"));
  const dir=join(root,"app"),out=join(root,"receipt.json"),
    report=join(root,"report.json"),archive=join(root,"checkpoint.dump");
  const folder=join(dir,"src/migrations");
  mkdirSync(folder,{recursive:true});
  const oldContract="a".repeat(64),newContract="b".repeat(64);
  const sourceSnapshot={snapshot:{purchase_order:{columns:["code"],count:7,
    sha256:sha("row-digests")}},totalRows:7};
  const stagedImageId="sha256:"+"c".repeat(64);
  const ir={irVersion:"vnext-a0.1",operations:[{
    method:"GET",path:"/api/orders",behavior:{kind:"listPage"},capability:"orders.read"
  }]};
  const sql="ALTER TABLE purchase_order ADD COLUMN note VARCHAR(120);";
  writeFileSync(join(folder,"V2__protocolia_additive.sql"),
    "-- Non-destructive TypeSpec contract evolution; original baseline preserved\n"+sql+"\n");
  writeFileSync(join(dir,"protocolia-build.json"),
    JSON.stringify({target:"nestjs",contractSha256:newContract}));
  writeFileSync(join(dir,"protocolia-contract-ir.json"),JSON.stringify(ir));
  writeFileSync(join(dir,"protocolia-contract-openapi.json"),JSON.stringify({openapi:"3.0.0"}));
  writeFileSync(join(dir,"compose.yaml"),"services: {}\n");
  sealApp(dir);
  const bytes=Buffer.concat([Buffer.from("PGDMP"),Buffer.alloc(100,9)]);
  writeFileSync(archive,bytes,{mode:0o600});
  writeFileSync(archive+".json",JSON.stringify({
    version:1,format:"pg_dump-custom",target:"nestjs",
    contractSha256:oldContract,archiveBytes:bytes.length,
    composeProject:"pia_ckpt_test",databaseContainerId:"d".repeat(64),
    sourceAppImageId:"sha256:"+"e".repeat(64),
    archiveSha256:sha(bytes)
  }),{mode:0o600});
  const passed={schema:2,status:"pass",target:"nestjs",
    rowAttestation:"sha256-sorted-row-json-v1",
    sourceContractSha256:oldContract,checkpointSha256:sha(bytes),
    proposedSqlSha256:sha(sql),proposedIrSha256:sha(JSON.stringify(ir)),
    changeCount:1,isolatedNetwork:"none",originDatabaseAccess:false,
    tablesChecked:3,rowsChecked:7};
  writeFileSync(report,JSON.stringify(passed),{mode:0o600});
  const args=[dir,"--checkpoint",archive,"--report",report,"--out",out];
  return {root,dir,out,archive,report,ir,sql,passed,args,sourceSnapshot,stagedImageId};
}
test("runtime staging CLI requires explicit private proof and new output outside generated app",()=>{
  const f=fixture();
  assert.deepEqual(stageOptions(f.args),{
    dir:f.dir,archive:f.archive,report:f.report,out:f.out
  });
  for(const args of [
    f.args.slice(0,6),
    [f.dir,"--checkpoint",f.archive,"--report",f.report,"--oops",f.out],
    [f.dir,"--checkpoint",f.archive,"--report",f.report,"--out",join(f.dir,"unsafe.json")],
    [f.dir,"--checkpoint",f.archive,"--report",f.report,"--out",f.report],
    [f.dir,"--checkpoint",f.archive,"--report",f.report,"--out",join(f.root,"missing","receipt.json")]
  ])assert.throws(()=>stageOptions(args),/Runtime staging refused/);
});
test("staged app, prior archive, TypeSpec IR, SQL and owner seal bind exactly",()=>{
  const f=fixture(),opts=stageOptions(f.args);
  const checked=verifyStageInputs(opts);
  assert.equal(checked.binding.migrationVersion,2);
  assert.equal(checked.binding.migrationSqlSha256,sha(f.sql));
  const receipt={...checked.binding,receiptSchema:2,
    timestamp:new Date().toISOString(),
    stagedImageId:f.stagedImageId,sourceSnapshot:f.sourceSnapshot,
    sourceSnapshotSha256:sha(JSON.stringify(f.sourceSnapshot)),
    rowsAttested:7,tablesAttested:1,
    stagedAppHealthy:true,oldRowsPreserved:true,schemaLedgerAdvanced:true,
    genericReadPassed:true,stagedVolumeDestroyed:true};
  const imageInspector=id=>id===f.stagedImageId?id:null;
  writeFileSync(f.out,JSON.stringify(receipt),{mode:0o600});
  assert.throws(()=>stageOptions(f.args),/pre-existing receipt destination/);
  assert.deepEqual(stageOptions(f.args,{verify:true}),opts);
  assert.equal(verifyStageReceipt(stageOptions(f.args,{verify:true}),{imageInspector}).evolvedIrSha256,
    f.passed.proposedIrSha256);
  for(const [key,value] of [
    ["stagedVolumeDestroyed",false],["checkpointSha256","f".repeat(64)],
    ["migrationSqlSha256","f".repeat(64)],["sourceContractSha256","f".repeat(64)],
    ["installedOwnershipSha256","f".repeat(64)],["status","fail"],
    ["stagedImageId","sha256:"+"f".repeat(64)],
    ["sourceSnapshotSha256","a".repeat(64)],
    ["receiptSchema",1],["rowsAttested",9]
  ]){
    writeFileSync(f.out,JSON.stringify({...receipt,[key]:value}));
    assert.throws(()=>verifyStageReceipt(opts,{imageInspector}),/Runtime staging refused/,key);
  }
  writeFileSync(f.out,JSON.stringify(receipt));
  assert.throws(()=>verifyStageReceipt(opts,{imageInspector:()=>null}),/container image identity/);
  chmodSync(f.out,0o644);
  assert.throws(()=>verifyStageReceipt(opts,{imageInspector}),/owner-only/);
});
test("reject modified SQL, IR, report or actual checkpoint before any Docker work",()=>{
  const f=fixture(),opts=stageOptions(f.args);
  writeFileSync(f.report,JSON.stringify({...f.passed,proposedSqlSha256:"f".repeat(64)}));
  assert.throws(()=>verifyStageInputs(opts),/rehearsed canonical SQL/);
  writeFileSync(f.report,JSON.stringify(f.passed));
  chmodSync(f.report,0o644);
  assert.throws(()=>verifyStageInputs(opts),/owner-only/);
  chmodSync(f.report,0o600);
  writeFileSync(f.archive,Buffer.concat([Buffer.from("PGDMP"),Buffer.alloc(100,1)]));
  assert.throws(()=>verifyStageInputs(opts),/checksum, size or format/);
});
test("reject changed generated contract or source-backed report without refreshing seal",()=>{
  const f=fixture(),opts=stageOptions(f.args);
  writeFileSync(join(f.dir,"protocolia-contract-ir.json"),"{}");
  assert.throws(()=>verifyStageInputs(opts),/Managed files modified/);
  const g=fixture(),gopts=stageOptions(g.args);
  writeFileSync(g.report,JSON.stringify({...g.passed,proposedIrSha256:"0".repeat(64)}));
  assert.throws(()=>verifyStageInputs(gopts),/Evolved app does not match/);
  writeFileSync(g.report,JSON.stringify(g.passed),{mode:0o600});
  const alias=g.out+".symlink";
  writeFileSync(g.out,JSON.stringify({...verifyStageInputs(stageOptions(g.args)).binding}),
    {mode:0o600});
  symlinkSync(g.out,alias);
  assert.throws(()=>verifyStageReceipt({...gopts,out:alias}),/owner-only/);
});

test("source freshness parser requires explicit project, private env and paused-writes acknowledgment",()=>{
  const f=fixture(),env=join(f.root,"source.env");
  writeFileSync(env,"PROTOCOLIA_DB_PASSWORD=private\\n",{mode:0o600});
  const args=[f.dir,"--checkpoint",f.archive,"--report",f.report,
    "--receipt",f.out,"--project","pia_ckpt_test","--env-file",env,
    "--assert-writes-paused"];
  writeFileSync(f.out,"{}",{mode:0o600});
  assert.equal(sourceOptions(args).project,"pia_ckpt_test");
  for(const bad of [
    args.slice(0,-1),[...args.slice(0,8),"../../other",...args.slice(9)],
    [...args.slice(0,-1),"--wrong-ack"]
  ])assert.throws(()=>sourceOptions(bad),/Source freshness refused/);
  chmodSync(env,0o644);
  assert.throws(()=>sourceOptions(args),/owner-only/);
});
test("source snapshot comparison rejects same-row-count alterations, column drift and extra tables",()=>{
  const f=fixture(),expected=f.sourceSnapshot;
  assert.equal(compareSourceSnapshots(expected,structuredClone(expected)).rowsCompared,7);
  const changed=structuredClone(expected);
  changed.snapshot.purchase_order.sha256=sha("changed row while keeping count");
  assert.throws(()=>compareSourceSnapshots(expected,changed),/changed since the checkpoint/);
  const schema=structuredClone(expected);
  schema.snapshot.purchase_order.columns.push("extra_column");
  assert.throws(()=>compareSourceSnapshots(expected,schema),/changed since the checkpoint/);
  const extra=structuredClone(expected);
  extra.snapshot.other_table={columns:["id"],count:0,sha256:sha("")};
  assert.throws(()=>compareSourceSnapshots(expected,extra),/table set differs/);
});

function makeStageFixture(){
  const f=fixture(),input=verifyStageInputs(stageOptions(f.args));
  const stageReceipt={...input.binding,receiptSchema:2,
    timestamp:new Date().toISOString(),stagedImageId:f.stagedImageId,
    sourceSnapshot:f.sourceSnapshot,sourceSnapshotSha256:sha(JSON.stringify(f.sourceSnapshot)),
    rowsAttested:7,tablesAttested:1,
    stagedAppHealthy:true,oldRowsPreserved:true,schemaLedgerAdvanced:true,
    genericReadPassed:true,stagedVolumeDestroyed:true};
  writeFileSync(f.out,JSON.stringify(stageReceipt),{mode:0o600});
  const candidate=join(f.root,"candidate.json");
  const args=[f.dir,"--checkpoint",f.archive,"--report",f.report,
    "--receipt",f.out,"--image",f.stagedImageId,"--out",candidate];
  const adapters={
    stageImageInspector:id=>id===f.stagedImageId?id:null,
    imageInspector:ref=>({Id:f.stagedImageId,RepoDigests:[ref]})
  };
  return {...f,candidate,args,adapters,stageReceipt};
}
test("deployment candidate refuses mutable tags, unverified registry digests and mismatched local image",()=>{
  const f=makeStageFixture();
  for(const input of ["app:latest","docker.io/example/app:latest",
    "docker.io/example/app@sha256:abcdef","--help","docker.io/../bad@sha256:"+"a".repeat(64)])
    assert.throws(()=>parseImageRef(input),/Deployment candidate refused/);
  assert.equal(parseImageRef(f.stagedImageId),"local");
  const image="docker.io/org/protocolia@sha256:"+"e".repeat(64);
  assert.equal(parseImageRef(image),"registry");
  assert.equal(assertCandidateImage(image,f.stagedImageId,()=>({
    Id:f.stagedImageId,RepoDigests:[image]
  })),"registry");
  assert.throws(()=>assertCandidateImage(image,f.stagedImageId,()=>({
    Id:f.stagedImageId,RepoDigests:["docker.io/org/other@sha256:"+"f".repeat(64)]
  })),/RepoDigest/);
  assert.throws(()=>assertCandidateImage(f.stagedImageId,f.stagedImageId,
    ()=>({Id:"sha256:"+"f".repeat(64)})),/differs from/);
});
test("candidate creation and verification bind the exact staged image and receipt bytes",()=>{
  const f=makeStageFixture();
  const created=createCandidate(f.args,f.adapters);
  assert.equal(created.stagedImageId,f.stagedImageId);
  const opts=candidateOptions(f.args,{verify:true});
  assert.equal(verifyCandidate(opts,f.adapters).stageReceiptSha256,
    sha(readFileSync(f.out)));
  assert.throws(()=>candidateOptions(f.args),/Candidate output/);
  assert.equal(statSync(f.candidate).mode&0o077,0);
  const valid=JSON.parse(readFileSync(f.candidate,"utf8"));
  for(const [key,value] of [
    ["imageRef","sha256:"+"0".repeat(64)],["stageReceiptSha256","e".repeat(64)],
    ["stagedImageId","sha256:"+"f".repeat(64)],["migrationSqlSha256","0".repeat(64)],
    ["status","approved-for-production"]
  ]){
    writeFileSync(f.candidate,JSON.stringify({...valid,[key]:value}));
    assert.throws(()=>verifyCandidate(opts,f.adapters),/Deployment candidate refused/,key);
  }
  writeFileSync(f.candidate,JSON.stringify(valid));
  writeFileSync(f.out,JSON.stringify({...f.stageReceipt,timestamp:"2026-10-22T00:00:00.000Z"}));
  assert.throws(()=>verifyCandidate(opts,f.adapters),/stageReceiptSha256/);
});
test("pre-cutover precheck requires matching explicit image and delegates only read-only source verification",()=>{
  const f=makeStageFixture();
  createCandidate(f.args,f.adapters);
  const env=join(f.root,"private.env");
  writeFileSync(env,"PROTOCOLIA_DB_PASSWORD=private\n",{mode:0o600});
  const args=[f.dir,"--checkpoint",f.archive,"--report",f.report,
    "--receipt",f.out,"--candidate",f.candidate,
    "--project","pia_ckpt_test","--env-file",env,
    "--assert-writes-paused","--approve-image",f.stagedImageId];
  assert.equal(precheckOptions(args).options.imageRef,f.stagedImageId);
  for(const altered of [
    args.slice(0,-2),[...args.slice(0,-1),"sha256:"+"f".repeat(64)],
    [...args.slice(0,13),"--skip-write-pause",...args.slice(14)]
  ])assert.throws(()=>precheckOptions(altered),/Deployment candidate refused/);
  let calls=0;
  const result=precheckCandidate(args,{
    ...f.adapters,
    verifySource:sourceArgs=>{
      calls++;
      assert.equal(sourceArgs.at(-1),"--assert-writes-paused");
      return {composeProject:"pia_ckpt_test",databaseContainerId:"d".repeat(64),
        observedAt:"2026-10-22T02:00:00.000Z"};
    }
  });
  assert.equal(calls,1);
  assert.equal(result.imageId,f.stagedImageId);
  assert.equal(result.project,"pia_ckpt_test");
});

test("post-start guard accepts only the exactly staged running image with healthy loopback service",async()=>{
  const f=makeStageFixture();
  createCandidate(f.args,f.adapters);
  const env=join(f.root,"private.env");
  writeFileSync(env,"PROTOCOLIA_DB_PASSWORD=private\n",{mode:0o600});
  const args=[f.dir,"--checkpoint",f.archive,"--report",f.report,
    "--receipt",f.out,"--candidate",f.candidate,
    "--project","pia_ckpt_test","--env-file",env,
    "--health-url","http://127.0.0.1:24189/health"];
  assert.equal(postcheckOptions(args).healthUrl,"http://127.0.0.1:24189/health");
  const fakeDocker=(argv)=>{
    const action=argv.join(" ");
    if(action.includes("config --quiet"))return "";
    if(action.includes("ps --quiet db"))return "d".repeat(64);
    if(action.includes("ps --quiet app"))return "a".repeat(64);
    if(action.includes("inspect --format {{.Image}}"))return f.stagedImageId;
    throw Error("Unexpected Docker call "+action);
  };
  const checked=await postcheckCandidate(args,{
    ...f.adapters,runDocker:fakeDocker,probeHealth:async()=>200
  });
  assert.equal(checked.status,"observed-healthy");
  assert.equal(checked.imageId,f.stagedImageId);
  await assert.rejects(postcheckCandidate(args,{
    ...f.adapters,runDocker:argv=>argv.includes("{{.Image}}")?
      "sha256:"+"e".repeat(64):fakeDocker(argv),probeHealth:async()=>200
  }),/running application image differs/i);
  await assert.rejects(postcheckCandidate(args,{
    ...f.adapters,runDocker:fakeDocker,probeHealth:async()=>503
  }),/exact local \/health/);
  for(const unsafe of [
    "https://127.0.0.1:24189/health","http://example.org:24189/health",
    "http://127.0.0.1:24189/health?target=x",
    "http://127.0.0.1:24189/other","http://127.0.0.1:0/health"
  ])assert.throws(()=>postcheckOptions([...args.slice(0,-1),unsafe]),
    /Deployment candidate refused/);
});

test("pinned Compose overlay and CI project fence refuse mutable image and non-ephemeral targets",()=>{
  assert.equal(ephemeralCutoverProject("pia_ckpt_012345abcd"),"pia_ckpt_012345abcd");
  for(const unsafe of ["production","pia_ckpt_abc","pia_ckpt_012345abcd_extra","../pia_ckpt_012345abcd"])
    assert.throws(()=>ephemeralCutoverProject(unsafe),/Recovery rehearsal refused/);
  assert.match(pinnedOverlay("sha256:"+"c".repeat(64)),/pull_policy: never/);
  assert.match(pinnedOverlay("sha256:"+"c".repeat(64)),/build: !reset null/);
  for(const unsafe of ["app:latest","registry/app@sha256:"+"f".repeat(64)])
    assert.throws(()=>pinnedOverlay(unsafe),/Recovery rehearsal refused/);
});
test("isolated recovery receipt binds checkpoint, old image and pinned candidate without running Docker",()=>{
  const f=makeStageFixture();
  createCandidate(f.args,f.adapters);
  const destination=join(f.root,"recovery.json");
  const args=[f.dir,"--checkpoint",f.archive,"--report",f.report,
    "--receipt",f.out,"--candidate",f.candidate,"--out",destination];
  assert.equal(recoveryOptions(args).recoveryPath,destination);
  for(const unsafe of [
    [...args.slice(0,-1),f.out],[...args.slice(0,-1),join(f.dir,"recovery.json")],
    args.slice(0,-1)
  ])assert.throws(()=>recoveryOptions(unsafe),/Recovery rehearsal refused/);
  const expect={schema:1,status:"pass",oldImageId:"sha256:"+"e".repeat(64),
    stagedImageId:f.stagedImageId,
    originalCheckpointSha256:sha(readFileSync(f.archive)),
    candidateSha256:sha(readFileSync(f.candidate)),
    originalRowsSha256:sha(JSON.stringify(f.sourceSnapshot)),
    restoredOldSchema:true,restoredOldRows:true,
    originalRuntimeHealthy:true,recoveredFromInjectedOutage:true,
    isolatedVolumeDestroyed:true,completedAt:"2026-10-22T00:00:00.000Z"};
  const adapters={candidateInspector:f.adapters.imageInspector,
    stageImageInspector:f.adapters.stageImageInspector,oldImageInspector:id=>id};
  writeFileSync(destination,JSON.stringify(expect),{mode:0o600});
  assert.equal(verifyRecoveryRecord(recoveryOptions(args,{verify:true}),adapters).oldImageId,
    expect.oldImageId);
  for(const [key,value] of [["oldImageId",f.stagedImageId],
    ["candidateSha256","f".repeat(64)],["recoveredFromInjectedOutage",false],
    ["isolatedVolumeDestroyed",false],["originalRowsSha256","0".repeat(64)]]){
    writeFileSync(destination,JSON.stringify({...expect,[key]:value}));
    assert.throws(()=>verifyRecoveryRecord(recoveryOptions(args,{verify:true}),adapters),
      /Recovery rehearsal refused/,key);
  }
  writeFileSync(destination,JSON.stringify(expect));
  assert.throws(()=>verifyRecoveryRecord(recoveryOptions(args,{verify:true}),
    {...adapters,oldImageInspector:()=>null}),/original immutable application image/);
  chmodSync(destination,0o644);
  assert.throws(()=>verifyRecoveryRecord(recoveryOptions(args,{verify:true}),adapters),
    /owner-only/);
});

test("externally signed disposable Ed25519 approval is time-limited, project-scoped and rejects tampering",()=>{
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const claims={audience:"protocolia-disposable-cutover-v1",
    project:"pia_ckpt_012345abcd",imageId:"sha256:"+"a".repeat(64),
    checkpointSha256:"b".repeat(64),candidateSha256:"c".repeat(64),
    recoverySha256:"d".repeat(64),issuedAt:"2026-10-22T09:00:00.000Z",
    expiresAt:"2026-10-22T09:10:00.000Z",nonce:"e".repeat(32)};
  const issue=obj=>({schema:1,algorithm:"Ed25519",claims:obj,
    signature:sign(null,Buffer.from(JSON.stringify(obj)),privateKey).toString("base64")});
  const time=Date.parse("2026-10-22T09:05:00.000Z");
  assert.deepEqual(verifySignedPermit(issue(claims),publicKey,{now:time}),claims);
  assert.throws(()=>verifySignedPermit(issue(claims),publicKey,{now:time+600001}),
    /expired, premature/);
  const swapped={...claims,project:"pia_ckpt_ffffffffcc"};
  assert.throws(()=>verifySignedPermit({...issue(claims),claims:swapped},publicKey,{now:time}),
    /Invalid Ed25519 signature/);
  assert.throws(()=>verifySignedPermit(issue({...claims,expiresAt:"2026-10-22T10:01:00.000Z"}),
    publicKey,{now:time}),/15 minutes/);
  assert.throws(()=>verifySignedPermit(issue({...claims,audience:"protocolia-production"}),
    publicKey,{now:time}),/audience/);
  const second=generateKeyPairSync("ed25519").publicKey;
  assert.throws(()=>verifySignedPermit(issue(claims),second,{now:time}),/Invalid Ed25519 signature/);
  assert.throws(()=>verifySignedPermit({...issue(claims),unexpected:true},publicKey,{now:time}),
    /Unexpected|Unsigned|unexpected signed claims/);
});
test("approved permit binds recovery evidence, trusted SPKI key fingerprint, original checkpoint and project",()=>{
  const f=makeStageFixture();
  const sourceMeta=JSON.parse(readFileSync(f.archive+".json","utf8"));
  const project="pia_ckpt_012345abcd";
  writeFileSync(f.archive+".json",JSON.stringify({...sourceMeta,composeProject:project}),
    {mode:0o600});
  createCandidate(f.args,f.adapters);
  const recovery=join(f.root,"recovery.json");
  const evidence={schema:1,status:"pass",oldImageId:"sha256:"+"e".repeat(64),
    stagedImageId:f.stagedImageId,originalCheckpointSha256:sha(readFileSync(f.archive)),
    candidateSha256:sha(readFileSync(f.candidate)),
    originalRowsSha256:sha(JSON.stringify(f.sourceSnapshot)),
    restoredOldSchema:true,restoredOldRows:true,originalRuntimeHealthy:true,
    recoveredFromInjectedOutage:true,isolatedVolumeDestroyed:true,
    completedAt:"2026-10-22T09:00:00.000Z"};
  writeFileSync(recovery,JSON.stringify(evidence),{mode:0o600});
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const keyFile=join(f.root,"trusted.pem"),permit=join(f.root,"approval.json");
  writeFileSync(keyFile,publicKey.export({type:"spki",format:"pem"}));
  const pin=sha(publicKey.export({type:"spki",format:"der"}));
  const claims={audience:"protocolia-disposable-cutover-v1",project,
    imageId:f.stagedImageId,checkpointSha256:sha(readFileSync(f.archive)),
    candidateSha256:sha(readFileSync(f.candidate)),recoverySha256:sha(readFileSync(recovery)),
    issuedAt:"2026-10-22T09:00:00.000Z",expiresAt:"2026-10-22T09:14:00.000Z",
    nonce:"a".repeat(32)};
  const signed={schema:1,algorithm:"Ed25519",claims,
    signature:sign(null,Buffer.from(JSON.stringify(claims)),privateKey).toString("base64")};
  writeFileSync(permit,JSON.stringify(signed),{mode:0o600});
  const args=[f.dir,"--checkpoint",f.archive,"--report",f.report,
    "--receipt",f.out,"--candidate",f.candidate,"--recovery",recovery,
    "--project",project,"--permit",permit,"--public-key",keyFile,"--key-sha256",pin];
  const opts=approvalOptions(args);
  assert.equal(opts.project,project);
  const adapters={imageInspector:f.adapters.imageInspector,
    stageImageInspector:f.adapters.stageImageInspector,
    oldImageInspector:id=>id,
    now:Date.parse("2026-10-22T09:06:00.000Z")};
  assert.equal(verifyExternalApproval(args,adapters).signerKeySha256,pin);
  assert.throws(()=>verifyExternalApproval([...args.slice(0,-1),"0".repeat(64)],adapters),
    /key differs/);
  assert.throws(()=>verifyExternalApproval([...args.slice(0,12),"production",...args.slice(13)],adapters),
    /Recovery rehearsal refused|Disposable approval refused/);
  const altered={...evidence,originalRowsSha256:"f".repeat(64)};
  writeFileSync(recovery,JSON.stringify(altered));
  assert.throws(()=>verifyExternalApproval(args,adapters),/Recovery rehearsal refused/);
  writeFileSync(recovery,JSON.stringify(evidence));
  chmodSync(permit,0o644);
  assert.throws(()=>verifyExternalApproval(args,adapters),/owner-only/);
});
test("disposable SQL maintenance fence refuses running app, other sessions and changed containers",()=>{
  const f=makeStageFixture(),env=join(f.root,"guard.env");
  writeFileSync(env,"PROTOCOLIA_DB_PASSWORD=test\n",{mode:0o600});
  const args=[f.dir,"--project","pia_ckpt_012345abcd","--env-file",env,
    "--old-app-id","a".repeat(64),"--db-id","b".repeat(64)];
  assert.equal(fenceOptions(args).project,"pia_ckpt_012345abcd");
  const pass=argv=>{
    const str=argv.join(" ");
    if(str.includes("config --quiet"))return "";
    if(str.includes("ps --quiet db"))return "b".repeat(64);
    if(str.includes("ps --quiet app"))return "";
    if(str.includes("inspect --format {{.State.Running}}"))return "false";
    if(str.includes("pg_stat_activity"))return "0";
    throw Error("Unexpected fence Docker query "+str);
  };
  assert.equal(verifyDisposableFence(args,{runDocker:pass}).otherSqlClientSessions,0);
  for(const [match,value] of [["ps --quiet app","a".repeat(64)],
    ["ps --quiet db","f".repeat(64)],["pg_stat_activity","1"],
    ["inspect --format {{.State.Running}}","true"]]){
    assert.throws(()=>verifyDisposableFence(args,{runDocker:argv=>{
      const str=argv.join(" ");
      return str.includes(match)?value:pass(argv);
    }}),/Disposable write-fence refused/);
  }
  assert.throws(()=>fenceOptions([f.dir,"--project","production",...args.slice(3)]),
    /Recovery rehearsal refused/);
});

test("PostgreSQL gate statements target only fixed protocolia DB and validate quoted nonce claims",()=>{
  const sql=gateDatabaseStatements();
  assert.match(sql.close,/^ALTER DATABASE protocolia WITH ALLOW_CONNECTIONS false$/);
  assert.match(sql.open,/^ALTER DATABASE protocolia WITH ALLOW_CONNECTIONS true$/);
  assert.match(sql.terminate,/pg_terminate_backend/);
  assert.match(sql.verifyClosed,/NOT datallowconn/);
  const identity={nonce:"a".repeat(40),permitSha256:"b".repeat(64),
    project:"pia_ckpt_012345abcd",imageId:"sha256:"+"c".repeat(64),
    dbId:"d".repeat(64)};
  assert.match(ledgerSQL("consume",identity),/ON CONFLICT \(nonce\) DO NOTHING RETURNING nonce/);
  assert.match(ledgerSQL("release",identity),/state='released'/);
  for(const field of ["nonce","permitSha256","project","imageId","dbId"]){
    assert.throws(()=>ledgerSQL("consume",{...identity,[field]:"'; DROP DATABASE postgres; --"}),
      /Disposable PostgreSQL gate refused/);
  }
});
test("disposable PG gate closes all DB connections, reopens once, and refuses replay",()=>{
  const f=makeStageFixture(),env=join(f.root,"fenced.env");
  writeFileSync(env,"PROTOCOLIA_DB_PASSWORD=test\n",{mode:0o600});
  const signedArgs=[f.dir,"--checkpoint",f.archive,"--report",f.report,
    "--receipt",f.out,"--candidate",f.candidate,"--recovery",join(f.root,"recovery.json"),
    "--project","pia_ckpt_012345abcd","--permit",join(f.root,"permit.json"),
    "--public-key",join(f.root,"key.pem"),"--key-sha256","f".repeat(64)];
  const args=[...signedArgs,"--env-file",env,"--old-app-id","a".repeat(64),
    "--db-id","b".repeat(64)];
  assert.equal(gateOptions(args).fence.dbId,"b".repeat(64));
  assert.throws(()=>gateOptions([...args.slice(0,18),"production",...args.slice(19)]),
    /Disposable PostgreSQL gate refused|Disposable approval refused|Recovery rehearsal refused/);
  let closed=false,spent=false,engaged=false,released=false,fenceCalls=0;
  const nonce="d".repeat(40),permit="e".repeat(64);
  const inspector=argv=>{
    const s=argv.join(" ");
    if(s.includes("ps --quiet db"))return "b".repeat(64);
    if(s.includes("ps --quiet app"))return "";
    if(s.includes("inspect --format {{.State.Running}}"))return "false";
    if(!s.includes(" -d postgres "))throw Error("Unexpected nonmaintenance SQL "+s);
    const q=argv.at(-1);
    if(q.startsWith("SELECT datallowconn"))return closed?"false":"true";
    if(q.startsWith("CREATE TABLE"))return "";
    if(q.startsWith("INSERT INTO")){
      if(spent)return "";
      spent=true;return nonce;
    }
    if(q==="ALTER DATABASE protocolia WITH ALLOW_CONNECTIONS false"){
      closed=true;engaged=true;return "";
    }
    if(q.startsWith("SELECT pg_terminate_backend"))return "";
    if(q.startsWith("SELECT (NOT datallowconn"))return closed?"true":"false";
    if(q.startsWith("SELECT state FROM"))return engaged&&!released?"engaged":"released";
    if(q==="ALTER DATABASE protocolia WITH ALLOW_CONNECTIONS true"){
      closed=false;return "";
    }
    if(q.startsWith("UPDATE public.protocolia_disposable_cutover_gate_v1")){
      if(released)return "";
      released=true;return nonce;
    }
    throw Error("Unexpected SQL "+q);
  };
  const adapters={
    runDocker:inspector,
    verifyApproval:()=>({project:"pia_ckpt_012345abcd",
      imageId:"sha256:"+"c".repeat(64),permitSha256:permit,nonce}),
    verifyStoppedFence:()=>{fenceCalls++;}
  };
  assert.equal(databaseGate(args,{mode:"engage",...adapters}).engaged,true);
  assert.equal(closed,true);
  assert.equal(fenceCalls,1);
  assert.equal(databaseGate(args,{mode:"release",...adapters}).released,true);
  assert.equal(closed,false);
  assert.equal(released,true);
  assert.throws(()=>databaseGate(args,{mode:"engage",...adapters}),
    /replay forbidden/);
  assert.throws(()=>databaseGate(args,{mode:"release",...adapters}),
    /already released|reused nonce/);
});

test("external PostgreSQL roles have separate read/write privileges and cannot log in before health",async()=>{
  const f=makeStageFixture(),env=join(f.root,"roles.env");
  writeFileSync(env,"PROTOCOLIA_DB_PASSWORD=test\n",{mode:0o600});
  const gateArgs=[f.dir,"--checkpoint",f.archive,"--report",f.report,
    "--receipt",f.out,"--candidate",f.candidate,"--recovery",join(f.root,"recovery.json"),
    "--project","pia_ckpt_012345abcd","--permit",join(f.root,"permit.json"),
    "--public-key",join(f.root,"key.pem"),"--key-sha256","f".repeat(64),
    "--env-file",env,"--old-app-id","a".repeat(64),"--db-id","b".repeat(64)];
  const credentials=join(f.root,"external.json");
  const args=[...gateArgs,"--credentials",credentials];
  assert.equal(roleOptions(args,{mode:"prepare"}).file,credentials);
  assert.throws(()=>roleOptions([...args.slice(0,-1),join(f.dir,"bad.json")],
    {mode:"prepare"}),/Disposable role policy refused/);
  assert.throws(()=>roleSQL("create",{reader:"abc",writer:"f".repeat(48)}),
    /generated test secrets/);
  assert.match(roleSQL("grants").join("\n"),/GRANT SELECT,INSERT,UPDATE,DELETE/);
  assert.match(roleSQL("grants").join("\n"),/protocolia_audit_event/);
  assert.match(roleSQL("grants").join("\n"),/protocolia_migration_handoff_v1/);
  assert.match(roleSQL("tableCheck"),/protocolia_migration_handoff_v1/);
  assert.match(roleSQL("firstTable"),/protocolia_migration_handoff_v1/);
  let created=false,login=false,healthy=0;
  const mockDocker=(argv,{allowFailure=false}={})=>{
    const s=argv.join(" ");
    if(s.includes("ps --quiet db"))return "b".repeat(64);
    if(s.includes("ps --quiet app"))return "";
    const sql=argv.at(-1);
    if(sql===roleSQL("existing"))return created?"2":"0";
    if(sql===roleSQL("nonlogin"))return created&&!login?"2":"0";
    if(sql===roleSQL("login"))return created&&login?"2":"0";
    if(sql===roleSQL("tableCheck"))return "true";
    if(sql===roleSQL("firstTable"))return "purchase_order";
    if(sql.startsWith("SELECT attname FROM pg_attribute"))return "code";
    if(sql.startsWith("CREATE ROLE protocolia_ci_")){created=true;return "";}
    if(sql.startsWith("ALTER ROLE protocolia_ci_")&&sql.endsWith(" LOGIN")){
      login=true;return "";
    }
    if(sql.startsWith("GRANT ")||sql.startsWith("REVOKE ")||
       sql.startsWith("DO $$"))return "";
    if(allowFailure&&s.includes("-U protocolia_ci_writer")){
      return {status:login?0:1,stderr:login?"":"FATAL: role is not permitted to log in"};
    }
    if(allowFailure&&s.includes("-U protocolia_ci_reader")){
      return s.includes("UPDATE ")?
        {status:1,stderr:"ERROR: permission denied for table purchase_order"}:
        {status:0,stderr:""};
    }
    throw Error("Unexpected role SQL "+s);
  };
  const adapters={
    run:mockDocker,
    verifyApproval:()=>({project:"pia_ckpt_012345abcd",
      imageId:f.stagedImageId,permitSha256:"a".repeat(64)}),
    verifyHealth:async()=>{
      healthy++;return {imageId:f.stagedImageId,dbContainerId:"b".repeat(64)};
    }
  };
  assert.deepEqual(await disposableRolePolicy(args,{mode:"prepare",...adapters}),
    {prepared:true});
  assert.equal(statSync(credentials).mode&0o077,0);
  assert.equal((await disposableRolePolicy(args,{mode:"blocked",...adapters})).blocked,true);
  assert.equal(login,false);
  assert.equal(healthy,0);
  assert.deepEqual(await disposableRolePolicy([...args,"--health-url",
    "http://127.0.0.1:21456/health"],{mode:"activate",...adapters}),{activated:true});
  assert.equal(login,true);
  assert.equal(healthy,1);
  await assert.rejects(disposableRolePolicy(args,{mode:"blocked",...adapters}),
    /remain NOLOGIN/);
  await assert.rejects(disposableRolePolicy(args,{mode:"prepare",...adapters}),
    /Role credentials must be private/);
  chmodSync(credentials,0o644);
  await assert.rejects(disposableRolePolicy(args,{mode:"blocked",...adapters}),
    /owner-only/);
});

test("disposable runtime credentials are bound to a stopped disposable project and never privileged",()=>{
  const f=makeStageFixture(),env=join(f.root,"db.env");
  writeFileSync(env,"PROTOCOLIA_DB_PASSWORD=test\n",{mode:0o600});
  const args=[f.dir,"--checkpoint",f.archive,"--report",f.report,
    "--receipt",f.out,"--candidate",join(f.root,"candidate.json"),
    "--recovery",join(f.root,"recovery.json"),"--project","pia_ckpt_012345abcd",
    "--permit",join(f.root,"approval.json"),"--public-key",join(f.root,"trusted.pem"),
    "--key-sha256","a".repeat(64),"--env-file",env,
    "--old-app-id","b".repeat(64),"--db-id","c".repeat(64),
    "--credentials",join(f.root,"app-sql-runtime.json")];
  assert.equal(runtimePrincipalOptions(args).fence.project,"pia_ckpt_012345abcd");
  const secret="c".repeat(48),statements=runtimeRoleStatements(secret);
  assert.ok(statements.some(s=>s.startsWith("CREATE ROLE protocolia_app_runtime LOGIN NOSUPERUSER")));
  assert.ok(statements.some(s=>s.includes("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES")));
  assert.ok(statements.some(s=>s.includes("REVOKE ALL")&&s.includes("flyway_schema_history")));
  assert.ok(statements.every(s=>!s.includes("GRANT CREATE ON SCHEMA")));
  assert.throws(()=>runtimeRoleStatements("' DROP DATABASE postgres; --"),/Invalid generated SQL secret/);
  const cred={schema:1,project:"pia_ckpt_012345abcd",
    role:"protocolia_app_runtime",password:secret};
  writeFileSync(args.at(-1),JSON.stringify(cred),{mode:0o600});
  assert.equal(readRuntimeCredentials(args.at(-1),cred.project).password,secret);
  assert.throws(()=>readRuntimeCredentials(args.at(-1),"production"),/binding is invalid/);
  assert.throws(()=>runtimePrincipalOptions(args),/credential output/);
  chmodSync(args.at(-1),0o644);
  assert.throws(()=>runtimePrincipalOptions(args,{verify:true}),/owner-only/);
});

test("one-shot migration uses immutable pinned image and removes privileged vars from runtime",()=>{
  const staged="sha256:"+"e".repeat(64);
  for(const target of ["nestjs","modular-spring"]){
    const yaml=oneShotOverlay(staged,target);
    assert.match(yaml,/  migrate:\n    image: sha256:/);
    assert.match(yaml,/      PROTOCOLIA_EXECUTION_MODE: migrate/);
    assert.match(yaml,/      PROTOCOLIA_EXECUTION_MODE: runtime/);
    assert.match(yaml,/      PROTOCOLIA_MIGRATION_HANDOFF_ID: e{64}/);
    assert.match(yaml,/      PROTOCOLIA_MIGRATION_FAILPOINT: !reset null/);
    assert.match(yaml,/      PROTOCOLIA_HANDOFF_RUNTIME_USER: /);
    assert.match(yaml,/      PROTOCOLIA_MIGRATION_JDBC_USER: !reset null/);
    assert.match(yaml,/      PROTOCOLIA_MIGRATION_JDBC_PASSWORD: !reset null/);
    assert.match(yaml,/    pull_policy: never/);
    assert.match(yaml,/    build: !reset null/);
    assert.doesNotMatch(yaml,/ports:/);
  }
  for(const invalid of ["latest","registry/app@sha256:"+"b".repeat(64)])
    assert.throws(()=>oneShotOverlay(invalid,"nestjs"),/Disposable one-shot migrator refused/);
  assert.throws(()=>oneShotOverlay(staged,"unsupported"),/Disposable one-shot migrator refused/);
  const f=makeStageFixture(),output=join(f.root,"pinned-migrator.yaml");
  const args=[f.dir,"--target","nestjs","--image",staged,
    "--project","pia_ckpt_012345abcd","--out",output];
  assert.equal(oneShotOverlayOptions(args).target,"nestjs");
  writeOneShotOverlay(args);
  assert.equal(statSync(output).mode&0o077,0);
  assert.throws(()=>writeOneShotOverlay(args),/outside generated app/);
  assert.throws(()=>oneShotOverlayOptions([...args.slice(0,-1),join(f.dir,"cutover.yaml")]),
    /outside generated app/);
  assert.throws(()=>oneShotOverlayOptions([...args.slice(0,6),"production",...args.slice(7)]),
    /Recovery rehearsal refused/);
});

test("S2c provider one-shot overlay keeps migrator and HMAC ingress secrets out of opposite processes",()=>{
  const image="sha256:"+"b".repeat(64);
  for(const target of ["nestjs","modular-spring"]){
    const yaml=oneShotOverlay(image,target,{providerIngress:true});
    const app=yaml.split("  migrate:")[0];
    const migrator="  migrate:"+yaml.split("  migrate:")[1];
    assert.match(app,/PROTOCOLIA_EXECUTION_MODE: runtime/);
    assert.match(app,/PROTOCOLIA_JDBC_USER: \\$\\{PROTOCOLIA_RUNTIME_DB_USER:\?/);
    assert.match(app,/PROTOCOLIA_JDBC_PASSWORD: \\$\\{PROTOCOLIA_RUNTIME_DB_PASSWORD:\?/);
    assert.match(app,/PROTOCOLIA_PROVIDER_INGRESS_JDBC_USER: \\$\\{PROTOCOLIA_PROVIDER_INGRESS_DB_USER:\?/);
    assert.match(app,/PROTOCOLIA_PROVIDER_INGRESS_JDBC_PASSWORD: \\$\\{PROTOCOLIA_PROVIDER_INGRESS_DB_PASSWORD:\?/);
    assert.match(app,/PROTOCOLIA_MIGRATION_JDBC_USER: !reset null/);
    assert.match(app,/PROTOCOLIA_MIGRATION_JDBC_PASSWORD: !reset null/);
    assert.match(migrator,/profiles: \\[migration\\]/);
    assert.match(migrator,/condition: service_healthy/);
    assert.match(migrator,/PROTOCOLIA_EXECUTION_MODE: migrate/);
    assert.doesNotMatch(migrator,/PROTOCOLIA_PROVIDER_INGRESS_(?:DB|JDBC)_/);
    assert.doesNotMatch(migrator,/PROTOCOLIA_RUNTIME_DB_PASSWORD/);
    assert.doesNotMatch(app,/PROTOCOLIA_DB_PASSWORD:/);
    assert.doesNotMatch(app,/PROTOCOLIA_MIGRATION_DB_PASSWORD:/);
  }
  assert.throws(()=>oneShotOverlay(image,"nestjs",{providerIngress:"true"}),
    /Invalid provider ingress isolation option/);
  const f=makeStageFixture(),out=join(f.root,"provider-one-shot.yaml");
  const args=[f.dir,"--target","nestjs","--image",image,
    "--project","pia_ckpt_012345abcd","--out",out,"--provider-ingress"];
  assert.equal(oneShotOverlayOptions(args).providerIngress,true);
  writeOneShotOverlay(args);
  assert.equal(statSync(out).mode&0o077,0);
  assert.match(readFileSync(out,"utf8"),/PROTOCOLIA_PROVIDER_INGRESS_JDBC_USER/);
  assert.throws(()=>oneShotOverlayOptions([...args.slice(0,-1),"--unsafe"]),
    /Disposable one-shot migrator refused/);
});

test("one-shot template sources refuse incomplete image migration handoffs and expose transactional failpoints",()=>{
  const spring=readFileSync("packages/adapters/modular/templates/ContractApplication.java","utf8");
  const nest=readFileSync("packages/adapters/nest/templates/main.ts","utf8");
  assert.match(spring,/PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_BEFORE_COMMIT/);
  assert.match(spring,/PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_AFTER_COMMIT/);
  assert.match(spring,/PROTOCOLIA_MIGRATION_HANDOFF_ID/);
  assert.match(spring,/protocolia_migration_handoff_v1/);
  assert.match(spring,/GRANT SELECT ON public\.protocolia_migration_handoff_v1/);
  assert.match(nest,/PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_BEFORE_COMMIT/);
  assert.match(nest,/PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_AFTER_COMMIT/);
  assert.match(nest,/protocolia_migration_handoff_v1/);
  assert.match(nest,/if\(execution==="runtime"\)await engine.verifyRuntimeReady\(\)/);
  assert.match(nest,/ON CONFLICT \(image_digest\) DO NOTHING/);
  // The pause is only accepted in one-shot migrate mode; it fails closed if
  // the disposable Docker test does not send SIGKILL before its timeout.
  assert.match(spring,/pause-after-migrate/);
  assert.match(nest,/pause-after-commit/);
  assert.match(spring,/PROTOCOLIA_TEST_MIGRATION_PAUSED_AFTER_COMMIT/);
  assert.match(nest,/PROTOCOLIA_TEST_MIGRATION_PAUSED_AFTER_COMMIT/);
  assert.match(spring,/PROTOCOLIA_TEST_MIGRATION_PAUSE_NOT_INTERRUPTED/);
  assert.match(nest,/PROTOCOLIA_TEST_MIGRATION_PAUSE_NOT_INTERRUPTED/);
  const probe=readFileSync("scripts/vnext/probe-db-checkpoint.mjs","utf8");
  assert.match(probe,/PROTOCOLIA_V11_SIGKILL_HANDOFF_BLOCKED/);
  assert.match(probe,/PROTOCOLIA_V11_SIGKILL_RECOVERY_PASS/);
  assert.match(probe,/\["kill","--signal=KILL",killContainer\]/);
  assert.match(probe,/\["wait",killContainer\]/);
  assert.match(probe,/imageBoundHandoffExactlyOnce:true/);
});
