#!/usr/bin/env node
// Verifies actual generator-owned PostgreSQL constraint, HTTP 409 and races.
// Does not modify the generated system or its TypeSpec contracts.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";

const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Supply generated app directory");
const label=randomBytes(5).toString("hex"),project="pia_b5_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-active-unique-"));
const schema=readFileSync(
  existsSync(join(generated,"src/schema.sql"))?join(generated,"src/schema.sql"):
    join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/CREATE UNIQUE INDEX uq_work_order_active ON work_order \(site_code,period\) WHERE status = 'approved';/,
  "Generator must enforce active-only compound uniqueness in PostgreSQL");
const basic=(name,pw)=>"Basic "+Buffer.from(name+":"+pw).toString("base64");
const password=randomBytes(16).toString("hex");
function docker(args,timeout=180000){
  const r=spawnSync("docker",args,{cwd:generated,encoding:"utf8",timeout});
  if(r.error||r.status!==0)throw Error("Docker "+args.join(" ")+": "+
    (r.stderr??r.error?.message??"").slice(-1500));
  return r.stdout.trim();
}
async function port(){return new Promise((resolve,reject)=>{
  const s=createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const n=s.address().port;s.close(()=>resolve(n));});
});}
let args=[],started=false;
try{
  const hostPort=await port(),env=join(temp,".env");
  writeFileSync(env,[
    "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
    "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
    "PROTOCOLIA_MANAGER_USERNAME=manager",
    "PROTOCOLIA_MANAGER_PASSWORD="+password,
    "PROTOCOLIA_READER_USERNAME=reader",
    "PROTOCOLIA_READER_PASSWORD="+randomBytes(20).toString("hex"),
    "PROTOCOLIA_HOST_PORT="+hostPort
  ].join("\n")+"\n",{mode:0o600});
  args=["compose","--project-name",project,"--env-file",env];
  docker([...args,"config","--quiet"],20000);
  started=true;
  docker([...args,"up","--detach","--build"],600000);
  const base="http://127.0.0.1:"+hostPort;
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){
    try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2500)})).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,900));
  }
  assert.ok(ready,"Generated app must become healthy");
  async function request(method,path,body,headers={}){
    const response=await fetch(base+path,{method,headers:{
      Authorization:basic("manager",password),
      ...(body!==undefined?{"Content-Type":"application/json"}:{}),...headers
    },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
    const raw=await response.text();let parsed;try{parsed=JSON.parse(raw);}catch{parsed=raw;}
    return {status:response.status,body:parsed};
  }
  const expect=async(method,path,body,status)=>{
    const result=await request(method,path,body);
    assert.equal(result.status,status,method+" "+path+" "+JSON.stringify(result.body));
    return result.body;
  };
  const post=(code,siteCode="SITE-1",period="2026-10")=>
    expect("POST","/api/work-orders",{code,title:"Work "+code,siteCode,period,status:"draft"},201);
  const route=(code,action)=>"/api/work-orders/"+code+"/"+action;
  const get=(code)=>expect("GET","/api/work-orders/"+code,undefined,200);
  await post("W-A");
  await post("W-B");
  await post("W-C","SITE-2");
  const first=await Promise.all(["W-A","W-B"].map(
    code=>request("POST",route(code,"approve"))));
  assert.equal(first.filter(x=>x.status===200).length,1,
    "Exactly one of two competing transitions should be approved");
  assert.equal(first.filter(x=>x.status===409).length,1,
    "Other approval must be a conflict, not a 500");
  const winner=first[0].status===200?"W-A":"W-B",loser=winner==="W-A"?"W-B":"W-A";
  assert.equal((await get(loser)).status,"draft","Failed approval must roll back");
  assert.equal((await get(winner)).status,"approved");
  await expect("POST",route(loser,"approve"),undefined,409);
  assert.equal((await expect("POST",route("W-C","approve"),undefined,200)).status,"approved",
    "Same period but different site must remain independent");
  assert.equal((await expect("POST",route(winner,"close"),undefined,200)).status,"closed",
    "Closing winner must release its partial unique slot");
  assert.equal((await expect("POST",route(loser,"approve"),undefined,200)).status,"approved",
    "Previously rejected draft can become active after close");
  await expect("POST",route(loser,"close"),undefined,200);
  for(let i=0;i<8;i++)await post("W-RACE-"+i);
  const concurrent=await Promise.all(Array.from({length:8},(_,i)=>
    request("POST",route("W-RACE-"+i,"approve"))));
  assert.equal(concurrent.filter(x=>x.status===200).length,1,
    "Only one racing transition may enter the active state");
  assert.equal(concurrent.filter(x=>x.status===409).length,7,
    "Other transitions must return conflict, not alter rows");
  const page=await expect("GET","/api/work-orders?limit=25&offset=0",undefined,200);
  assert.equal(page.total,11,"Updates must never insert or erase rows");
  const active=page.items.filter(x=>x.siteCode==="SITE-1"&&x.period==="2026-10"&&
    x.status==="approved");
  assert.equal(active.length,1);
  assert.equal(page.items.filter(x=>x.code.startsWith("W-RACE-")&&x.status==="draft").length,7);
  const rowCount=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT COUNT(*) FROM work_order WHERE site_code='SITE-1' AND period='2026-10' AND status='approved'"]);
  assert.equal(Number(rowCount),1,"DB must persist a single active winner");
  const indexCount=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT COUNT(*) FROM pg_indexes WHERE tablename='work_order' AND indexname='uq_work_order_active'"]);
  assert.equal(Number(indexCount),1,"Real PostgreSQL partial unique index required");
  console.log("PROTOCOLIA_B5_PARTIAL_UNIQUE_PASS "+JSON.stringify({
    targetGenerated:true,postgresPartialUniqueIndex:true,
    competingTransitionWinners:1,concurrentTransitionConflicts:7,
    closedHistoricalRecordsAllowed:true,releasedActiveSlot:true,
    independentBusinessKeyAllowed:true,http409:true
  }));
}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
