import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {consumeLocalSignedStatement} from "../../packages/adapters/provider-statement-local-replay.mjs";
import {consumeLocalSignedEvents} from "../../packages/adapters/provider-statement-event-replay.mjs";
import {inspectLocalEventReplay} from "../../packages/adapters/provider-statement-replay-inspection.mjs";

// A deterministic filesystem race: substitute the original private pathname
// immediately before O_EXCL creates a financial replay marker. The replacement
// directory must remain empty; a marker in the displaced original must make
// the attempt fail closed rather than silently allow a subsequent replay.
function withSwappedReplayPath(markerName,expectedOriginalEntry,action) {
  const root=fs.mkdtempSync(join(tmpdir(),"pia-replay-fd-race-"));
  const directory=join(root,"private");
  const displaced=join(root,"displaced");
  fs.mkdirSync(directory,{mode:0o700});
  const originalOpen=fs.openSync;
  let swapped=false;
  try {
    fs.openSync=(path,flags,...rest)=>{
      if(!swapped && (flags & fs.constants.O_EXCL) &&
         markerName(String(path))) {
        fs.renameSync(directory,displaced);
        fs.mkdirSync(directory,{mode:0o700});
        swapped=true;
      }
      return originalOpen(path,flags,...rest);
    };
    syncBuiltinESMExports();
    assert.throws(()=>action(directory),/local (event )?replay guard/);
  } finally {
    fs.openSync=originalOpen;
    syncBuiltinESMExports();
    try {
      assert.equal(swapped,true,"the simulated pathname swap must actually occur");
      assert.deepEqual(fs.readdirSync(directory),[],
        "substituted directory must never receive an accepted replay marker");
      assert.ok(fs.readdirSync(displaced).some(expectedOriginalEntry),
        "original opened inode must retain the expected replay marker");
    } finally {
      fs.rmSync(root,{recursive:true,force:true});
    }
  }
}

test("statement replay marker stays on opened directory inode after pathname substitution",()=>{
  withSwappedReplayPath(path=>/\/[0-9a-f]{64}$/.test(path),
    name=>/^[0-9a-f]{64}$/.test(name),directory=>
    consumeLocalSignedStatement({directory,metadata:{
      providerId:"sandbox",orderId:"OT-1",statementSha256:"a".repeat(64)
    }}));
});

test("event replay lock and markers stay on opened inode after pathname substitution",()=>{
  withSwappedReplayPath(path=>/\/event-[0-9a-f]{64}$/.test(path),
    name=>/^event-[0-9a-f]{64}$/.test(name),directory=>
    consumeLocalSignedEvents({directory,metadata:{
      providerId:"sandbox",orderId:"OT-1",statementSha256:"b".repeat(64)
    },external:[{providerId:"sandbox",transactionId:"TX-1",eventId:"E-1",
      kind:"capture",amount:"1.00",currency:"ARS"}]}));
});

function withEventClaim(fn) {
  const root=fs.mkdtempSync(join(tmpdir(),"pia-replay-lock-fence-"));
  const directory=join(root,"private");
  fs.mkdirSync(directory,{mode:0o700});
  const metadata={providerId:"sandbox",orderId:"OT-1",
    statementSha256:"b".repeat(64)};
  const external=[{providerId:"sandbox",transactionId:"TX-1",
    eventId:"E-1",kind:"capture",amount:"1.00",currency:"ARS"}];
  try {fn({root,directory,metadata,external});}
  finally {fs.rmSync(root,{recursive:true,force:true});}
}

