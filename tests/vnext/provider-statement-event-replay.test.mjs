import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync,
  symlinkSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawn,spawnSync} from "node:child_process";
import {signedStatementMessage} from "../../packages/adapters/provider-statement-signature.mjs";
import {consumeLocalSignedEvents} from "../../packages/adapters/provider-statement-event-replay.mjs";
import {inspectLocalEventReplay} from "../../packages/adapters/provider-statement-replay-inspection.mjs";

const cli=resolve("scripts/vnext/reconcile-provider-statement.mjs");
const sha=value=>createHash("sha256").update(value).digest("hex");
const utc=value=>new Date(value).toISOString().replace(".000Z","Z");
const payment={receiptId:"PAY-1",orderId:"OT-1",amount:"10.30",currency:"ARS",
  status:"posted",proofState:"unverified"};
const link={receiptId:"PAY-1",providerId:"sandbox",transactionId:"TX-1"};
const event={providerId:"sandbox",transactionId:"TX-1",eventId:"E-1",
  kind:"capture",amount:"10.30",currency:"ARS"};
const run=args=>spawnSync(process.execPath,args,{encoding:"utf8",timeout:15000});
function parallel(args) {
  return new Promise((resolveResult,reject)=>{
    const child=spawn(process.execPath,args,{stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";
    child.stdout.on("data",chunk=>stdout+=chunk);
    child.stderr.on("data",chunk=>stderr+=chunk);
    child.on("error",reject);
    child.on("close",status=>resolveResult({status,stdout,stderr}));
  });
}
function withFixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),"pia-event-replay-"));
  try {
    const {publicKey,privateKey}=generateKeyPairSync("ed25519");
    const pem=publicKey.export({type:"spki",format:"pem"});
    const fingerprint=sha(publicKey.export({type:"spki",format:"der"}));
    const now=Math.floor(Date.now()/1000)*1000;
    const base={version:1,providerId:"sandbox",keyId:"key-1",orderId:"OT-1",
      currency:"ARS",scale:2,validFrom:utc(now-60000),validUntil:utc(now+3600000)};
    const signMetadata=metadata=>({...metadata,signature:sign(null,
      signedStatementMessage(metadata),privateKey).toString("base64")});
    const setEvents=(events,space=0)=>{
      const bytes=JSON.stringify(events,null,space);
      const metadata=signMetadata({...base,statementSha256:sha(bytes)});
      writeFileSync(join(dir,"external.json"),bytes);
      writeFileSync(join(dir,"attestation.json"),JSON.stringify(metadata));
      return metadata;
    };
    writeFileSync(join(dir,"internal.json"),JSON.stringify([payment]));
    writeFileSync(join(dir,"links.json"),JSON.stringify([link]));
    writeFileSync(join(dir,"key.pem"),pem);
    const metadata=setEvents([event]);
    const guard=join(dir,"private");
    mkdirSync(guard,{mode:0o700});
    const args=[cli,"--internal",join(dir,"internal.json"),
      "--links",join(dir,"links.json"),"--external",join(dir,"external.json"),
      "--currency","ARS","--scale","2","--expected-order","OT-1",
      "--expected-provider","sandbox",
      "--external-attestation",join(dir,"attestation.json"),
      "--provider-public-key",join(dir,"key.pem"),
      "--trusted-key-sha256",fingerprint,"--local-event-replay-dir",guard];
    const value=fn({dir,guard,args,metadata,setEvents});
    if(value && typeof value.then==="function")
      return value.finally(()=>rmSync(dir,{recursive:true,force:true}));
    rmSync(dir,{recursive:true,force:true});
    return value;
  } catch(error) {rmSync(dir,{recursive:true,force:true});throw error;}
}
test("one signed event consumed once, re-encoded signed bytes still rejected",()=>{
  withFixture(f=>{
    const first=run(f.args);
    assert.equal(first.status,0,first.stderr);
    const proof=JSON.parse(first.stdout).externalStatementSignature;
    assert.equal(proof.replayProtection,"single_host_local_event_markers");
    assert.equal(proof.consumedEventCount,1);
    assert.equal(proof.providerIdentityVerified,false);
    assert.equal(proof.settlementVerified,false);
    assert.equal(readdirSync(f.guard).filter(name=>name.startsWith("event-")).length,1);
    const again=run(f.args);
    assert.equal(again.status,1,again.stderr);
    assert.equal(again.stdout,"");
    f.setEvents([event],2); // Same event ID, different bytes and valid new signature.
    const encoded=run(f.args);
    assert.equal(encoded.status,1,encoded.stderr);
    assert.equal(encoded.stdout,"");
    assert.equal(readdirSync(f.guard).length,1);
  });
});
test("overlapping reissued statement refuses all new events; disjoint event can later pass",()=>{
  withFixture(f=>{
    assert.equal(run(f.args).status,0);
    const fresh={...event,eventId:"E-2",kind:"refund",amount:"0.25"};
    f.setEvents([event,fresh]);
    const overlap=run(f.args);
    assert.equal(overlap.status,1,overlap.stderr);
    assert.equal(overlap.stdout,"");
    assert.equal(readdirSync(f.guard).length,1,
      "preflight duplicate cannot consume unrelated events or leave a lock");
    f.setEvents([fresh]);
    const independent=run(f.args);
    assert.equal(independent.status,2,independent.stderr);
    assert.equal(JSON.parse(independent.stdout).externalStatementSignature.consumedEventCount,1);
    assert.equal(readdirSync(f.guard).filter(name=>name.startsWith("event-")).length,2);
  });
});
test("ten simultaneous processes accept at most one signed event snapshot",async()=>{
  await withFixture(async f=>{
    const results=await Promise.all(Array.from({length:10},()=>parallel(f.args)));
    assert.equal(results.filter(r=>r.status===0).length,1,JSON.stringify(results));
    assert.equal(results.filter(r=>r.status===1).length,9);
    for(const r of results.filter(r=>r.status===1)) {
      assert.equal(r.stdout,"");
      assert.match(r.stderr,/local event replay guard/);
    }
    assert.equal(readdirSync(f.guard).length,1);
  });
});
test("stale provider lock from interrupted write blocks all new events, no silent recovery",()=>{
  withFixture(f=>{
    const lock=".pia-event-lock-"+sha(JSON.stringify([
      "ProtocolIA-S2C-provider-lock-v1","sandbox"]));
    writeFileSync(join(f.guard,lock),"interrupted\n",{mode:0o600});
    const blocked=run(f.args);
    assert.equal(blocked.status,1,blocked.stderr);
    assert.equal(blocked.stdout,"");
    assert.deepEqual(readdirSync(f.guard),[lock]);
  });
});
test("invalid signed data and private-directory violations cannot consume events",()=>{
  withFixture(f=>{
    writeFileSync(join(f.dir,"external.json"),JSON.stringify([{...event,amount:"9.99"}]));
    assert.equal(run(f.args).status,1);
    assert.equal(readdirSync(f.guard).length,0);
    f.setEvents([event]);
    const publicDir=join(f.dir,"public");
    mkdirSync(publicDir);chmodSync(publicDir,0o777);
    assert.equal(run([...f.args.slice(0,-1),publicDir]).status,1);
    const alias=join(f.dir,"alias");
    symlinkSync(f.guard,alias);
    assert.equal(run([...f.args.slice(0,-1),alias]).status,1);
    assert.equal(readdirSync(f.guard).length,0);
    const dual=run([...f.args,"--local-replay-dir",f.guard]);
    assert.equal(dual.status,1);
    assert.equal(dual.stdout,"");
  });
});
test("corrupted historical replay marker cannot be bypassed by a disjoint signed event",()=>{
  withFixture(f=>{
    assert.equal(run(f.args).status,0);
    const existing=readdirSync(f.guard)[0];
    writeFileSync(join(f.guard,existing),"{}\n");
    f.setEvents([{...event,eventId:"E-2"}]);
    const rejected=run(f.args);
    assert.equal(rejected.status,1,rejected.stderr);
    assert.equal(rejected.stdout,"");
    assert.match(rejected.stderr,/local event replay guard/);
    assert.deepEqual(readdirSync(f.guard),[existing],
      "no new event or provider lock should be created on corrupt state");
  });
});
test("unexpected state files and another provider's crash lock block all new claims",()=>{
  withFixture(f=>{
    writeFileSync(join(f.guard,"unreviewed"),"not a replay marker");
    const denied=run(f.args);
    assert.equal(denied.status,1,denied.stderr);
    assert.equal(denied.stdout,"");
    assert.deepEqual(readdirSync(f.guard),["unreviewed"]);
  });
  withFixture(f=>{
    const other="another-provider";
    const lock=".pia-event-lock-"+sha(JSON.stringify([
      "ProtocolIA-S2C-provider-lock-v1",other]));
    writeFileSync(join(f.guard,lock),JSON.stringify({
      version:1,providerId:other,statementSha256:"a".repeat(64)})+"\n",
      {mode:0o600});
    const denied=run(f.args);
    assert.equal(denied.status,1,denied.stderr);
    assert.equal(denied.stdout,"");
    assert.deepEqual(readdirSync(f.guard),[lock]);
  });
});
test("intact historical state still accepts a new disjoint signed event",()=>{
  withFixture(f=>{
    assert.equal(run(f.args).status,0);
    f.setEvents([{...event,eventId:"E-2"}]);
    const accepted=run(f.args);
    assert.equal(accepted.status,0,accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).externalStatementSignature.consumedEventCount,1);
    assert.equal(readdirSync(f.guard).filter(n=>n.startsWith("event-")).length,2);
  });
});
test("direct guard rejects duplicate IDs, provider mismatches, empty or oversized sets",()=>{
  withFixture(f=>{
    for(const external of [
      [],[event,event],[{...event,providerId:"other"}],
      [{...event,eventId:123}], [{...event,transactionId:123}],
      Array.from({length:513},(_,i)=>({...event,eventId:"E-"+i}))
    ]) {
      assert.throws(()=>consumeLocalSignedEvents({
        directory:f.guard,metadata:f.metadata,external}),/local event replay guard/);
      assert.equal(readdirSync(f.guard).length,0);
    }
  });
});

