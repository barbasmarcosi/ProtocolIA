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
const label=randomBytes(5).toString("hex"),project="pia_b7_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-multicolumn-"));
const schema=readFileSync(
  existsSync(join(generated,"src/schema.sql"))?join(generated,"src/schema.sql"):
    join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/CONSTRAINT uq_batch_business UNIQUE \(branch,period,department\)/,
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

  const create=(code,branch,period,department,description)=>
    expect("POST","/api/batches",{code,branch,period,department,description},201);
  const modify=(code,branch,period,department)=>request("PATCH","/api/batches/"+
    code+"/key",{branch,period,department});
  await create("B-001","north","2026-10","operations","Original");
  await create("B-002","south","2026-11","finance","Second");
  await expect("PATCH","/api/batches/B-001/key",
    {branch:"south",period:"2026-11",department:"finance"},409);
  const unchanged=await expect("GET","/api/batches/B-001",undefined,200);
  assert.deepEqual([unchanged.branch,unchanged.period,unchanged.department,unchanged.description],
    ["north","2026-10","operations","Original"],"All three fields remain unchanged");
  const changed=await modify("B-001","central","2026-12","service");
  assert.equal(changed.status,200,JSON.stringify(changed.body));
  assert.deepEqual([changed.body.branch,changed.body.period,changed.body.department,changed.body.description],
    ["central","2026-12","service","Original"]);
  await expect("PATCH","/api/batches/B-001/key",
    {branch:"north",period:"2026-10",department:"operations",ignored:"bad"},400);
  await expect("PATCH","/api/batches/B-001/key",{branch:"north",period:"2026-10"},400);
  await expect("PATCH","/api/batches/does-not-exist/key",
    {branch:"unknown",period:"2026-08",department:"operations"},404);
  for(let i=0;i<12;i++)
    await create("R-"+i,"branch-"+i,"2026-09","dept-"+i,"Race "+i);
  const concurrent=await Promise.all(Array.from({length:12},(_,i)=>
    modify("R-"+i,"winner","2026-10","shared")));
  assert.equal(concurrent.filter(r=>r.status===200).length,1,
    "One and only one concurrent three-key PATCH succeeds");
  assert.equal(concurrent.filter(r=>r.status===409).length,11,
    "All other concurrent three-key PATCHes conflict");
  for(let i=0;i<12;i++){
    const after=await expect("GET","/api/batches/R-"+i,undefined,200);
    if(concurrent[i].status===200)
      assert.deepEqual([after.branch,after.period,after.department],["winner","2026-10","shared"]);
    else assert.deepEqual([after.branch,after.period,after.department],
      ["branch-"+i,"2026-09","dept-"+i],"Losing UPDATE preserves all three columns");
  }
  const pageResult=await expect("GET","/api/batches?limit=25&offset=0",undefined,200);
  assert.equal(pageResult.total,14);
  const result=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT COUNT(*) FROM batch WHERE branch='winner' AND period='2026-10' AND department='shared'"]);
  assert.equal(Number(result),1,"Unique compound-key constraint must arbitrate concurrency");
  const forbidden=await request("PATCH","/api/batches/B-001/key",
    {branch:"forbidden",period:"2026-07",department:"service"},
    {Authorization:basic("reader",readerPassword)});
  assert.equal(forbidden.status,403,"Reader cannot mutate business keys");

  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
    const browserErrors=[];page.on("pageerror",e=>browserErrors.push(e.message));
    await page.goto(base+"/",{waitUntil:"domcontentloaded"});
    await page.getByTestId("username").fill("manager");
    await page.getByTestId("password").fill(password);
    await page.getByRole("button",{name:"Entrar"}).click();
    await page.getByTestId("open-detail-B-001").waitFor({timeout:20000});
    await page.getByTestId("open-detail-B-001").click();
    await page.getByTestId("compound-update-form").waitFor({timeout:20000});
    await page.getByTestId("compound-branch").fill("south");
    await page.getByTestId("compound-period").fill("2026-11");
    await page.getByTestId("compound-department").fill("finance");
    const rejected=page.waitForResponse(response=>
      response.url().endsWith("/api/batches/B-001/key")&&response.request().method()==="PATCH");
    await page.getByTestId("save-compound").click();
    assert.equal((await rejected).status(),409);
    await page.getByRole("alert").getByText(/Ya existe otro registro con esa combinación/).waitFor();
    const beforeSuccess=await expect("GET","/api/batches/B-001",undefined,200);
    assert.deepEqual([beforeSuccess.branch,beforeSuccess.period,beforeSuccess.department],
      ["central","2026-12","service"]);
    await page.getByTestId("compound-branch").fill("west");
    await page.getByTestId("compound-period").fill("2026-10");
    await page.getByTestId("compound-department").fill("research");
    const accepted=page.waitForResponse(response=>
      response.url().endsWith("/api/batches/B-001/key")&&response.request().method()==="PATCH");
    await page.getByTestId("save-compound").click();
    assert.equal((await accepted).status(),200);
    await page.getByText("La clave de negocio se actualizó correctamente.").waitFor();
    const afterUi=await expect("GET","/api/batches/B-001",undefined,200);
    assert.deepEqual([afterUi.branch,afterUi.period,afterUi.department,afterUi.description],
      ["west","2026-10","research","Original"]);
    await page.setViewportSize({width:1280,height:800});
    await page.getByTestId("compound-department").waitFor();
    assert.deepEqual(browserErrors,[],"Generated multi-field editor must not throw");
    await page.screenshot({path:join(generated,"b7-compound-update-3-desktop.png"),fullPage:true});
    console.log("PROTOCOLIA_B7_THREE_FIELD_UI_CHROMIUM_PASS");
  }finally{await browser.close();}
  console.log("PROTOCOLIA_B7_ATOMIC_MULTI_FIELD_PATCH_PASS "+JSON.stringify({
    fullTypeSpecGeneration:true,atomicThreeColumnUpdate:true,conflict409:true,
    concurrentWinners:1,rejectedConcurrentUpdates:11,unchangedLosers:11,rowsPreserved:14
  }));
}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
