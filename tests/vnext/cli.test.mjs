import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cli=resolve("packages/cli/protocolia.mjs");
function invoke(...args){
  return spawnSync(process.execPath,[cli,...args],{
    cwd:process.cwd(),encoding:"utf8",timeout:5000
  });
}
test("CLI fails closed for missing project or target",()=>{
  const r=invoke("build");
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Usage:/);
});
test("CLI cannot silently choose a new target",()=>{
  const r=invoke("build","examples/vnext/taller","--target","jhipster-spring","--out","dist/example");
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Only explicit --target modular-spring/);
});
test("CLI refuses to overwrite its TypeSpec source tree",()=>{
  const r=invoke("build","examples/vnext/taller","--target","modular-spring","--out",
    "examples/vnext/taller/dist/generated");
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Refusing to write generated application inside/);
});
test("CLI rejects unknown flags before touching a workspace",()=>{
  const r=invoke("build","examples/vnext/taller","--target","modular-spring","--out","dist/taller","--unsafe","1");
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Unexpected or missing option/);
});

test("test and run commands require a generated project argument without starting Docker",()=>{
  for(const mode of ["run","test"]){
    const r=invoke(mode);
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/Usage: protocolia/);
  }
});
test("test rejects arbitrary unbuilt directories before Docker access",()=>{
  const r=invoke("test","examples/vnext/taller");
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Expected a completed ProtocolIA generated app/);
});

test("A5 evolution commands require an explicit project and application",()=>{
  for(const mode of ["plan","evolve"]){
    const r=invoke(mode);
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/Usage: protocolia/);
  }
});
test("A5 refuses to plan evolution of a directory without an ownership seal",()=>{
  const r=invoke("plan","examples/vnext/taller","examples/vnext/taller");
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Unsealed output/);
});
