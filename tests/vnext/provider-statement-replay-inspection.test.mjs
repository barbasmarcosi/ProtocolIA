import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,
  chmodSync,symlinkSync,renameSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {inspectLocalEventReplay} from
  "../../packages/adapters/provider-statement-replay-inspection.mjs";
import {consumeLocalSignedEvents} from
  "../../packages/adapters/provider-statement-event-replay.mjs";

const cli=resolve("scripts/vnext/inspect-provider-event-replay.mjs");
const digest=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sha="a".repeat(64);
const meta={providerId:"demo",orderId:"O1",statementSha256:sha};
const external=[{providerId:"demo",transactionId:"T1",eventId:"E1",
  kind:"capture",amount:"1.00",currency:"ARS"}];
const run=dir=>spawnSync(process.execPath,
  [cli,"--local-event-replay-dir",dir],{encoding:"utf8",timeout:10000});
function fixture(fn) {
  const root=mkdtempSync(join(tmpdir(),"pia-replay-inspection-"));
  const dir=join(root,"private");
  mkdirSync(dir,{mode:0o700});
  try {return fn({root,dir});}
  finally {rmSync(root,{recursive:true,force:true});}
}
function crashLock(dir) {
  const name=".pia-event-lock-"+digest(["ProtocolIA-S2C-provider-lock-v1","demo"]);
  writeFileSync(join(dir,name),JSON.stringify({version:1,
    providerId:"demo",statementSha256:sha})+"\n",{mode:0o600});
  return name;
}
test("read-only empty and claimed-event inspection; never treats local state as settlement",()=>{
  fixture(({dir})=>{
    const empty=inspectLocalEventReplay(dir);
    assert.equal(empty.state,"no_lock_observed");
    assert.equal(empty.eventMarkerCount,0);
    assert.equal(empty.replayCompletenessVerified,false);
    assert.equal(run(dir).status,0);
    consumeLocalSignedEvents({directory:dir,metadata:meta,external});
    const names=readdirSync(dir);
    const contents=names.map(n=>readFileSync(join(dir,n),"utf8"));
    const result=inspectLocalEventReplay(dir);
    assert.equal(result.eventMarkerCount,1);
    assert.equal(result.lockCount,0);
    assert.equal(result.providerIdentityVerified,false);
    assert.equal(result.settlementVerified,false);
    assert.equal(run(dir).status,0);
    assert.deepEqual(readdirSync(dir),names);
    assert.deepEqual(names.map(n=>readFileSync(join(dir,n),"utf8")),contents);
  });
});
test("durable crash lock yields manual-review exit 2 and is never auto-released",()=>{
  fixture(({dir})=>{
    consumeLocalSignedEvents({directory:dir,metadata:meta,external});
    const lock=crashLock(dir);
    const result=inspectLocalEventReplay(dir);
    assert.equal(result.state,"blocked_manual_review");
    assert.equal(result.lockCount,1);
    assert.equal(result.eventMarkerCount,1);
    const response=run(dir);
    assert.equal(response.status,2,response.stderr);
    assert.equal(JSON.parse(response.stdout).lockCount,1);
    assert.ok(readdirSync(dir).includes(lock));
    assert.throws(()=>consumeLocalSignedEvents({directory:dir,metadata:{
      ...meta,statementSha256:"b".repeat(64)},external:[
        {...external[0],eventId:"E2"}]}),/local event replay guard/);
    assert.ok(readdirSync(dir).includes(lock));
  });
});
test("corrupted, forged, overly permissive or symlinked markers fail closed",()=>{
  const mutations=[
    (dir,name)=>writeFileSync(join(dir,name),"{\"version\":1,\"version\":1}\n"),
    (dir,name)=>chmodSync(join(dir,name),0o644),
    (dir,name)=>{renameSync(join(dir,name),join(dir,"..","saved"));
      symlinkSync("../saved",join(dir,name));},
    (dir,name)=>writeFileSync(join(dir,name),"x".repeat(1025)),
    (dir,name)=>{const record=JSON.parse(readFileSync(join(dir,name),"utf8"));
      record.eventMarkerSha256="b".repeat(64);
      writeFileSync(join(dir,name),JSON.stringify(record)+"\n");}
  ];
  for(const mutate of mutations)fixture(({dir})=>{
    consumeLocalSignedEvents({directory:dir,metadata:meta,external});
    const name=readdirSync(dir)[0];
    mutate(dir,name);
    assert.throws(()=>inspectLocalEventReplay(dir),/local replay inspection/);
    const response=run(dir);
    assert.equal(response.status,1,response.stderr);
    assert.equal(response.stdout,"");
  });
});
test("forged crash locks, unexpected files and public or symlinked directories fail closed",()=>{
  fixture(({root,dir})=>{
    const lock=crashLock(dir);
    writeFileSync(join(dir,lock),"{}\n");
    assert.throws(()=>inspectLocalEventReplay(dir),/local replay inspection/);
  });
  fixture(({dir})=>{
    writeFileSync(join(dir,"unexpected"),"x");
    assert.equal(run(dir).status,1);
  });
  fixture(({root,dir})=>{
    chmodSync(dir,0o755);
    assert.equal(run(dir).status,1);
    chmodSync(dir,0o700);
    symlinkSync(dir,join(root,"alias"));
    assert.equal(run(join(root,"alias")).status,1);
  });
});
test("CLI rejects extra or missing arguments without touching state",()=>{
  fixture(({dir})=>{
    for(const args of [[],["--local-event-replay-dir"],[
      "--local-event-replay-dir",dir,"--unexpected","x"]]) {
      const r=spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
      assert.equal(r.status,1);
      assert.equal(r.stdout,"");
    }
    assert.deepEqual(readdirSync(dir),[]);
  });
});