test("one foreign lock replacing ours during post-lock scan cannot authorize event claims",()=>{
  withEventClaim(({directory,metadata,external})=>{
    const originalOpen=fs.openSync,originalReadDir=fs.readdirSync;
    let armed=false,swapped=false;
    const foreignProvider="other-provider";
    const foreignLock=".pia-event-lock-"+createHash("sha256").update(JSON.stringify([
      "ProtocolIA-S2C-provider-lock-v1",foreignProvider])).digest("hex");
    try {
      fs.openSync=(path,flags,...rest)=>{
        const fd=originalOpen(path,flags,...rest);
        if((flags & fs.constants.O_EXCL) &&
           String(path).includes(".pia-event-lock-"))armed=true;
        return fd;
      };
      fs.readdirSync=(path,...rest)=>{
        if(armed && !swapped) {
          swapped=true;
          const own=originalReadDir(directory).find(name=>
            name.startsWith(".pia-event-lock-"));
          assert.ok(own);
          fs.unlinkSync(join(directory,own));
          fs.writeFileSync(join(directory,foreignLock),JSON.stringify({
            version:1,providerId:foreignProvider,
            statementSha256:"c".repeat(64)})+"\n",{mode:0o600});
        }
        return originalReadDir(path,...rest);
      };
      syncBuiltinESMExports();
      assert.throws(()=>consumeLocalSignedEvents({directory,metadata,external}),
        /local event replay guard/);
    } finally {
      fs.openSync=originalOpen;
      fs.readdirSync=originalReadDir;
      syncBuiltinESMExports();
    }
    assert.equal(swapped,true,"race must occur during the second scan");
    assert.deepEqual(fs.readdirSync(directory),[foreignLock],
      "foreign crash lock retained, no event marker claimed");
  });
});

test("replacement of our lock after durable markers is never unlinked as success",()=>{
  withEventClaim(({root,directory,metadata,external})=>{
    const originalFsync=fs.fsyncSync;
    let directorySyncs=0,swapped=false,replacement;
    try {
      fs.fsyncSync=fd=>{
        const result=originalFsync(fd);
        if(fs.fstatSync(fd).isDirectory() && ++directorySyncs===2) {
          const own=fs.readdirSync(directory).find(name=>
            name.startsWith(".pia-event-lock-"));
          assert.ok(own);
          fs.renameSync(join(directory,own),join(root,"original-lock"));
          replacement=own;
          fs.writeFileSync(join(directory,own),JSON.stringify({
            version:1,providerId:metadata.providerId,
            statementSha256:metadata.statementSha256})+"\n",{mode:0o600});
          swapped=true;
        }
        return result;
      };
      syncBuiltinESMExports();
      assert.throws(()=>consumeLocalSignedEvents({directory,metadata,external}),
        /local event replay guard/);
    } finally {
      fs.fsyncSync=originalFsync;
      syncBuiltinESMExports();
    }
    assert.equal(swapped,true,"race must occur after event marker fsync");
    assert.ok(fs.readdirSync(directory).includes(replacement),
      "substituted lock must survive for manual review");
    assert.equal(fs.readdirSync(directory).filter(n=>n.startsWith("event-")).length,1,
      "partial durable event marker must not be silently rolled back");
  });
});

function withMarkerMutationAfterDurability(mode) {
  withEventClaim(({root,directory,metadata,external})=>{
    const originalFsync=fs.fsyncSync;
    let directorySyncs=0,mutated=false,markerName;
    try {
      fs.fsyncSync=fd=>{
        const result=originalFsync(fd);
        if(fs.fstatSync(fd).isDirectory() && ++directorySyncs===2) {
          markerName=fs.readdirSync(directory).find(name=>name.startsWith("event-"));
          assert.ok(markerName,"an event marker must be durable before injection");
          const markerPath=join(directory,markerName);
          if(mode==="replace") {
            const original=fs.readFileSync(markerPath);
            fs.renameSync(markerPath,join(root,"original-marker"));
            fs.writeFileSync(markerPath,original,{mode:0o600});
          } else {
            fs.unlinkSync(markerPath);
          }
          mutated=true;
        }
        return result;
      };
      syncBuiltinESMExports();
      assert.throws(()=>consumeLocalSignedEvents({directory,metadata,external}),
        /local event replay guard/);
    } finally {
      fs.fsyncSync=originalFsync;
      syncBuiltinESMExports();
    }
    assert.equal(mutated,true,"injection must run after durable event claims");
    assert.ok(fs.readdirSync(directory).some(name=>name.startsWith(".pia-event-lock-")),
      "unverified claim must retain its provider lock for manual review");
    assert.equal(fs.readdirSync(directory).includes(markerName),mode==="replace",
      "replacement marker is not silently accepted; deletion is not restored");
  });
}

test("replacing a durable event marker with identical canonical bytes fails closed",()=>{
  withMarkerMutationAfterDurability("replace");
});

test("deleting a durable event marker before provider lock release fails closed",()=>{
  withMarkerMutationAfterDurability("delete");
});