test("event identity is provider-wide across orders within one tenant directory",()=>{
  withFixture(f=>{
    const first=consumeLocalSignedEvents({
      directory:f.guard,metadata:f.metadata,external:[event]});
    assert.equal(first.consumedEventCount,1);
    const otherOrder={...f.metadata,orderId:"OT-2"};
    assert.throws(()=>consumeLocalSignedEvents({
      directory:f.guard,metadata:otherOrder,external:[event]}),
    /local event replay guard/);
    assert.equal(readdirSync(f.guard).length,1);
  });
});


test("validly signed but aggregate-overflowing events never consume replay markers",()=>{
  withFixture(f=>{
    const maximum="9".repeat(36)+".99";
    f.setEvents([
      {...event,eventId:"OVER-1",amount:maximum},
      {...event,eventId:"OVER-2",amount:maximum}
    ]);
    const rejected=run(f.args);
    assert.equal(rejected.status,1,rejected.stderr);
    assert.equal(rejected.stdout,"");
    assert.match(rejected.stderr,/unsupported aggregate precision/);
    assert.deepEqual(readdirSync(f.guard),[],
      "overflowing comparison must not burn a durable event or lock");
    f.setEvents([event]);
    const valid=run(f.args);
    assert.equal(valid.status,0,valid.stderr);
    assert.equal(readdirSync(f.guard).filter(name=>name.startsWith("event-")).length,1);
  });
});

