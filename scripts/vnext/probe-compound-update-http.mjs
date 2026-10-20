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
const label=randomBytes(5).toString("hex"),project="pia_b6_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-batch-update-"));
const schema=readFileSync(
  existsSync(join(generated,"src/schema.sql"))?join(generated,"src/schema.sql"):
    join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/CONSTRAINT uq_batch_business UNIQUE \(branch,period\)/,
  "Generator must enforce composite business uniqueness in PostgreSQL");
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
  const create=(code,branch,period,description)=>
    expect("POST","/api/batches",{code,branch,period,description},201);
  const modify=(code,branch,period)=>request("PATCH","/api/batches/"+
    code+"/key",{branch,period});
  await create("B-001","north","2026-10","Original");
  await create("B-002","south","2026-11","Second");
  await expect("PATCH","/api/batches/B-001/key",
    {branch:"south",period:"2026-11"},409);
  const unchanged=await expect("GET","/api/batches/B-001",undefined,200);
  assert.deepEqual([unchanged.branch,unchanged.period,unchanged.description],
    ["north","2026-10","Original"],"Entire PATCH must roll back on duplicate");
  const changed=await modify("B-001","central","2026-12");
  assert.equal(changed.status,200,JSON.stringify(changed.body));
  assert.deepEqual([changed.body.branch,changed.body.period,changed.body.description],
    ["central","2026-12","Original"],"Both key fields change, unrelated fields preserved");
  await expect("PATCH","/api/batches/B-001/key",
    {branch:"north",period:"2026-10",ignored:"bad"},400);
  await expect("PATCH","/api/batches/B-001/key",{branch:"north"},400);
  await expect("PATCH","/api/batches/does-not-exist/key",
    {branch:"unknown",period:"2026-08"},404);
  for(let i=0;i<12;i++)await create("R-"+i,"branch-"+i,"2026-09","Race "+i);
  const concurrent=await Promise.all(Array.from({length:12},(_,i)=>
    modify("R-"+i,"winner","2026-10")));
  assert.equal(concurrent.filter(r=>r.status===200).length,1,
    "Exactly one PATCH is allowed to claim the same business key");
  assert.equal(concurrent.filter(r=>r.status===409).length,11,
    "All other PATCH requests must fail with conflict");
  for(let i=0;i<12;i++){
    const after=await expect("GET","/api/batches/R-"+i,undefined,200);
    if(concurrent[i].status===200)
      assert.deepEqual([after.branch,after.period],["winner","2026-10"]);
    else assert.deepEqual([after.branch,after.period],["branch-"+i,"2026-09"],
      "Losing UPDATE must change neither column");
  }
  const page=await expect("GET","/api/batches?limit=25&offset=0",undefined,200);
  assert.equal(page.total,14,"Conflicts must not create or delete rows");
  const result=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT COUNT(*) FROM batch WHERE branch='winner' AND period='2026-10'"]);
  assert.equal(Number(result),1,"PostgreSQL must contain exactly one concurrent winner");
  const forbidden=await request("PATCH","/api/batches/B-001/key",
    {branch:"forbidden",period:"2026-07"},
    {Authorization:basic("reader",readerPassword)});
  assert.equal(forbidden.status,403,"Read-only role cannot mutate composite key");
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
    const browserErrors=[];page.on("pageerror",error=>browserErrors.push(error.message));
    await page.goto(base+"/",{waitUntil:"domcontentloaded"});
    await page.getByTestId("username").fill("manager");
    await page.getByTestId("password").fill(password);
    await page.getByRole("button",{name:"Entrar"}).click();
    await page.getByTestId("open-detail-B-001").waitFor({timeout:20000});
    await page.getByTestId("open-detail-B-001").click();
    await page.getByTestId("compound-update-form").waitFor({timeout:20000});
    await page.getByTestId("compound-branch").fill("south");
    await page.getByTestId("compound-period").fill("2026-11");
    const rejected=page.waitForResponse(response=>response.url().endsWith("/api/batches/B-001/key")&&
      response.request().method()==="PATCH");
    await page.getByTestId("save-compound").click();
    assert.equal((await rejected).status(),409);
    await page.getByRole("alert").getByText(/Ya existe otro registro con esa combinación/).waitFor();
    const beforeSuccess=await expect("GET","/api/batches/B-001",undefined,200);
    assert.deepEqual([beforeSuccess.branch,beforeSuccess.period],["central","2026-12"]);
    await page.getByTestId("compound-branch").fill("west");
    await page.getByTestId("compound-period").fill("2026-10");
    const accepted=page.waitForResponse(response=>response.url().endsWith("/api/batches/B-001/key")&&
      response.request().method()==="PATCH");
    await page.getByTestId("save-compound").click();
    assert.equal((await accepted).status(),200);
    await page.getByText("Ambos campos se actualizaron correctamente.").waitFor();
    const afterUi=await expect("GET","/api/batches/B-001",undefined,200);
    assert.deepEqual([afterUi.branch,afterUi.period,afterUi.description],["west","2026-10","Original"]);
    assert.deepEqual(browserErrors,[],"Generated React editor must not produce JavaScript exceptions");
    await page.screenshot({path:join(generated,"b6-compound-update-mobile.png"),fullPage:true});
    console.log("PROTOCOLIA_B6_COMPOUND_UI_CHROMIUM_PASS");
  }finally{await browser.close();}
  console.log("PROTOCOLIA_B6_ATOMIC_COMPOUND_PATCH_PASS "+JSON.stringify({
    fullTypeSpecGeneration:true,atomicMultiColumnUpdate:true,conflict409:true,
    concurrentWinners:1,rejectedConcurrentUpdates:11,unchangedLosers:11,
    sourceRowsPreserved:14
  }));

}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
