import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {consumeLocalSignedStatement} from "../../packages/adapters/provider-statement-local-replay.mjs";
import {consumeLocalSignedEvents} from "../../packages/adapters/provider-statement-event-replay.mjs";

// A deterministic filesystem race: substitute the original private pathname
// immediately before O_EXCL creates a financial replay marker. The replacement
// directory must remain empty; a marker in the displaced original must make
// the attempt fail closed rather than silently allow a subsequent replay.
function withSwappedReplayPath(markerName,action) {
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
      assert.ok(fs.readdirSync(displaced).length>0,
        "original opened inode must retain the fail-closed marker/lock");
    } finally {
      fs.rmSync(root,{recursive:true,force:true});
    }
  }
}

test("statement replay marker stays on opened directory inode after pathname substitution",()=>{
  withSwappedReplayPath(path=>/\/[0-9a-f]{64}$/.test(path),directory=>
    consumeLocalSignedStatement({directory,metadata:{
      providerId:"sandbox",orderId:"OT-1",statementSha256:"a".repeat(64)
    }}));
});

test("event replay lock and markers stay on opened inode after pathname substitution",()=>{
  withSwappedReplayPath(path=>/\/event-[0-9a-f]{64}$/.test(path),directory=>
    consumeLocalSignedEvents({directory,metadata:{
      providerId:"sandbox",orderId:"OT-1",statementSha256:"b".repeat(64)
    },external:[{providerId:"sandbox",transactionId:"TX-1",eventId:"E-1",
      kind:"capture",amount:"1.00",currency:"ARS"}]}));
});
