import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {consumeLocalSignedStatement} from "../../packages/adapters/provider-statement-local-replay.mjs";

const metadata={providerId:"sandbox",orderId:"OT-1",statementSha256:"a".repeat(64)};
function withGuard(fn) {
  const root=fs.mkdtempSync(join(tmpdir(),"pia-statement-replay-race-"));
  const directory=join(root,"private");
  fs.mkdirSync(directory,{mode:0o700});
  try {fn({root,directory});}
  finally {fs.rmSync(root,{recursive:true,force:true});}
}
function raceAfterDirectoryFsync(mode) {
  withGuard(({root,directory})=>{
    const original=fs.fsyncSync;
    let injected=false,markerName;
    try {
      fs.fsyncSync=fd=>{
        const result=original(fd);
        if(!injected && fs.fstatSync(fd).isDirectory()) {
          injected=true;
          markerName=fs.readdirSync(directory)[0];
          assert.match(markerName,/^[0-9a-f]{64}$/);
          const marker=join(directory,markerName);
          if(mode==="replace") {
            fs.renameSync(marker,join(root,"displaced-marker"));
            fs.writeFileSync(marker,"",{mode:0o600});
          } else if(mode==="delete") {
            fs.unlinkSync(marker);
          } else if(mode==="permissions") {
            fs.chmodSync(marker,0o644);
          } else if(mode==="directory") {
            fs.renameSync(directory,join(root,"displaced-directory"));
            fs.mkdirSync(directory,{mode:0o700});
          }
        }
        return result;
      };
      syncBuiltinESMExports();
      assert.throws(()=>consumeLocalSignedStatement({directory,metadata}),
        /local replay guard/);
    } finally {
      fs.fsyncSync=original;
      syncBuiltinESMExports();
    }
    assert.equal(injected,true,"must inject after durable directory fsync");
    if(mode==="replace" || mode==="permissions") {
      assert.ok(fs.readdirSync(directory).includes(markerName),
        "suspect marker is retained; never silently removed");
      assert.throws(()=>consumeLocalSignedStatement({directory,metadata}),
        /local replay guard/);
    }
    if(mode==="delete")assert.deepEqual(fs.readdirSync(directory),[],
      "same-UID deletion is detectable within the claim, but cannot be undone");
    if(mode==="directory") {
      assert.deepEqual(fs.readdirSync(directory),[]);
      assert.ok(fs.readdirSync(join(root,"displaced-directory")).includes(markerName));
    }
  });
}

test("signed snapshot marker inode replacement after fsync cannot return success",()=>{
  raceAfterDirectoryFsync("replace");
});
test("signed snapshot marker deletion after fsync cannot return success",()=>{
  raceAfterDirectoryFsync("delete");
});
test("signed snapshot marker permission tampering after fsync fails closed",()=>{
  raceAfterDirectoryFsync("permissions");
});
test("signed snapshot replay directory substitution after fsync fails closed",()=>{
  raceAfterDirectoryFsync("directory");
});
test("unmodified signed snapshot marker succeeds once and remains replay-blocking",()=>{
  withGuard(({directory})=>{
    const accepted=consumeLocalSignedStatement({directory,metadata});
    assert.equal(accepted.replayProtection,"single_host_local_marker");
    assert.match(accepted.markerSha256,/^[0-9a-f]{64}$/);
    assert.deepEqual(fs.readdirSync(directory),[accepted.markerSha256]);
    assert.throws(()=>consumeLocalSignedStatement({directory,metadata}),
      /local replay guard/);
  });
});
