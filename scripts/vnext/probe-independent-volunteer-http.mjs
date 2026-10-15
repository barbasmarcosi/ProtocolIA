#!/usr/bin/env node
// Independent black-box oracle derived from the ORIGINAL volunteer ratings requirements,
// not from ProtocolIA's generated IR/manifest. Fictitious entities/IDs only.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Usage: probe-independent-volunteer-http.mjs <generated-app>");
const tmp=mkdtempSync(join(tmpdir(),"volunteer-independent-"));
const token=randomBytes(5).toString("hex");
const project="volunteer_oracle_"+token;
const reader="test_reader",manager="test_manager";
const readerPassword=randomBytes(18).toString("hex");
const managerPassword=randomBytes(18).toString("hex");
const basic=(name,password)=>"Basic "+Buffer.from(name+":"+password).toString("base64");
const auth={reader:basic(reader,readerPassword),manager:basic(manager,managerPassword)};
function docker(args,timeout=600000){
  const p=spawnSync("docker",args,{cwd:generated,encoding:"utf8",timeout});
  if(p.error||p.status!==0)
    throw Error("docker "+args.slice(0,5).join(" ")+" FAILED: "+(p.stderr??p.error?.message??"").slice(-1100));
  return p.stdout;
}
async function freePort(){
  return new Promise((res,rej)=>{
    const server=createServer();server.once("error",rej);
    server.listen(0,"127.0.0.1",()=>{const port=server.address()?.port??0;server.close(()=>res(port));});
  });
}
async function poll(base,timeout=130000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    try{const r=await fetch(base+"/health",{signal:AbortSignal.timeout(2500)});if(r.status===200)return;}
    catch{}
    await new Promise(r=>setTimeout(r,1000));
  }
  throw Error("Generated independent app /health did not come up");
}
let compose=[],started=false;
try{
  const port=await freePort();assert.ok(port>0);
  const conf=join(tmp,"env");
  writeFileSync(conf,[
    "PROTOCOLIA_DB_PASSWORD="+randomBytes(22).toString("hex"),
    "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
    "PROTOCOLIA_READER_USERNAME="+reader,
    "PROTOCOLIA_READER_PASSWORD="+readerPassword,
    "PROTOCOLIA_MANAGER_USERNAME="+manager,
    "PROTOCOLIA_MANAGER_PASSWORD="+managerPassword,
    "PROTOCOLIA_HOST_PORT="+port
  ].join("\n")+"\n",{mode:0o600});
  compose=["compose","--project-name",project,"--env-file",conf];
  docker([...compose,"config","--quiet"],15000);started=true;
  docker([...compose,"up","--detach","--build"]);
  const base="http://127.0.0.1:"+port;
  await poll(base);
  async function req(path,{method="GET",as="manager",body}={}){
    const response=await fetch(base+path,{
      method,headers:{
        ...(as?{Authorization:auth[as]}:{}),
        ...(body===undefined?{}:{"Content-Type":"application/json"})
      },
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(12000)
    });
    let payload=null;const txt=await response.text();
    try{payload=JSON.parse(txt);}catch{payload=txt;}
    return {status:response.status,body:payload};
  }
  if(process.argv.includes("--browser")){
    const {verifyGeneratedFkBrowser}=await import("./probe-independent-volunteer-browser.mjs");
    await verifyGeneratedFkBrowser({base,manager,managerPassword,token,req,generated});
  }
  const key=(suffix)=>token+"-"+suffix;
  const sec={code:key("SEC"),name:"Seccion ficticia"};
  const guards=[{code:key("G1"),sectionCode:sec.code,name:"Guardia A ficticia"},
                {code:key("G2"),sectionCode:sec.code,name:"Guardia B ficticia"}];
  const persons=[{badge:key("V1"),guardCode:guards[0].code,name:"Voluntaria Ejemplo",rank:"Aspirante"},
                 {badge:key("V2"),guardCode:guards[0].code,name:"Voluntario Ejemplo",rank:"Aspirante"}];
  assert.equal((await req("/health",{as:null})).status,200);
  assert.equal((await req("/api/volunteers",{as:null})).status,401,"BV-01 unauthenticated read");
  assert.equal((await req("/api/sections",{method:"POST",as:"reader",body:sec})).status,403,"BV-01 reader write");
  assert.equal((await req("/api/sections",{method:"POST",body:sec})).status,201);
  const found=await req("/api/sections/query/lookup?name=seccion%20ficticia",{as:"reader"});
  assert.equal(found.status,200,"Case insensitive lookup with read capability");
  assert.ok(found.body.items.some(x=>x.code===sec.code));
  assert.equal((await req("/api/sections/query/lookup?name=%25",{as:"reader"})).body.total,0,
    "Percent wildcard searches literally");
  assert.equal((await req("/api/sections/query/lookup?unexpected=1",{as:"reader"})).status,400,
    "Unknown filter fails closed");
  for(const g of guards)assert.equal((await req("/api/guards",{method:"POST",body:g})).status,201);
  for(const person of persons)assert.equal((await req("/api/volunteers",{method:"POST",body:person})).status,201);
  assert.equal((await req("/api/volunteers",{method:"POST",body:persons[0]})).status,409,"BV-02 identity unique");
  assert.equal((await req("/api/volunteers",{method:"POST",body:{...persons[1],badge:key("BAD"),guardCode:"MISSING"}})).status,400,"BV-02 FK checked");
  const evalBody={number:key("E1"),volunteerBadge:persons[0].badge,period:"2026-10",
    incidentPoints:25,mandatoryPoints:35,guardPoints:20,internalPoints:20,otherPoints:0,status:"draft"};
  const createdEvaluation=await req("/api/monthly-evaluations",{method:"POST",body:evalBody});
  assert.equal(createdEvaluation.status,201,"BV-03 evaluation persistence");
  assert.equal(createdEvaluation.body.basePoints,100,"BV-08 partial: bounded 25+35+20+20 computed by DB");
  assert.equal((await req("/api/monthly-evaluations",{method:"POST",body:{...evalBody,number:key("FORGED"),basePoints:0}})).status,400,"computed base cannot be supplied by client");
  assert.equal((await req("/api/monthly-evaluations",{method:"POST",body:evalBody})).status,409,"duplicate id");
  for(const [field,invalid] of [
    ["incidentPoints",26],["mandatoryPoints",36],["guardPoints",21],["internalPoints",21],
    ["incidentPoints",-1],["mandatoryPoints",-1],["guardPoints",-1],["internalPoints",-1],
    ["otherPoints",-1],["guardPoints",1.5]
  ]){
    const invalidBody={...evalBody,number:key("BAD")+field+String(invalid),[field]:invalid};
    const r=await req("/api/monthly-evaluations",{method:"POST",body:invalidBody});
    assert.equal(r.status,400,"BV-04/05/06 range "+field+"="+invalid+": "+JSON.stringify(r.body));
  }
  assert.equal((await req("/api/monthly-evaluations",{method:"POST",body:{...evalBody,number:key("S"),status:"closed"}})).status,400,"BV-16 initial state cannot be bypassed");
  const historical=await req("/api/monthly-evaluations",{method:"POST",body:{...evalBody,number:key("OLD"),period:"2026-09",incidentPoints:5}});
  assert.equal(historical.status,201,"BV-03 historical month");
  assert.equal(historical.body.basePoints,80,"BV-08 partial: historic 5+35+20+20 computed exactly");
  assert.equal((await req("/api/monthly-evaluations",{method:"POST",body:{...evalBody,number:key("OTHER"),volunteerBadge:persons[1].badge}})).status,201);
  const query="/api/monthly-evaluations/query/filtered?volunteerBadge="+encodeURIComponent(persons[0].badge)+"&period=2026-10";
  const filter=await req(query,{as:"reader"});
  assert.equal(filter.status,200,"BV-03 per-person/month search");
  assert.equal(filter.body.total,1,"No other person/month leakage in typed equality search");
  assert.equal(filter.body.items[0].number,evalBody.number);
  assert.equal((await req(query+"&limit=0")).status,400,"BV-03 bounded search");
  const before=await req("/api/monthly-evaluations/"+encodeURIComponent(evalBody.number),{as:"reader"});
  assert.equal(before.status,200);
  for(const f of ["incidentPoints","mandatoryPoints","guardPoints","internalPoints"])
    assert.equal(before.body[f],evalBody[f],f+" persisted in PostgreSQL");
  assert.equal(before.body.basePoints,100,"BV-08 partial: base computed and retrieved");
  assert.equal(Object.hasOwn(before.body,"totalScore"),false,"BV-08: final with leave/other points remains unsupported");
  assert.equal((await req("/api/volunteers/"+persons[0].badge+"/guard",{
    method:"PATCH",as:"reader",body:{expected:guards[0].code,guardCode:guards[1].code}
  })).status,403,"BV-02 only writer can reassign");
  const moved=await req("/api/volunteers/"+persons[0].badge+"/guard",{
    method:"PATCH",body:{expected:guards[0].code,guardCode:guards[1].code}
  });
  assert.equal(moved.status,200,"BV-02 guarded guard assignment");
  assert.equal(moved.body.guardCode,guards[1].code);
  assert.equal((await req("/api/volunteers/"+persons[0].badge+"/guard",{
    method:"PATCH",body:{expected:guards[0].code,guardCode:guards[1].code}
  })).status,409,"CAS protects against stale guard reassignments");
  const close="/api/monthly-evaluations/"+encodeURIComponent(evalBody.number)+"/close";
  assert.equal((await req(close,{method:"POST",as:"reader"})).status,403);
  const concurrent=await Promise.all(Array.from({length:10},()=>req(close,{method:"POST"})));
  assert.equal(concurrent.filter(x=>x.status===200).length,1,"BV-16 publish exactly once");
  assert.equal(concurrent.filter(x=>x.status===409).length,9,"BV-16 reject stale publication");
  assert.equal((await req("/api/monthly-evaluations/"+encodeURIComponent(evalBody.number))).body.status,"closed");
  assert.equal((await req("/api/monthly-evaluations/"+encodeURIComponent(evalBody.number)+"/audit",{as:"reader"})).status,403,"BV-13 independent audit capability");
  const audits=await req("/api/monthly-evaluations/"+encodeURIComponent(evalBody.number)+"/audit");
  assert.equal(audits.status,200);
  assert.ok(audits.body.total>=7,"BV-13 scored fields and publication have audit history");
  const leave={number:key("L1"),volunteerBadge:persons[0].badge,leaveKind:"medical",period:"2026-10",days:10};
  assert.equal((await req("/api/leave-records",{method:"POST",body:leave})).status,201,"BV-09/10 underlying leave record only");
  const saved=await req("/api/leave-records/"+leave.number);
  assert.equal(saved.status,200);
  assert.equal(Object.hasOwn(saved.body,"computedLeaveScore"),false,"BV-10 no fabricated medical calculation");
  docker([...compose,"restart","app"],60000);
  await poll(base);
  assert.equal((await req("/api/monthly-evaluations/"+evalBody.number)).body.status,"closed","BV-16 restart persistence");
  assert.equal((await req("/api/volunteers/"+persons[0].badge)).body.guardCode,guards[1].code);
  assert.equal((await req("/api/leave-records/"+leave.number)).body.days,10);
  console.log("BV_INDEPENDENT_FROZEN_ORACLE_PARTIAL_PASS "+JSON.stringify({
    tested:["BV-01 partial","BV-02 partial","BV-03 partial","BV-04","BV-05","BV-06","BV-08 base-only partial",
      "BV-09 storage only","BV-10 storage only","BV-13 audit subset","BV-16 persistence subset"],
    notProven:["automatic total","annual/medical license scoring","guard-scoped identities","export","template corrections"],
    score:"No overall score inferred"
  }));
}finally{
  if(started)try{docker([...compose,"down","--volumes","--remove-orphans"],120000);}
  catch(error){console.error("BV_ORACLE_COMPOSE_CLEANUP_FAILED "+error.message);process.exitCode=1;}
  rmSync(tmp,{recursive:true,force:true});
}