test("replacing an earlier event while a later event is written fails the batch",()=>{
  withEventClaim(({root,directory,metadata,external})=>{
    const originalWrite=fs.writeFileSync;
    let markerWrites=0,mutated=false;
    try {
      fs.writeFileSync=(target,...rest)=>{
        if(typeof target==="number" &&
           String(rest[0]).includes("eventMarkerSha256") &&
           ++markerWrites===2) {
          const first=fs.readdirSync(directory).find(name=>name.startsWith("event-"));
          assert.ok(first);
          const path=join(directory,first);
          const bytes=fs.readFileSync(path);
          fs.renameSync(path,join(root,"original-first-marker"));
          originalWrite(path,bytes,{mode:0o600});
          mutated=true;
        }
        return originalWrite(target,...rest);
      };
      syncBuiltinESMExports();
      assert.throws(()=>consumeLocalSignedEvents({directory,metadata,
        external:[external[0],{...external[0],eventId:"E-2"}]}),
      /local event replay guard/);
    } finally {
      fs.writeFileSync=originalWrite;
      syncBuiltinESMExports();
    }
    assert.equal(mutated,true,"second marker write must trigger replacement");
    assert.equal(fs.readdirSync(directory).filter(x=>x.startsWith("event-")).length,2);
    assert.ok(fs.readdirSync(directory).some(x=>x.startsWith(".pia-event-lock-")),
      "batch with an altered earlier marker must preserve crash lock");
  });
});

test("checkpoint is rechecked after O_EXCL: historical marker deletion cannot pass",()=>{
  withEventClaim(({directory,metadata,external})=>{
    consumeLocalSignedEvents({directory,metadata,external});
    const checkpoint=inspectLocalEventReplay(directory).eventMarkersSha256;
    const oldMarker=fs.readdirSync(directory).find(name=>name.startsWith("event-"));
    const originalOpen=fs.openSync;
    let deleted=false;
    try {
      fs.openSync=(path,flags,...rest)=>{
        const fd=originalOpen(path,flags,...rest);
        if(!deleted && (flags & fs.constants.O_EXCL) &&
           String(path).includes(".pia-event-lock-")) {
          fs.unlinkSync(join(directory,oldMarker));
          deleted=true;
        }
        return fd;
      };
      syncBuiltinESMExports();
      assert.throws(()=>consumeLocalSignedEvents({
        directory,metadata,
        external:[{...external[0],eventId:"E-2"}],
        expectedEventMarkersSha256:checkpoint
      }),/local event replay guard/);
    } finally {
      fs.openSync=originalOpen;
      syncBuiltinESMExports();
    }
    assert.equal(deleted,true,"historical deletion must occur after first scan");
    assert.deepEqual(fs.readdirSync(directory),[],
      "the writer must release only its own unwritten lock and claim no event");
  });
});

test("historical canonical-byte rewrite after new marker fsync fails checkpoint",()=>{
  withEventClaim(({directory,metadata,external})=>{
    consumeLocalSignedEvents({directory,metadata,external});
    const checkpoint=inspectLocalEventReplay(directory).eventMarkersSha256;
    const oldMarker=fs.readdirSync(directory).find(name=>name.startsWith("event-"));
    const originalFsync=fs.fsyncSync;
    let directorySyncs=0,mutated=false;
    try {
      fs.fsyncSync=fd=>{
        const result=originalFsync(fd);
        if(fs.fstatSync(fd).isDirectory() && ++directorySyncs===2) {
          const path=join(directory,oldMarker);
          const record=JSON.parse(fs.readFileSync(path,"utf8"));
          record.statementSha256="c".repeat(64);
          fs.writeFileSync(path,JSON.stringify(record)+"\n");
          mutated=true;
        }
        return result;
      };
      syncBuiltinESMExports();
      assert.throws(()=>consumeLocalSignedEvents({
        directory,metadata,
        external:[{...external[0],eventId:"E-2"}],
        expectedEventMarkersSha256:checkpoint
      }),/local event replay guard/);
    } finally {
      fs.fsyncSync=originalFsync;
      syncBuiltinESMExports();
    }
    assert.equal(mutated,true,"historical mutation must occur after new durability");
    assert.equal(fs.readdirSync(directory).filter(name=>name.startsWith("event-")).length,2);
    assert.equal(fs.readdirSync(directory).filter(name=>name.startsWith(".pia-event-lock-")).length,1,
      "partially committed batch must retain its provider lock for forensic review");
  });
});