test("signed split captures remain review exceptions and still consume event IDs",()=>{
  withFixture(f=>{
    f.setEvents([{...event,amount:"4.00"},
      {...event,eventId:"E-2",amount:"6.30"}]);
    const reviewed=run(f.args);
    assert.equal(reviewed.status,2,reviewed.stderr);
    const report=JSON.parse(reviewed.stdout);
    assert.equal(report.rows[0].classification,"multiple_capture_events_require_review");
    assert.equal(report.externalStatementSignature.consumedEventCount,2);
    assert.equal(report.externalStatementSignature.settlementVerified,false);
    assert.equal(readdirSync(f.guard).filter(x=>x.startsWith("event-")).length,2);
    const replay=run(f.args);
    assert.equal(replay.status,1,replay.stderr);
    assert.equal(replay.stdout,"");
  });
});


test("signed repeated refunds are review exceptions and all event IDs are consumed",()=>{
  withFixture(f=>{
    f.setEvents([event,
      {...event,eventId:"REF-1",kind:"refund",amount:"0.10"},
      {...event,eventId:"REF-2",kind:"refund",amount:"0.20"}]);
    const reviewed=run(f.args);
    assert.equal(reviewed.status,2,reviewed.stderr);
    const report=JSON.parse(reviewed.stdout);
    assert.equal(report.rows[0].classification,"multiple_return_events_require_review");
    assert.deepEqual(report.exceptions.map(x=>x.code),[
      "external_return_requires_review","multiple_return_events_require_review"
    ]);
    assert.equal(report.externalStatementSignature.consumedEventCount,3);
    assert.equal(report.externalStatementSignature.settlementVerified,false);
    assert.equal(readdirSync(f.guard).filter(x=>x.startsWith("event-")).length,3);
    const replay=run(f.args);
    assert.equal(replay.status,1,replay.stderr);
    assert.equal(replay.stdout,"");
  });
});