test("stable forensic fingerprint can be pinned across independent read-only inspections",()=>{
  fixture(({dir})=>{
    const empty=inspectLocalEventReplay(dir);
    assert.match(empty.snapshotSha256,/^[0-9a-f]{64}$/);
    assert.deepEqual(inspectLocalEventReplay(dir),empty);
    const pinned=hash=>spawnSync(process.execPath,[cli,
      "--local-event-replay-dir",dir,"--expected-snapshot-sha256",hash],
      {encoding:"utf8",timeout:10000});
    const first=pinned(empty.snapshotSha256);
    assert.equal(first.status,0,first.stderr);
    assert.equal(JSON.parse(first.stdout).snapshotSha256,empty.snapshotSha256);
    consumeLocalSignedEvents({directory:dir,metadata:meta,external});
    const populated=inspectLocalEventReplay(dir);
    assert.notEqual(populated.snapshotSha256,empty.snapshotSha256);
    assert.equal(pinned(empty.snapshotSha256).status,1,
      "a previous clean scan must not silently accept new replay state");
    assert.equal(pinned(empty.snapshotSha256).stdout,"");
    assert.equal(pinned(populated.snapshotSha256).status,0);
    // A valid canonical marker may be modified without changing its name.
    // The independent baseline detects this even if format validation passes.
    const marker=readdirSync(dir)[0];
    const edited=JSON.parse(readFileSync(join(dir,marker),"utf8"));
    edited.orderId="O2";
    writeFileSync(join(dir,marker),JSON.stringify(edited)+"\n");
    const altered=inspectLocalEventReplay(dir);
    assert.equal(altered.eventMarkerCount,1);
    assert.notEqual(altered.snapshotSha256,populated.snapshotSha256);
    assert.equal(pinned(populated.snapshotSha256).status,1);
    assert.equal(pinned(altered.snapshotSha256).status,0);
    rmSync(join(dir,marker));
    assert.equal(inspectLocalEventReplay(dir).snapshotSha256,empty.snapshotSha256);
    assert.equal(pinned(altered.snapshotSha256).status,1);
    assert.deepEqual(readdirSync(dir),[]);
  });
});
test("invalid or duplicate forensic baseline flags are rejected without state writes",()=>{
  fixture(({dir})=>{
    for(const args of [
      ["--local-event-replay-dir",dir,"--expected-snapshot-sha256","a"],
      ["--expected-snapshot-sha256","A".repeat(64),"--local-event-replay-dir",dir],
      ["--local-event-replay-dir",dir,"--local-event-replay-dir",dir],
      ["--local-event-replay-dir",dir,"--unexpected","x"],
      ["--local-event-replay-dir",dir,"--expected-snapshot-sha256"]
    ]) {
      const response=spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
      assert.equal(response.status,1,response.stderr);
      assert.equal(response.stdout,"");
    }
    assert.deepEqual(readdirSync(dir),[]);
  });
});

