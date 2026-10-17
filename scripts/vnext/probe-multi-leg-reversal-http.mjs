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
const label=randomBytes(5).toString("hex"),project="pia_b11_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-batch-reversal-"));
const schema=readFileSync(
  existsSync(join(generated,"src/schema.sql"))?join(generated,"src/schema.sql"):
    join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/CREATE TABLE bin \(/,"Generated PostgreSQL stock table is required");
assert.match(schema,/CREATE TABLE batch \(/,"Generated PostgreSQL transfer journal is required");
assert.match(schema,/fk_batch_source_sku1|FOREIGN KEY \(source_sku\)/,
  "Generated movement must reference existing source");
assert.match(schema,/fk_batch_target_sku2|FOREIGN KEY \(target_sku\)/,
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




  const bins="/api/bins",batches="/api/batches";
  const createBin=(sku,available)=>expect("POST",bins,{sku,name:"Bin "+sku,available},201);
  const payload=(number,from1,to1,units1,from2,to2,units2)=>({
    number,sourceSku1:from1,targetSku1:to1,units1,
    sourceSku2:from2,targetSku2:to2,units2,note:"Immutable batch settlement"
  });
  const post=(...fields)=>request("POST",batches,payload(...fields));
  const reverse=number=>request("POST",batches+"/"+number+"/reverse");
  const get=sku=>expect("GET",bins+"/"+sku,undefined,200);
  const balances=async (...ids)=>Promise.all(ids.map(async id=>(await get(id)).available));
  const status=async number=>(await expect("GET",batches+"/"+number,undefined,200)).status;
  const accounts=[["A",20],["B",0],["C",0],["D",100],["E",97],["F",10],
    ["G",7],["H",0],["I",0],["J",20],["K",20],["L",20],
    ["Q",20],["R",20],["S",20]];
  for(const [sku,value] of accounts)await createBin(sku,value);
  const expectedSum=accounts.reduce((a,[,value])=>a+value,0);
  assert.equal((await request("POST",batches,{
    ...payload("CLIENT-STATUS","A","B",1,"B","C",1),status:"reversed"})).status,400);
  assert.equal((await post("SELF","A","A",1,"B","C",1)).status,400);
  assert.equal((await post("MISSING","A","Z",1,"B","C",1)).status,400);
  assert.equal((await request("POST",batches,{
    ...payload("UNKNOWN","A","B",1,"B","C",1),extra:1})).status,400);
  assert.equal((await request("POST",batches,payload("READER","A","B",1,"B","C",1),
    {Authorization:basic("reader",readerPassword)})).status,403);
  assert.equal((await reverse("UNKNOWN")).status,404);

  // A shared intermediate begins at zero, with no intermediate balance ever exposed.
  assert.equal((await post("BASIC","A","B",4,"B","C",4)).status,201);
  assert.equal(await status("BASIC"),"posted");
  assert.deepEqual(await balances("A","B","C"),[16,0,4]);
  assert.equal((await reverse("BASIC")).status,200);
  assert.equal(await status("BASIC"),"reversed");
  assert.deepEqual(await balances("A","B","C"),[20,0,0]);
  assert.equal((await reverse("BASIC")).status,409);

  // A later credit to an original source can make reversal exceed the max 100.
  assert.equal((await post("CAP","E","F",5,"F","G",5)).status,201);
  assert.deepEqual(await balances("E","F","G"),[92,10,25]);
  assert.equal((await post("FILL","G","E",8,"F","B",1)).status,201);
  assert.deepEqual(await balances("E","F","G","B"),[100,9,17,1]);
  assert.equal((await reverse("CAP")).status,409,"Source would exceed bound after reversal");
  assert.equal(await status("CAP"),"posted");
  assert.deepEqual(await balances("E","F","G","B"),[100,9,17,1]);
  assert.equal((await reverse("FILL")).status,200);
  assert.equal((await reverse("CAP")).status,200);
  assert.deepEqual(await balances("E","F","G","B"),[97,10,20,0]);

  // Original receiver spent transferred units; state and all deltas must roll back.
  assert.equal((await post("NET","A","B",10,"B","C",10)).status,201);
  assert.equal((await post("SPEND","C","D",8,"D","I",8)).status,201);
  assert.deepEqual(await balances("A","B","C","I"),[10,0,2,8]);
  assert.equal((await reverse("NET")).status,409);
  assert.equal(await status("NET"),"posted");
  assert.deepEqual(await balances("A","B","C","I"),[10,0,2,8]);
  assert.equal((await post("REFILL","I","C",8,"D","F",1)).status,201);
  assert.equal((await reverse("NET")).status,200);
  assert.equal(await status("NET"),"reversed");
  assert.deepEqual(await balances("A","B","C"),[20,0,0]);

  // 12 writers competing for 7 units; every success is a durable, intact 2-leg batch.
  const racing=await Promise.all(Array.from({length:12},(_,i)=>
    post("R-"+i,"G","H",1,"H","I",1)));
  assert.equal(racing.filter(x=>x.status===201).length,7,JSON.stringify(racing));
  assert.equal(racing.filter(x=>x.status===409).length,5,JSON.stringify(racing));
  assert.deepEqual(await balances("G","H","I"),[0,0,7]);

  // Exactly one of ten simultaneous reversals can win the state transition.
  assert.equal((await post("RACE","J","K",2,"K","L",2)).status,201);
  const concurrent=await Promise.all(Array.from({length:10},()=>reverse("RACE")));
  assert.equal(concurrent.filter(x=>x.status===200).length,1,JSON.stringify(concurrent));
  assert.equal(concurrent.filter(x=>x.status===409).length,9,JSON.stringify(concurrent));
  assert.deepEqual(await balances("J","K","L"),[20,20,20]);

  // Reversals of opposing batches lock parent rows in the same global ordering.
  for(let i=0;i<10;i++){
    const move=i%2===0?["Q","R","R","S"]:["S","R","R","Q"];
    assert.equal((await post("OP-"+i,move[0],move[1],1,move[2],move[3],1)).status,201);
  }
  const opposite=await Promise.all(Array.from({length:10},(_,i)=>reverse("OP-"+i)));
  assert.equal(opposite.filter(x=>x.status===200).length,10,JSON.stringify(opposite));
  assert.deepEqual(await balances("Q","R","S"),[20,20,20]);
  const sql=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT (SELECT SUM(available) FROM bin)::text || ':' || "+
    "(SELECT COUNT(*) FROM batch WHERE status='reversed')::text || ':' || "+
    "(SELECT COUNT(*) FROM protocolia_audit_event WHERE operation_name='reverseBatchJournal')::text"]);
  const [sum,reverseCount,auditCount]=sql.split(":").map(Number);
  assert.equal(sum,expectedSum,"Multi-leg reversal conserves every unit");
  assert.equal(reverseCount,15);
  assert.equal(auditCount,15,"One durable audit entry per successful batch reversal");

  // The same generated React screen must execute the real guarded reversal.
  assert.equal((await post("UI-REV","Q","R",1,"R","S",1)).status,201);
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(base+"/",{waitUntil:"domcontentloaded"});
    await page.getByTestId("username").fill("manager");
    await page.getByTestId("password").fill(password);
    await page.getByRole("button",{name:"Entrar"}).click();
    await page.getByRole("button",{name:"Movimientos multipardita",exact:true}).waitFor({timeout:30000});
    await page.getByRole("button",{name:"Movimientos multipardita",exact:true}).click();
    await page.getByTestId("open-detail-UI-REV").waitFor({timeout:30000});
    await page.getByTestId("open-detail-UI-REV").click();
    const button=page.getByTestId("transition-reverseBatchJournal");
    await button.waitFor({timeout:20000});
    const response=page.waitForResponse(x=>x.request().method()==="POST"&&
      x.url().endsWith("/api/batches/UI-REV/reverse"));
    await button.click();
    assert.equal((await response).status(),200);
    assert.equal(await status("UI-REV"),"reversed");
    assert.deepEqual(await balances("Q","R","S"),[20,20,20]);
    await page.screenshot({path:join(generated,"b11-batch-reversal-mobile.png"),fullPage:true});
    assert.deepEqual(errors,[],"Generated reversal action must not throw");
    console.log("PROTOCOLIA_B11_MULTI_REVERSAL_REACT_CHROMIUM_PASS");
  }finally{await browser.close();}
  const checked=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT COUNT(*) FROM protocolia_audit_event WHERE operation_name='reverseBatchJournal'"]);
  assert.equal(Number(checked),16);
  console.log("PROTOCOLIA_B11_MULTILEG_REVERSAL_PASS "+JSON.stringify({
    exactlyOnce:1,concurrentConflicts:9,opposingReversals:10,
    batchAuditEvents:16,rollbackWhenSpent:true,rollbackWhenFull:true,
    preservedUnits:true,generatedReact:true
  }));
}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