test("signed matching provider refund cannot hide two local recorded refunds; replay consumed",()=>{
  withFixture(f=>{
    const returnsPath=join(f.dir,"returns.json");
    writeFileSync(returnsPath,JSON.stringify([
      {receiptId:"PAY-1",returnId:"R-1",kind:"refund",amount:"0.10",currency:"ARS",status:"recorded"},
      {receiptId:"PAY-1",returnId:"R-2",kind:"refund",amount:"0.20",currency:"ARS",status:"recorded"}
    ]));
    f.setEvents([event,{...event,eventId:"EXT-R",kind:"refund",amount:"0.30"}]);
    const args=[...f.args,"--internal-returns",returnsPath];
    const reviewed=run(args);
    assert.equal(reviewed.status,2,reviewed.stderr);
    const report=JSON.parse(reviewed.stdout);
    assert.equal(report.rows[0].classification,"multiple_recorded_return_events_require_review");
    assert.deepEqual(report.exceptions.map(x=>x.code),
      ["multiple_recorded_return_events_require_review"]);
    assert.equal(report.externalStatementSignature.consumedEventCount,2);
    assert.equal(readdirSync(f.guard).filter(x=>x.startsWith("event-")).length,2);
    const replay=run(args);
    assert.equal(replay.status,1,replay.stderr);
    assert.equal(replay.stdout,"");
  });
});

test("signed mixed provider refund and chargeback require review yet consume replay IDs",()=>{
  withFixture(f=>{
    f.setEvents([event,
      {...event,eventId:"REF-A",kind:"refund",amount:"0.25"},
      {...event,eventId:"CB-A",kind:"chargeback",amount:"0.30"}]);
    const reviewed=run(f.args);
    assert.equal(reviewed.status,2,reviewed.stderr);
    const report=JSON.parse(reviewed.stdout);
    assert.equal(report.rows[0].classification,"mixed_provider_return_kinds_require_review");
    assert.deepEqual(report.exceptions.map(x=>x.code),[
      "external_return_requires_review","mixed_provider_return_kinds_require_review"
    ]);
    assert.equal(report.externalStatementSignature.consumedEventCount,3);
    assert.equal(report.externalStatementSignature.settlementVerified,false);
    assert.equal(readdirSync(f.guard).filter(x=>x.startsWith("event-")).length,3);
    const replay=run(f.args);
    assert.equal(replay.status,1,replay.stderr);
    assert.equal(replay.stdout,"");
  });
});


test("operator-pinned provider registry binds signed key before any event replay write",()=>{
  withFixture(f=>{
    const fingerprint=f.args[f.args.indexOf("--trusted-key-sha256")+1];
    const registry={version:1,providers:[{providerId:"sandbox",keys:[{
      keyId:"key-1",spkiSha256:fingerprint,status:"active",
      validFrom:"2025-01-01T00:00:00Z",validUntil:"2028-01-01T00:00:00Z"
    }]}]};
    const file=join(f.dir,"registry.json");
    const save=value=>{
      const bytes=JSON.stringify(value);
      writeFileSync(file,bytes);
      return sha(bytes);
    };
    const flags=pin=>["--provider-trust-registry",file,"--trusted-registry-sha256",pin];
    const pin=save(registry);
    const first=run([...f.args,...flags(pin)]);
    assert.equal(first.status,0,first.stderr);
    const report=JSON.parse(first.stdout);
    assert.equal(report.externalStatementSignature.providerRegistryBinding.trustScope,
      "operator_pinned_registry_only");
    assert.equal(report.externalStatementSignature.providerRegistryBinding.registrySha256,pin);
    assert.equal(report.externalStatementSignature.providerRegistryBinding.providerIdentityVerified,false);
    assert.equal(report.externalStatementSignature.consumedEventCount,1);
    assert.equal(readdirSync(f.guard).length,1);
    const replay=run([...f.args,...flags(pin)]);
    assert.equal(replay.status,1,replay.stderr);
    assert.equal(replay.stdout,"");
  });
});

