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
const label=randomBytes(5).toString("hex"),project="pia_b3_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-composite-"));
const schema=readFileSync(
  existsSync(join(generated,"src/schema.sql"))?join(generated,"src/schema.sql"):
    join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/CONSTRAINT uq_inspection_business UNIQUE \(equipment_code,period\)/,
  "Generator must enforce composite business uniqueness in PostgreSQL");
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
  for(const code of ["E-001","E-002"]){
    await expect("POST","/api/equipment",{code,name:"Equipment "+code},201);
  }
  const first={number:"I-001",equipmentCode:"E-001",period:"2026-10",notes:"First"};
  assert.equal((await expect("POST","/api/inspections",first,201)).period,"2026-10");
  await expect("POST","/api/inspections",{...first,number:"I-002",notes:"Conflict"},409);
  await expect("POST","/api/inspections",{...first,number:"I-003",period:"2026-11",notes:"Later"},201);
  await expect("POST","/api/inspections",{...first,number:"I-004",equipmentCode:"E-002",notes:"Different"},201);
  const concurrent=await Promise.all(Array.from({length:12},(_,i)=>request("POST","/api/inspections",{
    number:"I-RACE-"+i,equipmentCode:"E-001",period:"2026-12",notes:"Race "+i
  })));
  assert.equal(concurrent.filter(r=>r.status===201).length,1,"One concurrent insert must win");
  assert.equal(concurrent.filter(r=>r.status===409).length,11,"All other duplicates must conflict");
  const page=await expect("GET","/api/inspections?limit=25&offset=0",undefined,200);
  assert.equal(page.total,4,"Conflicts must not insert extra rows");
  const old=await expect("GET","/api/inspections/I-001",undefined,200);
  assert.equal(old.notes,"First","Duplicate must not mutate previous record");
  const result=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT COUNT(*) FROM inspection WHERE equipment_code='E-001' AND period='2026-12'"]);
  assert.equal(Number(result),1,"PostgreSQL must persist exactly one winner");
  // Existing compound key must reject an update into an occupied tuple.
  await expect("PATCH","/api/inspections/I-003/period",{period:"2026-10"},409);
  assert.equal((await expect("GET","/api/inspections/I-003",undefined,200)).period,"2026-11",
    "Rejected composite PATCH must not change an existing row");
  await expect("PATCH","/api/inspections/I-003/period",{period:"2027-01"},200);
  assert.equal((await expect("GET","/api/inspections/I-003",undefined,200)).period,"2027-01");
  // Identical period allowed for another equipment/owner-independent business key.
  await expect("PATCH","/api/inspections/I-004/period",{period:"2027-01"},200);
  await expect("PATCH","/api/inspections/I-MISSING/period",{period:"2027-08"},404);
  await expect("PATCH","/api/inspections/I-003/period",{period:"2027-05",extra:"wrong"},400);

  await expect("POST","/api/inspections",{number:"I-PATCH-A",equipmentCode:"E-001",period:"2027-02",notes:"A"},201);
  await expect("POST","/api/inspections",{number:"I-PATCH-B",equipmentCode:"E-001",period:"2027-03",notes:"B"},201);
  const updates=await Promise.all(["I-PATCH-A","I-PATCH-B"].map(number=>
    request("PATCH","/api/inspections/"+number+"/period",{period:"2027-04"})));
  assert.deepEqual(updates.map(r=>r.status).sort(),[200,409],
    "Two racing updates must produce exactly one winner and one conflict");
  const after=await Promise.all(["I-PATCH-A","I-PATCH-B"].map(number=>
    expect("GET","/api/inspections/"+number,undefined,200)));
  assert.equal(after.filter(x=>x.period==="2027-04").length,1);
  assert.equal(after.filter(x=>["2027-02","2027-03"].includes(x.period)).length,1,
    "Losing PATCH must preserve old tuple");
  const duplicateCount=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT COUNT(*) FROM inspection WHERE equipment_code='E-001' AND period='2027-04'"]);
  assert.equal(Number(duplicateCount),1,"Database must contain one winning updated tuple");
  const total=await expect("GET","/api/inspections?limit=25&offset=0",undefined,200);
  assert.equal(total.total,6,"Failed PATCH must not add/delete rows");
  console.log("PROTOCOLIA_B4_ATOMIC_COMPOSITE_PATCH_PASS "+JSON.stringify({
    compoundConflicts409:true,successfulUpdates:true,missing404:true,invalid400:true,
    concurrentPatchWinners:1,concurrentPatchConflicts:1,rowsPreserved:6
  }));
}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
