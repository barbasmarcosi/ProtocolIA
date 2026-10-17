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
const label=randomBytes(5).toString("hex"),project="pia_b10_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-multileg-"));
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
  const movement=(number,from1,to1,n1,from2,to2,n2)=>({
    number,sourceSku1:from1,targetSku1:to1,units1:n1,
    sourceSku2:from2,targetSku2:to2,units2:n2,note:"Two balanced legs"
  });
  const create=(...args)=>request("POST",batches,movement(...args));
  const balance=async sku=>(await expect("GET",bins+"/"+sku,undefined,200)).available;
  const current=async names=>Promise.all(names.map(balance));
  const setup=[["A",20],["B",0],["C",0],["D",100],["E",98],["F",0],
    ["G",7],["H",0],["I",0],["J",20],["K",20],["L",20],
    ["Q",20],["R",20],["S",20]];
  for(const [sku,units] of setup)await createBin(sku,units);
  assert.equal(setup.reduce((sum,item)=>sum+item[1],0),345);
  const reader=await request("POST",batches,
    movement("DENY","A","B",1,"B","C",1),
    {Authorization:basic("reader",readerPassword)});
  assert.equal(reader.status,403,"Read-only user cannot settle inventory");
  assert.equal((await create("SELF","A","A",1,"B","C",1)).status,400);
  assert.equal((await create("MISSING","A","NOPE",1,"B","C",1)).status,400);
  assert.equal((await request("POST",batches,{...movement("UNKNOWN","A","B",1,"B","C",1),rogue:1})).status,400);
  const p1=await create("P-1","A","B",4,"B","C",4);
  assert.equal(p1.status,201,JSON.stringify(p1));
  assert.deepEqual(await current(["A","B","C"]),[16,0,4],
    "Shared intermediary can relay stock in same atomic batch, even starting empty");
  const p2=await create("P-2","A","B",3,"B","C",2);
  assert.equal(p2.status,201);
  assert.deepEqual(await current(["A","B","C"]),[13,1,6]);
  assert.equal((await create("P-1","A","B",4,"B","C",4)).status,409);
  assert.deepEqual(await current(["A","B","C"]),[13,1,6]);
  assert.equal((await create("OVER","A","D",2,"B","C",1)).status,409);
  assert.deepEqual(await current(["A","B","C","D"]),[13,1,6,100],
    "Whole transaction rolls back when one leg would overfill its destination");
  assert.equal((await create("INSUFFICIENT","A","B",14,"B","C",1)).status,409);
  assert.deepEqual(await current(["A","B","C"]),[13,1,6]);
  const raced=await Promise.all(Array.from({length:12},(_,i)=>
    create("R-"+i,"G","H",1,"H","I",1)));
  assert.equal(raced.filter(x=>x.status===201).length,7,JSON.stringify(raced));
  assert.equal(raced.filter(x=>x.status===409).length,5,JSON.stringify(raced));
  assert.deepEqual(await current(["G","H","I"]),[0,0,7]);
  const duplicate=await Promise.all(Array.from({length:12},()=>
    create("DUP","J","K",1,"K","L",1)));
  assert.equal(duplicate.filter(x=>x.status===201).length,1,JSON.stringify(duplicate));
  assert.equal(duplicate.filter(x=>x.status===409).length,11,JSON.stringify(duplicate));
  assert.deepEqual(await current(["J","K","L"]),[19,20,21]);
  const opposite=await Promise.all(Array.from({length:20},(_,i)=>i%2===0?
    create("O-"+i,"Q","R",1,"R","S",1):
    create("O-"+i,"S","R",1,"R","Q",1)));
  assert.equal(opposite.filter(x=>x.status===201).length,20,JSON.stringify(opposite));
  assert.deepEqual(await current(["Q","R","S"]),[20,20,20]);
  const page=await expect("GET",batches+"?limit=50&offset=0",undefined,200);
  assert.equal(page.total,30,"Only committed batch journals are durable");
  const sql=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT (SELECT SUM(available) FROM bin)::text || ':' || "+
      "(SELECT COUNT(*) FROM batch)::text"]);
  assert.equal(sql,"345:30","All committed legs conserve total units and journal count");

  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(base+"/",{waitUntil:"domcontentloaded"});
    await page.getByTestId("username").fill("manager");
    await page.getByTestId("password").fill(password);
    await page.getByRole("button",{name:"Entrar"}).click();
    await page.getByRole("button",{name:"Movimientos multipardita",exact:true})
      .waitFor({timeout:30000});
    await page.getByRole("button",{name:"Movimientos multipardita",exact:true}).click();
    await page.getByTestId("open-create").click();
    await page.getByTestId("move-batch-guidance").waitFor({timeout:20000});
    await page.getByTestId("create-number").fill("UI-1");
    await page.getByTestId("create-note").fill("Liquidación generada desde React");
    await page.getByTestId("create-units1").fill("1");
    await page.getByTestId("create-units2").fill("1");
    const pick=async(field,value)=>{
      await page.getByTestId("create-"+field).click();
      const option=page.getByRole("option").filter({hasText:"Bin "+value}).first();
      await option.waitFor({timeout:10000});
      await option.click();
      await page.getByRole("listbox").waitFor({state:"hidden"});
    };
    await pick("sourceSku1","A");
    await pick("targetSku1","A");
    await pick("sourceSku2","B");
    await pick("targetSku2","C");
    let submitted=0;page.on("request",request=>{
      if(request.method()==="POST"&&request.url().endsWith("/api/batches"))submitted++;
    });
    await page.getByTestId("create-form-Batch").getByRole("button",{name:"Crear",exact:true}).click();
    await page.getByRole("alert").getByText("Cada partida debe tener un origen y destino distintos.").waitFor();
    assert.equal(submitted,0,"Per-leg invalid transfer must be blocked in generated UI");
    await pick("targetSku1","B");
    const response=page.waitForResponse(r=>r.request().method()==="POST"&&
      r.url().endsWith("/api/batches"));
    await page.getByTestId("create-form-Batch").getByRole("button",{name:"Crear",exact:true}).click();
    assert.equal((await response).status(),201,"Generated form actually persists both legs");
    assert.deepEqual(await current(["A","B","C"]),[12,1,7]);
    await page.screenshot({path:join(generated,"b10-multi-leg-mobile.png"),fullPage:true});
    assert.deepEqual(errors,[],"Generated batch UI must not crash");
    console.log("PROTOCOLIA_B10_GENERATED_MULTILEG_REACT_CHROMIUM_PASS");
  }finally{await browser.close();}
  console.log("PROTOCOLIA_B10_ATOMIC_NET_SETTLEMENT_PASS "+JSON.stringify({
    preservedUnits:true,sharedParentNetting:true,commitCount:31,
    raceWinners:7,insufficientConflicts:5,
    duplicateConcurrentWinners:1,duplicateConflicts:11,
    oppositeDirections:20,rolledBackOverflow:true,generatedReact:true
  }));
}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