test("revoked, misbound, stale and ambiguous registries reject before replay claims",()=>{
  withFixture(f=>{
    const fingerprint=f.args[f.args.indexOf("--trusted-key-sha256")+1];
    const registry={version:1,providers:[{providerId:"sandbox",keys:[{
      keyId:"key-1",spkiSha256:fingerprint,status:"active",
      validFrom:"2025-01-01T00:00:00Z",validUntil:"2028-01-01T00:00:00Z"
    }]}]};
    const file=join(f.dir,"registry.json");
    const save=value=>{
      const bytes=JSON.stringify(value);
      writeFileSync(file,bytes);
      return sha(bytes);
    };
    const flags=pin=>["--provider-trust-registry",file,"--trusted-registry-sha256",pin];
    const originalPin=save(registry);
    const badPin=run([...f.args,...flags("f".repeat(64))]);
    assert.equal(badPin.status,1,badPin.stderr);
    assert.equal(badPin.stdout,"");
    const variants=[
      v=>{v.providers[0].keys[0].status="revoked";},
      v=>{v.providers[0].keys[0].spkiSha256="f".repeat(64);},
      v=>{v.providers[0].keys[0].keyId="other";},
      v=>{v.providers[0].keys[0].validUntil="2020-01-01T00:00:00Z";},
      v=>{v.providers.push(structuredClone(v.providers[0]));},
      v=>{v.providers[0].keys[0].extra="unsafe";}
    ];
    for(const mutate of variants) {
      const value=structuredClone(registry);mutate(value);
      const rejected=run([...f.args,...flags(save(value))]);
      assert.equal(rejected.status,1,rejected.stderr);
      assert.equal(rejected.stdout,"");
      assert.deepEqual(readdirSync(f.guard),[]);
    }
    save(registry);
    assert.equal(run([...f.args,...flags(originalPin)]).status,0);
    assert.equal(readdirSync(f.guard).length,1);
  });
});

test("partial registry trust flags are rejected before event replay",()=>{
  withFixture(f=>{
    const registry=join(f.dir,"registry.json");
    writeFileSync(registry,"{}");
    for(const extra of [
      ["--provider-trust-registry",registry],
      ["--trusted-registry-sha256","a".repeat(64)],
      ["--provider-trust-registry",registry,"--provider-trust-registry",registry]
    ]) {
      const rejected=run([...f.args,...extra]);
      assert.equal(rejected.status,1,rejected.stderr);
      assert.equal(rejected.stdout,"");
      assert.deepEqual(readdirSync(f.guard),[]);
    }
  });
});

test("overlapping valid locks from different providers never strand our unwritten lock",()=>{
  withFixture(f=>{
    // Deterministically introduce a second provider's canonical lock exactly
    // after this writer's O_EXCL create and before its post-lock inspection.
    // This exercises the real filesystem path, without timing-dependent sleeps.
    const script=`
      import fs from "node:fs";
      import {syncBuiltinESMExports} from "node:module";
      import {createHash} from "node:crypto";
      import {join} from "node:path";
      const dir=process.argv[1];
      const other="independent-provider";
      const sha="b".repeat(64);
      const lock=".pia-event-lock-"+createHash("sha256").update(JSON.stringify([
        "ProtocolIA-S2C-provider-lock-v1",other])).digest("hex");
      const original=fs.openSync;
      let injected=false;
      fs.openSync=function(path,flags,...rest) {
        const fd=original.call(this,path,flags,...rest);
        if(!injected && String(path).includes(".pia-event-lock-") &&
           (flags & fs.constants.O_EXCL)) {
          injected=true;
          fs.writeFileSync(join(dir,lock),JSON.stringify({
            version:1,providerId:other,statementSha256:sha})+"\\n",{mode:0o600});
        }
        return fd;
      };
      syncBuiltinESMExports();
      const {consumeLocalSignedEvents}=await import(
        "./packages/adapters/provider-statement-event-replay.mjs");
      try {
        consumeLocalSignedEvents({
          directory:dir,
          metadata:{providerId:"sandbox",orderId:"OT-1",
            statementSha256:"a".repeat(64)},
          external:[{providerId:"sandbox",transactionId:"TX-1",eventId:"E-1",
            kind:"capture",amount:"10.30",currency:"ARS"}]});
        process.exitCode=3;
      } catch(error) {
        if(!String(error).includes("local event replay guard"))process.exitCode=4;
      }
    `;
    const result=spawnSync(process.execPath,
      ["--input-type=module","-e",script,f.guard],{encoding:"utf8",timeout:10000});
    assert.equal(result.status,0,result.stderr);
    const otherLock=".pia-event-lock-"+sha(JSON.stringify([
      "ProtocolIA-S2C-provider-lock-v1","independent-provider"]));
    assert.deepEqual(readdirSync(f.guard),[otherLock],
      "only the foreign provider's lock may remain; ours wrote no markers");
    rmSync(join(f.guard,otherLock));
    const recovered=consumeLocalSignedEvents({
      directory:f.guard,metadata:f.metadata,external:[event]});
    assert.equal(recovered.consumedEventCount,1);
    assert.equal(readdirSync(f.guard).filter(x=>x.startsWith("event-")).length,1);
  });
});

