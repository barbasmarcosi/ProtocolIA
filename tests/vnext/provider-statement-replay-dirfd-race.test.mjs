import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {consumeLocalSignedStatement} from "../../packages/adapters/provider-statement-local-replay.mjs";
import {consumeLocalSignedEvents} from "../../packages/adapters/provider-statement-event-replay.mjs";

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
