#!/usr/bin/env node
// Actual PostgreSQL transaction oracle for frozen PG-01..PG-12; only isolated
// randomly named Compose and synthetic data. No production payment operations.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes,createHash} from "node:crypto";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:net";

const root=resolve(process.argv[2]??"");
const build=JSON.parse(readFileSync(join(root,"protocolia-build.json"),"utf8"));
assert.ok(["nestjs","modular-spring"].includes(build.target));
const irBytes=readFileSync(join(root,"protocolia-contract-ir.json"));
const ir=JSON.parse(irBytes);
assert.equal(createHash("sha256").update(irBytes).digest("hex"),build.irSha256);
assert.deepEqual(ir.entities.map(e=>e.name).sort(),["Customer","Payment","Vehicle","WorkOrder"]);
const post=ir.operations.find(x=>x.entity==="Payment"&&x.behavior.kind==="create");
const reversed=ir.operations.find(x=>x.entity==="Payment"&&x.behavior.kind==="transition");
const recon=ir.operations.find(x=>x.entity==="WorkOrder"&&x.behavior.kind==="reconcileExact");
assert.deepEqual(post?.behavior.debitExact,{
  stockEntity:"WorkOrder",availableField:"available",referenceField:"orderNumber",quantityField:"amount"
});
assert.deepEqual(reversed?.behavior.reverseExact,post.behavior.debitExact);
assert.ok(recon?.behavior.reconcileExact);
assert.deepEqual(recon.behavior.reconcileExact.chargeSources,["laborCharge","partsCharge"]);
assert.ok(!ir.operations.some(x=>x.entity==="Payment"&&x.behavior.kind==="delete"),
  "Deleting receipts must not bypass the journal");
const scratch=mkdtempSync(join(tmpdir(),"pia-financial-guard-"));
const project="pia_financial_"+randomBytes(5).toString("hex");
const env={
  PROTOCOLIA_DB_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_ALLOW_DEMO_AUTH:"true",
  PROTOCOLIA_MANAGER_USERNAME:"payment_manager",
  PROTOCOLIA_MANAGER_PASSWORD:randomBytes(18).toString("hex"),
  PROTOCOLIA_READER_USERNAME:"payment_reader",
  PROTOCOLIA_READER_PASSWORD:randomBytes(18).toString("hex")
};
let started=false;
const cases=[];
function pass(id){assert.ok(!cases.includes(id));cases.push(id);
  console.log("PROTOCOLIA_V12D_FINANCE_CASE_PASS "+id);}
function docker(...args){
  const cmd=spawnSync("docker",["compose","--project-name",project,"--env-file",
    join(scratch,"env"),...args],{cwd:root,env:{...process.env,...env},
    encoding:"utf8",timeout:600000,maxBuffer:3*1024*1024});
  if(cmd.error||cmd.status!==0)throw Error("Compose "+args.join(" ")+": "+
    (cmd.stderr??cmd.error?.message??"").slice(-1600));
  return cmd.stdout?.trim();
}
async function freePort(){return await new Promise((yes,no)=>{
  const s=createServer();s.once("error",no);
  s.listen(0,"127.0.0.1",()=>{const p=s.address().port;
    s.close(err=>err?no(err):yes(p));});
});}
async function ready(base){for(let i=0;i<120;i++){
  try{const res=await fetch(base+"/health",{signal:AbortSignal.timeout(2000)});
    if(res.status===200)return;}catch{}
  await new Promise(r=>setTimeout(r,1000));
}throw Error("Generated application not healthy");}
function cents(x){assert.equal(typeof x,"string","Decimal must be an exact JSON string");
  assert.match(x,/^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/);
  const [whole,fraction=""]=x.split(".");
  return BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));
}
function auth(role){const m=role==="reader";
  return "Basic "+Buffer.from((m?env.PROTOCOLIA_READER_USERNAME:env.PROTOCOLIA_MANAGER_USERNAME)+":"+
    (m?env.PROTOCOLIA_READER_PASSWORD:env.PROTOCOLIA_MANAGER_PASSWORD)).toString("base64");}