test("operator-pinned event checkpoint advances only on a valid new signed claim",()=>{
  withFixture(f=>{
    const initial=inspectLocalEventReplay(f.guard).eventMarkersSha256;
    assert.match(initial,/^[0-9a-f]{64}$/);
    const flags=pin=>[...f.args,"--expected-event-markers-sha256",pin];
    const first=run(flags(initial));
    assert.equal(first.status,0,first.stderr);
    const proof=JSON.parse(first.stdout).externalStatementSignature;
    assert.equal(proof.eventMarkerCheckpointScope,
      "operator_pinned_local_markers_only");
    assert.equal(proof.nextEventMarkersSha256,
      inspectLocalEventReplay(f.guard).eventMarkersSha256);
    assert.notEqual(proof.nextEventMarkersSha256,initial);
    const marker=readdirSync(f.guard).find(name=>name.startsWith("event-"));
    f.setEvents([{...event,eventId:"E-2"}]);
    const stale=run(flags(initial));
    assert.equal(stale.status,1,stale.stderr);
    assert.equal(stale.stdout,"");
    assert.deepEqual(readdirSync(f.guard),[marker],
      "a stale independent pin must not create a lock or consume an event");
    const second=run(flags(proof.nextEventMarkersSha256));
    assert.equal(second.status,0,second.stderr);
    const next=JSON.parse(second.stdout).externalStatementSignature.nextEventMarkersSha256;
    assert.equal(next,inspectLocalEventReplay(f.guard).eventMarkersSha256);
    assert.notEqual(next,proof.nextEventMarkersSha256);
    rmSync(join(f.guard,marker));
    f.setEvents([{...event,eventId:"E-3"}]);
    const rollback=run(flags(next));
    assert.equal(rollback.status,1,rollback.stderr);
    assert.equal(rollback.stdout,"");
    assert.equal(readdirSync(f.guard).length,1,
      "deleting an old valid marker must not allow new claims under the pin");
  });
});

test("checkpoint mode rejects malformed or incomplete trust flags without writes",()=>{
  withFixture(f=>{
    const pin=inspectLocalEventReplay(f.guard).eventMarkersSha256;
    for(const args of [
      [...f.args,"--expected-event-markers-sha256","f".repeat(63)],
      [...f.args,"--expected-event-markers-sha256","Z".repeat(64)],
      [...f.args,"--expected-event-markers-sha256",pin,
        "--expected-event-markers-sha256",pin],
      [...f.args.slice(0,-2),"--expected-event-markers-sha256",pin]
    ]) {
      const result=run(args);
      assert.equal(result.status,1,result.stderr);
      assert.equal(result.stdout,"");
      assert.deepEqual(readdirSync(f.guard),[]);
    }
    assert.throws(()=>consumeLocalSignedEvents({
      directory:f.guard,metadata:f.metadata,external:[event],
      expectedEventMarkersSha256:"invalid"}),/local event replay guard/);
  });
});

test("ten concurrent signed claims with one external pin have one winner",async()=>{
  await withFixture(async f=>{
    const initial=inspectLocalEventReplay(f.guard).eventMarkersSha256;
    const args=[...f.args,"--expected-event-markers-sha256",initial];
    const results=await Promise.all(Array.from({length:10},()=>parallel(args)));
    assert.equal(results.filter(r=>r.status===0).length,1,JSON.stringify(results));
    assert.equal(results.filter(r=>r.status===1).length,9);
    assert.equal(readdirSync(f.guard).filter(n=>n.startsWith("event-")).length,1);
    assert.equal(readdirSync(f.guard).filter(n=>n.startsWith(".pia-event-lock-")).length,0);
    const success=JSON.parse(results.find(r=>r.status===0).stdout);
    assert.equal(success.externalStatementSignature.nextEventMarkersSha256,
      inspectLocalEventReplay(f.guard).eventMarkersSha256);
  });
});
