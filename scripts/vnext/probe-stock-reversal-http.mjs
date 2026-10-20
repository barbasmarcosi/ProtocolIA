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
const label=randomBytes(5).toString("hex"),project="pia_b9_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-reversals-"));
const schema=readFileSync(
  existsSync(join(generated,"src/schema.sql"))?join(generated,"src/schema.sql"):
    join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/CREATE TABLE bin \(/,"Generated PostgreSQL stock table is required");
assert.match(schema,/CREATE TABLE movement \(/,"Generated PostgreSQL transfer journal is required");
assert.match(schema,/fk_movement_source_sku|FOREIGN KEY \(source_sku\)/,
  "Generated movement must reference existing source");
assert.match(schema,/fk_movement_target_sku|FOREIGN KEY \(target_sku\)/,
  "Generated movement must reference existing destination");
const basic=(name,pw)=>"Basic "+Buffer.from(name+":"+pw).toString("base64");
const password=randomBytes(16).toString("hex");
const readerPassword=randomBytes(16).toString("hex");
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
    "PROTOCOLIA_READER_PASSWORD="+readerPassword,
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



  const createBin=(sku,available)=>expect("POST","/api/bins",{sku,name:"Depósito "+sku,available},201);
  const transfer=(number,sourceSku,targetSku,units)=>
    request("POST","/api/movements",{number,sourceSku,targetSku,units,note:"Generated journal"});
  const reverse=number=>request("POST","/api/movements/"+number+"/reverse");
  const get=sku=>expect("GET","/api/bins/"+sku,undefined,200);
  const balance=async(sku)=>(await get(sku)).available;
  const state=async(number)=>(await expect("GET","/api/movements/"+number,undefined,200)).status;
  for(const [name,available] of [["A",20],["B",20],["C",20],["D",0],
    ["E",95],["F",10],["G",20],["H",0],["I",0]])await createBin(name,available);
  // Server-derived initial state cannot be injected by clients.
  assert.equal((await request("POST","/api/movements",{
    number:"BAD-STATE",sourceSku:"A",targetSku:"B",units:1,
    note:"Illegal status",status:"reversed"})).status,400);
  assert.equal((await transfer("T-1","A","B",3)).status,201);
  assert.equal(await state("T-1"),"posted");
  assert.deepEqual([await balance("A"),await balance("B")],[17,23]);
  const reader=await request("POST","/api/movements/T-1/reverse",undefined,
    {Authorization:basic("reader",readerPassword)});
  assert.equal(reader.status,403);
  assert.equal(await state("T-1"),"posted");
  assert.equal((await reverse("UNKNOWN")).status,404);
  assert.equal((await reverse("T-1")).status,200);
  assert.deepEqual([await balance("A"),await balance("B")],[20,20]);
  assert.equal(await state("T-1"),"reversed");
  assert.equal((await reverse("T-1")).status,409,"Exactly once");
  assert.deepEqual([await balance("A"),await balance("B")],[20,20]);

  // Inability to debit the original destination must rollback the journal state.
  assert.equal((await transfer("T-C","C","D",10)).status,201);
  assert.equal((await transfer("T-SPEND","D","I",8)).status,201);
  assert.equal((await reverse("T-C")).status,409);
  assert.equal(await state("T-C"),"posted");
  assert.deepEqual([await balance("C"),await balance("D"),await balance("I")],[10,2,8]);
  assert.equal((await transfer("T-REFILL","I","D",8)).status,201);
  assert.equal((await reverse("T-C")).status,200);
  assert.deepEqual([await balance("C"),await balance("D"),await balance("I")],[20,0,0]);

  // Reversal must not overflow the original source's declared max.
  assert.equal((await transfer("T-CAP","E","F",5)).status,201);
  assert.equal((await transfer("T-FILL","G","E",10)).status,201);
  assert.equal(await balance("E"),100);
  assert.equal((await reverse("T-CAP")).status,409);
  assert.equal(await state("T-CAP"),"posted");
  assert.equal((await reverse("T-FILL")).status,200);
  assert.equal((await reverse("T-CAP")).status,200);
  assert.deepEqual([await balance("E"),await balance("F"),await balance("G")],[95,10,20]);

  // Concurrent identical reversal: one winner, all other HTTP 409.
  assert.equal((await transfer("T-RACE","A","B",2)).status,201);
  const same=await Promise.all(Array.from({length:10},()=>reverse("T-RACE")));
  assert.equal(same.filter(x=>x.status===200).length,1,JSON.stringify(same));
  assert.equal(same.filter(x=>x.status===409).length,9,JSON.stringify(same));
  assert.deepEqual([await balance("A"),await balance("B")],[20,20]);

  // Multiple competing reversals in opposing directions cannot deadlock.
  for(let i=0;i<10;i++)
    assert.equal((await transfer("T-O-"+i,i%2===0?"A":"B",
      i%2===0?"B":"A",1)).status,201);
  const opposite=await Promise.all(Array.from({length:10},(_,i)=>reverse("T-O-"+i)));
  assert.equal(opposite.filter(x=>x.status===200).length,10,JSON.stringify(opposite));
  assert.deepEqual([await balance("A"),await balance("B")],[20,20]);
  const count=await expect("GET","/api/movements?limit=50&offset=0",undefined,200);
  assert.equal(count.total,17,"Reversals must never delete movement records");
  const db=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT (SELECT SUM(available) FROM bin)::text || ':' || "+
      "(SELECT COUNT(*) FROM movement)::text || ':' || "+
      "(SELECT COUNT(*) FROM movement WHERE status='reversed')::text || ':' || "+
      "(SELECT COUNT(*) FROM protocolia_audit_event WHERE operation_name='reverseMovement')::text"]);
  assert.equal(db,"185:17:15:15","Stock, retained journal, one-way state and durable audit");
  // The same generated state-transition UI must issue the actual reverse endpoint.
  assert.equal((await transfer("T-UI","A","B",1)).status,201);
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(base+"/",{waitUntil:"domcontentloaded"});
    await page.getByTestId("username").fill("manager");
    await page.getByTestId("password").fill(password);
    await page.getByRole("button",{name:"Entrar"}).click();
    await page.getByRole("button",{name:"Movimientos",exact:true}).waitFor({timeout:30000});
    await page.getByRole("button",{name:"Movimientos",exact:true}).click();
    await page.getByTestId("open-detail-T-UI").waitFor({timeout:20000});
    await page.getByTestId("open-detail-T-UI").click();
    const button=page.getByTestId("transition-reverseMovement");
    await button.waitFor({timeout:20000});
    const reply=page.waitForResponse(r=>r.request().method()==="POST"&&
      r.url().endsWith("/api/movements/T-UI/reverse"));
    await button.click();
    assert.equal((await reply).status(),200);
    assert.equal(await state("T-UI"),"reversed");
    assert.deepEqual([await balance("A"),await balance("B")],[20,20]);
    await page.screenshot({path:join(generated,"b9-reverse-mobile.png"),fullPage:true});
    assert.deepEqual(errors,[],"Generated reversal UI must not raise JavaScript errors");
    console.log("PROTOCOLIA_B9_REVERSE_REACT_CHROMIUM_PASS");
  }finally{await browser.close();}
  console.log("PROTOCOLIA_B9_REVERSE_PG_HTTP_PASS "+JSON.stringify({
    rollbacksVerified:true,concurrentSingleWinner:1,concurrentConflicts:9,
    oppositeDirectionReversals:10,retainedJournal:18,auditedReversals:16,
    conservedStock:true
  }));
}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
