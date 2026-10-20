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
const label=randomBytes(5).toString("hex"),project="pia_b8_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-transfers-"));
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


  const bins="/api/bins",movements="/api/movements";
  const createBin=(sku,available)=>expect("POST",bins,{sku,name:"Bin "+sku,available},201);
  const body=(number,sourceSku,targetSku,units,note="Generated transfer")=>
    ({number,sourceSku,targetSku,units,note});
  const transfer=(number,from,to,units)=>request("POST",movements,body(number,from,to,units));
  const get=(sku)=>expect("GET",bins+"/"+sku,undefined,200);
  const balance=async(sku)=>(await get(sku)).available;
  for(const [id,n] of [["A",20],["B",20],["C",100],["D",0],
    ["E",7],["F",0],["G",20],["H",20]])await createBin(id,n);
  const denied=await request("POST",movements,body("DENY","A","B",1),
    {Authorization:basic("reader",readerPassword)});
  assert.equal(denied.status,403);
  await expect("POST",movements,body("SELF","A","A",1),400);
  await expect("POST",movements,body("BAD","A","MISSING",1),400);
  await expect("POST",movements,body("ZERO","A","B",0),400);
  await expect("POST",movements,{...body("UNKNOWN","A","B",1),rogue:1},400);
  assert.equal((await transfer("T-1","A","B",3)).status,201);
  assert.deepEqual([await balance("A"),await balance("B")],[17,23]);
  assert.equal((await transfer("T-1","A","B",2)).status,409,
    "Duplicate movement must roll back both parent updates");
  assert.deepEqual([await balance("A"),await balance("B")],[17,23]);
  assert.equal((await transfer("OVERFLOW","A","C",1)).status,409,
    "Destination maximum must be honored without integer overflow");
  assert.deepEqual([await balance("A"),await balance("C")],[17,100]);
  assert.equal((await transfer("MISSING","Z","B",1)).status,400);
  // Twelve concurrent transfers compete for only seven available units.
  const concurrent=await Promise.all(Array.from({length:12},(_,i)=>
    transfer("R-"+i,"E","F",1)));
  assert.equal(concurrent.filter(x=>x.status===201).length,7,
    JSON.stringify(concurrent));
  assert.equal(concurrent.filter(x=>x.status===409).length,5);
  assert.deepEqual([await balance("E"),await balance("F")],[0,7]);
  // Opposing transfers lock both records in the same canonical key order.
  const opposite=await Promise.all(Array.from({length:24},(_,i)=>
    transfer("O-"+i,i%2===0?"G":"H",i%2===0?"H":"G",1)));
  assert.equal(opposite.filter(x=>x.status===201).length,24,
    "Reverse-direction concurrency must not deadlock");
  assert.deepEqual([await balance("G"),await balance("H")],[20,20]);
  const journal=await expect("GET",movements+"?limit=50&offset=0",undefined,200);
  assert.equal(journal.total,32,"Only successful transfers produce rows");
  assert.equal((await expect("GET",movements+"/T-1",undefined,200)).units,3);
  assert.equal((await request("GET",movements+"/DENY")).status,404);
  assert.equal((await request("GET",movements+"/OVERFLOW")).status,404);
  const sql=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT (SELECT SUM(available) FROM bin)::text || ':' || (SELECT COUNT(*) FROM movement)::text"]);
  assert.equal(sql,"187:32","Database must conserve totals and durable movement count");

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
    await page.getByTestId("open-create").click();
    await page.getByTestId("create-sourceSku").waitFor({timeout:20000});
    await page.getByTestId("create-targetSku").waitFor({timeout:20000});
    await page.getByTestId("create-units").waitFor({timeout:20000});
    await page.getByTestId("move-units-guidance").waitFor({timeout:20000});
    await page.getByTestId("create-number").fill("UI-1");
    await page.getByTestId("create-units").fill("1");
    await page.getByTestId("create-note").fill("Transferencia desde React");
    const choose=async(field,bin)=>{
      await page.getByTestId("create-"+field).click();
      await page.getByRole("option",{name:new RegExp("Bin "+bin)}).first().click();
    };
    const postRequests=[];
    page.on("request",req=>{
      if(req.method()==="POST"&&req.url().endsWith("/api/movements"))postRequests.push(req);
    });
    await choose("sourceSku","A");
    await choose("targetSku","A");
    await page.getByTestId("create-form-Movement").getByRole("button",{name:"Crear",exact:true}).click();
    await page.getByRole("alert").getByText("El destino debe ser distinto del origen.").waitFor();
    assert.equal(postRequests.length,0,"Invalid self-transfer must not reach the API");
    await choose("targetSku","B");
    const response=page.waitForResponse(res=>res.url().endsWith("/api/movements")&&
      res.request().method()==="POST");
    await page.getByTestId("create-form-Movement").getByRole("button",{name:"Crear",exact:true}).click();
    assert.equal((await response).status(),201,"Real generated React form must transfer once");
    assert.deepEqual([await balance("A"),await balance("B")],[16,24]);
    assert.equal((await expect("GET",movements+"/UI-1",undefined,200)).units,1);
    await page.screenshot({path:join(generated,"b8-transfer-mobile.png"),fullPage:true});
    assert.deepEqual(errors,[],"Generated inventory-transfer screen must not throw");
    console.log("PROTOCOLIA_B8_TRANSFER_MOBILE_CREATE_CHROMIUM_PASS");
  }finally{await browser.close();}
  console.log("PROTOCOLIA_B8_TRANSFER_PG_HTTP_PASS "+JSON.stringify({
    conservedStock:true,acceptedOneDirection:7,rejectedInsufficient:5,
    opposingTransfers:24,rollbackOnDuplicate:true,rejectedOverflow:true,
    durableJournal:32,independentBackend:true
  }));
}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
