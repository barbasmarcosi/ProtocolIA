import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {checkpointOptions,verifyCheckpoint} from "../../packages/cli/database-checkpoint.mjs";

function files(){
  const root=mkdtempSync(join(tmpdir(),"pia-checkpoint-unit-"));
  const generated=join(root,"generated"),outputs=join(root,"safe");
  mkdirSync(generated);mkdirSync(outputs);
  const env=join(root,"env");writeFileSync(env,"PROTOCOLIA_DB_PASSWORD=redacted\n",{mode:0o600});
  return {root,generated,outputs,env};
}
test("checkpoint requires explicit Docker project, env and an outside destination",()=>{
  const {generated,outputs,env}=files();
  assert.deepEqual(checkpointOptions([
    generated,"--project","v11_test_db","--env-file",env,"--out",join(outputs,"safe.dump")
  ]).project,"v11_test_db");
  for(const args of [
    [generated,"--project","../../other","--env-file",env,"--out",join(outputs,"safe.dump")],
    [generated,"--project","v11_test_db","--env-file",env,"--out",join(generated,"backup.dump")],
    [generated,"--project","v11_test_db","--env-file",env,"--out",join(outputs,"safe.txt")],
    [generated,"--project","v11_test_db","--env-file",env,"--out",env],
    [generated,"--project","v11_test_db","--env-file",join(outputs,"missing"),"--out",join(outputs,"safe.dump")]
  ])assert.throws(()=>checkpointOptions(args),/DB checkpoint refused/);
});
test("checkpoint must not overwrite an archive or integrity manifest",()=>{
  const {generated,outputs,env}=files(),dest=join(outputs,"archive.dump");
  const args=[generated,"--project","v11_test_db","--env-file",env,"--out",dest];
  writeFileSync(dest+".json","{}");
  assert.throws(()=>checkpointOptions(args),/already exists/);
  const other=join(outputs,"another.dump");
  writeFileSync(other,"content");
  assert.throws(()=>checkpointOptions([
    generated,"--project","v11_test_db","--env-file",env,"--out",other]),/already exists/);
});
test("checksum verification refuses modified, truncated and world-readable archives",()=>{
  const {outputs}=files(),archive=join(outputs,"archive.dump");
  const bytes=Buffer.concat([Buffer.from("PGDMP"),Buffer.alloc(120,3)]);
  writeFileSync(archive,bytes,{mode:0o600});
  const meta={version:1,format:"pg_dump-custom",target:"nestjs",
    archiveBytes:bytes.length,archiveSha256:createHash("sha256").update(bytes).digest("hex")};
  writeFileSync(archive+".json",JSON.stringify(meta),{mode:0o600});
  assert.equal(verifyCheckpoint(archive).archiveSha256,meta.archiveSha256);
  assert.equal(statSync(archive).mode&0o077,0);
  chmodSync(archive,0o644);
  assert.throws(()=>verifyCheckpoint(archive),/unsafe or accessible/);
  chmodSync(archive,0o600);
  writeFileSync(archive,Buffer.concat([bytes,Buffer.from("x")]));
  assert.throws(()=>verifyCheckpoint(archive),/checksum, size or format/);
  writeFileSync(archive,Buffer.alloc(2));
  assert.throws(()=>verifyCheckpoint(archive),/incomplete/);
  assert.ok(readFileSync(archive+".json","utf8").includes(meta.archiveSha256));
});
