import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {consumeLocalSignedEvents} from "../../packages/adapters/provider-statement-event-replay.mjs";
import {inspectLocalEventReplay} from "../../packages/adapters/provider-statement-replay-inspection.mjs";

const metadata={providerId:"sandbox",orderId:"OT-1",statementSha256:"a".repeat(64)};
const external=[{providerId:"sandbox",eventId:"E-1",transactionId:"TX-1",
  kind:"capture",amount:"1.00",currency:"ARS"}];

function fixture(fn) {
  const root=fs.mkdtempSync(join(tmpdir(),"pia-replay-mode-race-"));
  const directory=join(root,"private");
  fs.mkdirSync(directory,{mode:0o700});
  try {fn(directory);}
  finally {fs.rmSync(root,{recursive:true,force:true});}
}

test("forensic scan rejects directory chmod during its final readdir",()=>{
  fixture(directory=>{
    consumeLocalSignedEvents({directory,metadata,external});
    const original=fs.readdirSync;
    let reads=0,injected=false;
    try {
      fs.readdirSync=(path,...args)=>{
        if(String(path).startsWith("/proc/self/fd/") && ++reads===3) {
          fs.chmodSync(directory,0o755);
          injected=true;
        }
        return original(path,...args);
      };
      syncBuiltinESMExports();
      assert.throws(()=>inspectLocalEventReplay(directory),/local replay inspection/);
    } finally {
      fs.readdirSync=original;
      syncBuiltinESMExports();
    }
    assert.equal(injected,true,"mode downgrade must occur during final scan");
    assert.equal(fs.statSync(directory).mode & 0o077,0o055);
    fs.chmodSync(directory,0o700);
    assert.equal(inspectLocalEventReplay(directory).eventMarkerCount,1);
  });
});

for(const directorySync of [1,3]) {
  test("event replay rejects directory chmod after directory fsync #"+directorySync,()=>{
    fixture(directory=>{
      const original=fs.fsyncSync;
      let syncs=0,injected=false;
      try {
        fs.fsyncSync=fd=>{
          const result=original(fd);
          if(fs.fstatSync(fd).isDirectory() && ++syncs===directorySync) {
            fs.chmodSync(directory,0o755);
            injected=true;
          }
          return result;
        };
        syncBuiltinESMExports();
        assert.throws(()=>consumeLocalSignedEvents({directory,metadata,external}),
          /local event replay guard/);
      } finally {
        fs.fsyncSync=original;
        syncBuiltinESMExports();
      }
      assert.equal(injected,true,"permission change must be injected");
      const entries=fs.readdirSync(directory);
      assert.equal(entries.filter(name=>name.startsWith("event-")).length,
        directorySync===1?0:1);
      assert.equal(entries.filter(name=>name.startsWith(".pia-event-lock-")).length,
        directorySync===1?1:0,
        "before durability retain crash lock; after commit retain consumed event");
      assert.throws(()=>inspectLocalEventReplay(directory),/local replay inspection/);
      fs.chmodSync(directory,0o700);
      assert.throws(()=>consumeLocalSignedEvents({directory,metadata,external}),
        /local event replay guard/,"replay cannot be accepted after recovery");
    });
  });
}
