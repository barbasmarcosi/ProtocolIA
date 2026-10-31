#!/usr/bin/env node
// Structural gate for an unrelated customer TypeSpec project, after full app:build.
// Actual HTTP, PostgreSQL, concurrency and authorization are proven by app:test.
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";

const root=resolve(process.argv[2]??"");
const info=JSON.parse(readFileSync(join(root,"protocolia-build.json"),"utf8"));
const irBytes=readFileSync(join(root,"protocolia-contract-ir.json"));
assert.equal(createHash("sha256").update(irBytes).digest("hex"),info.irSha256);
const ir=JSON.parse(irBytes);
assert.equal(info.builder,"protocolia-cli-vnext-a3");
assert.ok(["nestjs","modular-spring"].includes(info.target));
const path=info.target==="nestjs"?
  "dist/static/protocolia-ui.json":"src/main/resources/static/protocolia-ui.json";
assert.ok(existsSync(join(root,path)),"Generated React manifest is missing");
const ui=JSON.parse(readFileSync(join(root,path),"utf8"));
assert.deepEqual((ui.resources??[]).map(r=>r.entity.name).sort(),
  ["ArchiveRoom","RecordBox"]);
const room=ui.resources.find(r=>r.entity.name==="ArchiveRoom");
const box=ui.resources.find(r=>r.entity.name==="RecordBox");
assert.equal(room.entity.publicIdentity,"roomCode");
assert.equal(box.entity.publicIdentity,"reference");
assert.equal(box.entity.fields.find(f=>f.name==="roomCode")?.reference?.target,"ArchiveRoom");
assert.deepEqual(Object.values(room.operations).map(x=>x.behavior.kind).sort(),
  ["create","delete","get","listPage"]);
assert.deepEqual(Object.values(box.operations).map(x=>x.behavior.kind).sort(),
  ["atomicIncrement","create","delete","get","listPage","patchFields"]);
assert.ok(ir.operations.every(op=>!["Tool","Gauge","Ticket"].includes(op.entity)),
  "Acceptance project must not delegate domain operations to an older fixture");
assert.ok(typeof info.contractSha256==="string"&&/^[a-f0-9]{64}$/.test(info.contractSha256));
console.log("PROTOCOLIA_V12_INDEPENDENT_CONTRACT_GENERATION_PASS "+JSON.stringify({
  target:info.target,domain:"CommunityArchive",
  resources:ui.resources.length,operations:Object.keys(room.operations).length+
    Object.keys(box.operations).length,irSha256:info.irSha256
}));