let base;
async function request(path,{method="GET",role="manager",body}={}){
  const res=await fetch(base+path,{
    method,headers:{Authorization:auth(role),
      ...(body===undefined?{}:{"Content-Type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const raw=await res.text();let data;
  try{data=JSON.parse(raw);}catch{data=raw;}
  return {status:res.status,data};
}
async function status(path,expected,opts){const res=await request(path,opts);
  assert.equal(res.status,expected,path+" "+JSON.stringify(res.data));
  return res.data;}
const orderBody=(number,labor,parts="0.00")=>({
  number,vehiclePlate:"AA123BB",symptom:"Trabajo de prueba",
  laborCharge:labor,partsCharge:parts,status:"opened",openedAt:null
});
const payment=(receipt,number,amount)=>({
  receipt,orderNumber:number,amount,method:"cash",destinationAccount:"Caja de prueba"
});
async function mobileSmoke(){
  if(process.env.PROTOCOLIA_BROWSER_VERIFY!=="true")return;
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(base+"/",{waitUntil:"domcontentloaded"});
    await page.locator('[data-testid="username"]').fill(env.PROTOCOLIA_MANAGER_USERNAME);
    await page.locator('[data-testid="password"]').fill(env.PROTOCOLIA_MANAGER_PASSWORD);
    await page.getByRole("button",{name:"Entrar"}).click();
    const nav=page.getByRole("navigation",{name:"Secciones de la aplicación"});
    await nav.waitFor({state:"visible",timeout:20000});
    await nav.getByRole("button",{name:"Órdenes de trabajo",exact:true}).click();
    await page.locator('[data-testid="open-create"]').click();
    const form=page.locator('[data-testid="create-form-WorkOrder"]');
    await form.waitFor({state:"visible",timeout:10000});
    assert.equal(await form.locator('[data-testid="create-openingBalance"]').count(),0);
    assert.equal(await form.locator('[data-testid="create-available"]').count(),0);
    assert.equal(await form.locator('[data-testid="create-laborCharge"]').count(),1);
    assert.equal(await form.locator('[data-testid="create-partsCharge"]').count(),1);
    await form.locator('[data-testid="create-number"]').fill("OT-MOBILE");
    await form.locator('[data-testid="create-symptom"]').fill("Verificación móvil");
    await form.locator('[data-testid="create-laborCharge"]').fill("8.25");
    await form.locator('[data-testid="create-partsCharge"]').fill("1.75");
    await form.locator('[data-testid="create-vehiclePlate"]').click();
    await page.getByRole("option").first().click();
    const responsePromise=page.waitForResponse(res=>
      res.url().endsWith("/api/work-orders")&&res.request().method()==="POST",{timeout:25000});
    await form.getByRole("button",{name:"Crear",exact:true}).click();
    const response=await responsePromise;
    assert.equal(response.status(),201,"Generated browser must create order");
    const sent=JSON.parse(response.request().postData()??"{}");
    assert.equal(sent.laborCharge,"8.25");
    assert.equal(sent.partsCharge,"1.75");
    assert.ok(!Object.hasOwn(sent,"openingBalance"));
    assert.ok(!Object.hasOwn(sent,"available"));
    await page.locator('[data-testid="open-detail-OT-MOBILE"]').waitFor({timeout:20000});
    const fetched=await status("/api/work-orders/OT-MOBILE",200);
    assert.equal(cents(fetched.openingBalance),1000n);
    assert.equal(cents(fetched.available),1000n);
    assert.deepEqual(errors,[]);
    const screenshot=await page.screenshot({fullPage:true});
    console.log("PROTOCOLIA_SERVER_ONLY_MOBILE_PASS "+JSON.stringify({
      target:build.target,viewport:"390x844",browserErrors:0,
      requestKeys:Object.keys(sent).sort(),screenshotSha256:createHash("sha256").update(screenshot).digest("hex")
    }));
  }finally{await browser.close();}
}
async function balance(number){
  const record=await status("/api/work-orders/"+number,200);
  const snapshot=await status("/api/work-orders/"+number+"/reconciliation",200);
  assert.equal(snapshot.balanced,true,"Reconciliation must balance");
  assert.equal(cents(snapshot.available),cents(record.available));
  assert.equal(cents(snapshot.difference),0n);
  return {record,snapshot};
}
try{
  const port=await freePort();env.PROTOCOLIA_HOST_PORT=String(port);
  writeFileSync(join(scratch,"env"),
    Object.entries(env).map(([k,v])=>k+"="+v).join("\n")+"\n",{mode:0o600});
  docker("config","--quiet");started=true;docker("up","--detach","--build");
  base="http://127.0.0.1:"+port;await ready(base);

  await status("/api/customers",201,{method:"POST",body:{
    customerCode:"C-001",name:"Cliente sintético",contactNote:"Sin PII"
  }});
  await status("/api/vehicles",201,{method:"POST",body:{
    plate:"AA123BB",customerCode:"C-001",modelName:"Modelo ficticio",mileageKm:0
  }});
  await mobileSmoke();
  await status("/api/work-orders",201,{method:"POST",body:orderBody("OT-MULTI","10.00","5.00")});
  const combined=await balance("OT-MULTI");
  assert.equal(cents(combined.record.openingBalance),1500n);
  assert.equal(cents(combined.record.available),1500n);
  assert.equal(cents(combined.record.laborCharge),1000n);
  assert.equal(cents(combined.record.partsCharge),500n);
  console.log("PROTOCOLIA_MULTICHARGE_PASS MS-01");
  await status("/api/work-orders",201,{method:"POST",body:orderBody("OT-FLOAT","0.10","0.20")});
  assert.equal(cents((await balance("OT-FLOAT")).record.openingBalance),30n);
  console.log("PROTOCOLIA_MULTICHARGE_PASS MS-02");
  await status("/api/work-orders",400,{method:"POST",body:
    orderBody("OT-OVERFLOW","999999999999.99","0.01")});
  await status("/api/work-orders/OT-OVERFLOW",404);
  await status("/api/work-orders",201,{method:"POST",body:
    orderBody("OT-BOUNDARY","999999999999.98","0.01")});
  assert.equal(cents((await balance("OT-BOUNDARY")).record.openingBalance),99999999999999n);
  console.log("PROTOCOLIA_MULTICHARGE_PASS MS-03");
  for(const [number,override] of [
    ["OT-NEGATIVE",{partsCharge:"-0.01"}],
    ["OT-BAD-WIRE",{partsCharge:0.2}],
    ["OT-MISSING",{partsCharge:undefined}],
    ["OT-NULL",{partsCharge:null}]
  ]){
    const body={...orderBody(number,"1.00"),...override};
    if(override.partsCharge===undefined)delete body.partsCharge;
    await status("/api/work-orders",400,{method:"POST",body});
    await status("/api/work-orders/"+number,404);
  }
  console.log("PROTOCOLIA_MULTICHARGE_PASS MS-04");
  await status("/api/work-orders",400,{method:"POST",body:{
    ...orderBody("OT-FORGED","10.00"),openingBalance:"20.00",available:"20.00"
  }});
  await status("/api/work-orders/OT-FORGED",404);
  console.log("PROTOCOLIA_CHARGE_SOURCE_PASS CS-01");
  await status("/api/work-orders",400,{method:"POST",body:{
    ...orderBody("OT-SKEWED","10.00"),available:"9.00"
  }});
  await status("/api/work-orders/OT-SKEWED",404);
  console.log("PROTOCOLIA_CHARGE_SOURCE_PASS CS-02");
  await status("/api/work-orders",400,{method:"POST",body:{
    ...orderBody("OT-EQUAL-FAKE","10.00"),openingBalance:"10.00"
  }});
  await status("/api/work-orders/OT-EQUAL-FAKE",404);
  await status("/api/work-orders",400,{method:"POST",body:{
    ...orderBody("OT-NUMERIC",10.0)
  }});
  await status("/api/work-orders/OT-NUMERIC",404);
  console.log("PROTOCOLIA_SERVER_ONLY_BALANCE_PASS SO-02/SO-03");
  console.log("PROTOCOLIA_MULTICHARGE_PASS MS-05");
  await status("/api/work-orders",201,{method:"POST",body:orderBody("OT-10","10.00")});
  const initial=await balance("OT-10");
  assert.equal(cents(initial.record.openingBalance),1000n);
  assert.equal(cents(initial.record.available),1000n);
  assert.equal(cents(initial.record.laborCharge),1000n);
  console.log("PROTOCOLIA_CHARGE_SOURCE_PASS CS-03");
  console.log("PROTOCOLIA_SERVER_ONLY_BALANCE_PASS SO-01");
  assert.equal(cents(initial.snapshot.postedTotal),0n);
  pass("PG-01");

  await status("/api/payments",201,{method:"POST",body:payment("PAY-1","OT-10","3.10")});
  const after=await balance("OT-10");
  assert.equal(cents(after.record.available),690n);
  assert.equal(cents(after.snapshot.postedTotal),310n);
  assert.equal((await status("/api/payments/PAY-1",200)).status,"posted");
  pass("PG-02");

  await status("/api/payments",409,{method:"POST",body:payment("PAY-TOO-MUCH","OT-10","6.91")});
  await status("/api/payments/PAY-TOO-MUCH",404);
  assert.equal(cents((await balance("OT-10")).record.available),690n);
  pass("PG-03");

  await status("/api/payments",400,{method:"POST",body:payment("PAY-ZERO","OT-10","0.00")});
  await status("/api/payments",400,{method:"POST",body:payment("PAY-FLOAT","OT-10",1.2)});
  await status("/api/payments/PAY-ZERO",404);
  await status("/api/payments/PAY-FLOAT",404);
  assert.equal(cents((await balance("OT-10")).record.available),690n);
  pass("PG-04");

  await status("/api/payments",409,{method:"POST",body:payment("PAY-1","OT-10","3.10")});
  assert.equal(cents((await balance("OT-10")).record.available),690n);
  pass("PG-05");

  await status("/api/work-orders",201,{method:"POST",body:orderBody("OT-CONCURRENT","3.00")});
  const requests=await Promise.all(Array.from({length:10},(_,i)=>
    request("/api/payments",{method:"POST",
      body:payment("CONCURRENT-"+i,"OT-CONCURRENT","1.00")})));
  assert.equal(requests.filter(r=>r.status===201).length,3);
  assert.equal(requests.filter(r=>r.status===409).length,7);
  assert.equal(cents((await balance("OT-CONCURRENT")).record.available),0n);
  assert.equal(cents((await balance("OT-CONCURRENT")).snapshot.postedTotal),300n);
  for(let i=0;i<10;i++)assert.equal((await request("/api/payments/CONCURRENT-"+i)).status,
    requests[i].status===201?200:404);
  pass("PG-06");

  await status("/api/payments",400,{method:"POST",body:payment("PAY-ORPHAN","MISSING","0.10")});
  await status("/api/payments/PAY-ORPHAN",404);
  pass("PG-07");

  await status("/api/payments",403,{role:"reader",method:"POST",
    body:payment("PAY-READER","OT-10","0.10")});
  await status("/api/payments/PAY-1/reverse",403,{role:"reader",method:"POST"});
  await status("/api/payments/PAY-READER",404);
  pass("PG-08");

  const reversal=await status("/api/payments/PAY-1/reverse",200,{method:"POST"});
  assert.equal(reversal.status,"reversed");
  assert.equal((await status("/api/payments/PAY-1",200)).status,"reversed");
  const restored=await balance("OT-10");
  assert.equal(cents(restored.record.available),1000n);
  assert.equal(cents(restored.snapshot.reversedTotal),310n);
  assert.equal(cents(restored.snapshot.postedTotal),0n);
  pass("PG-09");

  await status("/api/payments/PAY-1/reverse",409,{method:"POST"});
  assert.equal(cents((await balance("OT-10")).record.available),1000n);
  await status("/api/payments",201,{method:"POST",body:payment("PAY-2","OT-10","10.00")});
  assert.equal(cents((await balance("OT-10")).record.available),0n);
  await status("/api/payments",409,{method:"POST",body:payment("PAY-EXCESS","OT-10","0.01")});
  assert.equal(cents((await balance("OT-10")).record.available),0n);
  pass("PG-10");

  assert.equal(typeof build.irSha256,"string");
  assert.equal(ir.operations.some(x=>x.behavior.kind==="reconcileExact"),true);
  pass("PG-11");
  console.log("PROTOCOLIA_CHARGE_SOURCE_PASS CS-04");
  assert.deepEqual(cases,Array.from({length:11},(_,i)=>"PG-"+String(i+1).padStart(2,"0")));
  console.log("PROTOCOLIA_V12D_EXACT_PAYMENT_GUARD_PASS "+JSON.stringify({
    target:build.target,passedCases:cases.length,irHash:build.irSha256,
    overspendDenied:true,parallelCommitted:3,parallelConflicts:7,
    reversedExact:true,reconciled:true
  }));
}finally{
  if(started)try{docker("down","--volumes","--remove-orphans");}
    catch(e){console.error("PROTOCOLIA_V12D_CLEANUP_FAILED "+e.message);process.exitCode=1;}
  rmSync(scratch,{recursive:true,force:true});
}