test("read-only marker checkpoint excludes locks and rejects historical rollback",()=>{
  fixture(({dir})=>{
    const empty=inspectLocalEventReplay(dir);
    const pinned=hash=>spawnSync(process.execPath,[cli,
      "--local-event-replay-dir",dir,"--expected-event-markers-sha256",hash],
      {encoding:"utf8",timeout:10000});
    assert.equal(pinned(empty.eventMarkersSha256).status,0);
    consumeLocalSignedEvents({directory:dir,metadata:meta,external});
    const populated=inspectLocalEventReplay(dir);
    assert.notEqual(populated.eventMarkersSha256,empty.eventMarkersSha256);
    assert.equal(pinned(empty.eventMarkersSha256).status,1);
    assert.equal(pinned(populated.eventMarkersSha256).status,0);
    crashLock(dir);
    const blocked=inspectLocalEventReplay(dir);
    assert.equal(blocked.eventMarkersSha256,populated.eventMarkersSha256,
      "transient crash locks must not change the durable marker checkpoint");
    assert.notEqual(blocked.snapshotSha256,populated.snapshotSha256);
    assert.equal(pinned(populated.eventMarkersSha256).status,2,
      "a matching pin must not bypass a crash lock");
  });
});
test("inspector rejects malformed or duplicate event marker checkpoint pins",()=>{
  fixture(({dir})=>{
    for(const args of [
      ["--local-event-replay-dir",dir,"--expected-event-markers-sha256","X".repeat(64)],
      ["--local-event-replay-dir",dir,"--expected-event-markers-sha256","a"],
      ["--local-event-replay-dir",dir,"--expected-event-markers-sha256","a".repeat(64),
        "--expected-event-markers-sha256","a".repeat(64)]
    ]) {
      const result=spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
      assert.equal(result.status,1,result.stderr);
      assert.equal(result.stdout,"");
    }
    assert.deepEqual(readdirSync(dir),[]);
  });
});

test("v2 replay records bind event identity, transaction and monetary fields",()=>{
  fixture(({dir})=>{
    consumeLocalSignedEvents({directory:dir,metadata:meta,external});
    const name=readdirSync(dir)[0];
    const file=join(dir,name);
    const original=JSON.parse(readFileSync(file,"utf8"));
    assert.equal(original.version,2);
    assert.equal(original.eventId,"E1");
    assert.equal(original.transactionId,"T1");
    assert.equal(original.amount,"1.00");
    assert.equal(original.currency,"ARS");
    assert.equal(inspectLocalEventReplay(dir).legacyUnboundEventMarkerCount,0);
    for(const mutation of [
      record=>{record.eventId="OTHER-EVENT";},
      record=>{record.providerId="other-provider";},
      record=>{record.amount="0.00";},
      record=>{record.amount="1e3";},
      record=>{record.amount="1.0000000";},
      record=>{record.amount="9".repeat(38)+".1";},
      record=>{record.currency="ars";},
      record=>{record.transactionId="";},
      record=>{record.kind="settled";}
    ]) {
      const changed=structuredClone(original);
      mutation(changed);
      writeFileSync(file,JSON.stringify(changed)+"\n");
      assert.throws(()=>inspectLocalEventReplay(dir),/local replay inspection/,
        "a malformed or mismatched v2 marker must fail closed");
    }
    writeFileSync(file,JSON.stringify(original)+"\n");
    assert.equal(inspectLocalEventReplay(dir).eventMarkerCount,1);
  });
});

test("legacy v1 markers remain readable but explicitly unbound; new claims use v2",()=>{
  fixture(({dir})=>{
    consumeLocalSignedEvents({directory:dir,metadata:meta,external});
    const name=readdirSync(dir)[0];
    const file=join(dir,name);
    const v2=JSON.parse(readFileSync(file,"utf8"));
    const v1={version:1,statementSha256:v2.statementSha256,
      providerId:v2.providerId,orderId:v2.orderId,
      eventMarkerSha256:v2.eventMarkerSha256};
    writeFileSync(file,JSON.stringify(v1)+"\n");
    assert.equal(inspectLocalEventReplay(dir).legacyUnboundEventMarkerCount,1);
    const fresh=[{...external[0],eventId:"E2",transactionId:"T2"}];
    assert.equal(consumeLocalSignedEvents({directory:dir,metadata:meta,
      external:fresh}).consumedEventCount,1);
    const result=inspectLocalEventReplay(dir);
    assert.equal(result.eventMarkerCount,2);
    assert.equal(result.legacyUnboundEventMarkerCount,1);
    for(const invalid of [
      {...fresh[0],amount:"0.00"},
      {...fresh[0],amount:"-1.00"},
      {...fresh[0],amount:"1e2"},
      {...fresh[0],amount:"1.0000000"},
      {...fresh[0],amount:"1."+"0".repeat(2000)},
      {...fresh[0],amount:"9".repeat(38)+".1"},
      {...fresh[0],amount:"9".repeat(39)},
      {...fresh[0],currency:"ars"}
    ]) {
      assert.throws(()=>consumeLocalSignedEvents({directory:dir,metadata:meta,
        external:[{...invalid,eventId:"UNCLAIMED"}]}),/local event replay guard/);
      assert.equal(inspectLocalEventReplay(dir).eventMarkerCount,2);
    }
  });
});
