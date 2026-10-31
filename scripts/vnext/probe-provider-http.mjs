#!/usr/bin/env node
// Disposable HTTP+PostgreSQL oracle. Sandbox HMAC, no external provider or settlement.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHmac,randomBytes} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:net";

const root=resolve(process.argv[2]??"");
const build=JSON.parse(readFileSync(join(root,"protocolia-build.json"),"utf8"));
assert.ok(["nestjs","modular-spring"].includes(build.target));
const scratch=mkdtempSync(join(tmpdir(),"pia-provider-http-"));
const project="pia_http_"+randomBytes(5).toString("hex");
const key=randomBytes(32);
const env={
  PROTOCOLIA_DB_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_MANAGER_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_READER_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_ALLOW_DEMO_AUTH:"true",
  PROTOCOLIA_PROVIDER_SANDBOX_ENABLED:"true",
  PROTOCOLIA_PROVIDER_SANDBOX_KEY_HEX:key.toString("hex")
};
const compose=["compose","--project-name",project,"--env-file",join(scratch,"env")];
const docker=(args,allowFail=false)=>{
  const r=spawnSync("docker",[...compose,...args],{cwd:root,env:{...process.env,...env},
    encoding:"utf8",timeout:600000,maxBuffer:3*1024*1024});
  if(!allowFail&&(r.error||r.status!==0))
    throw Error("Compose "+args.join(" ")+": "+String(r.stderr||r.error?.message).slice(-2200));
  return r;
};
const sql=query=>docker(["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
  "-U","protocolia","-d","protocolia","-Atc",query]).stdout.trim();
const port=await new Promise((resolve,reject)=>{
  const server=createServer();server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
    const selected=server.address()?.port;
    server.close(error=>error?reject(error):resolve(selected));
  });
});
env.PROTOCOLIA_HOST_PORT=String(port);
writeFileSync(join(scratch,"env"),Object.entries(env).map(([k,v])=>k+"="+v).join("\n")+"\n");
const base="http://127.0.0.1:"+port;
const path="/api/_protocolia/provider/sandbox/inbox";
const body=Buffer.from('{"sandbox":"test","amount":"1.00"}');
function signed(event,raw=body,timestamp=String(Math.floor(Date.now()/1000))){
  const keyId="sandbox_1";
  const mac=createHmac("sha256",key)
    .update("protocolia-provider-proof-v1\n"+keyId+"\n"+timestamp+"\n"+event+"\n")
    .update(raw).digest("hex");
  return {"Content-Type":"application/json","X-ProtocolIA-Key-Id":keyId,
    "X-ProtocolIA-Timestamp":timestamp,"X-ProtocolIA-Event-Id":event,
    "X-ProtocolIA-Signature":"v1="+mac};
}
async function send(event,raw=body,headers=signed(event,raw)){
  const r=await fetch(base+path,{method:"POST",headers,body:raw,
    signal:AbortSignal.timeout(20000)});
  return {status:r.status,body:await r.text()};
}
async function ready(){
  for(let i=0;i<120;i++){
    try{const r=await fetch(base+"/health",{signal:AbortSignal.timeout(2000)});
      if(r.status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error("Generated target did not become healthy");
}
let started=false;
try{
  docker(["up","-d","--build","--wait"],false);started=true;
  await ready();
  const event="evt_http_12345678";
  const responses=await Promise.all(Array.from({length:10},()=>send(event)));
  assert.equal(responses.filter(x=>x.status===202).length,1,JSON.stringify(responses));
  assert.equal(responses.filter(x=>x.status===200).length,9,JSON.stringify(responses));
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox"),"1");
  const changed=Buffer.from('{"sandbox":"test","amount":"2.00"}');
  assert.equal((await send(event,changed,signed(event,changed))).status,409);
  assert.equal((await send(event,changed,signed(event,body))).status,401);
  assert.equal((await send("evt_expired_12345678",body,
    signed("evt_expired_12345678",body,String(Math.floor(Date.now()/1000)-400)))).status,401);
  assert.equal((await send("short")).status,401);
  assert.equal((await send("evt_new_12345678",body,{
    "Content-Type":"application/json"})).status,400);
  const noAuth=await send("evt_valid_12345678");
  assert.equal(noAuth.status,202,"Valid HMAC must work without human Basic auth");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_provider_envelope_inbox"),"2");
  assert.equal(sql("SELECT COUNT(*) FROM payment"),"0");
  console.log("PROTOCOLIA_S2C1C2_PROVIDER_HTTP_PASS "+build.target+
    " 1 accepted/9 duplicate, signed conflict, tamper, stale, no human auth, no settlement");
}finally{
  if(started)docker(["down","-v","--remove-orphans"],true);
  rmSync(scratch,{recursive:true,force:true});
}
