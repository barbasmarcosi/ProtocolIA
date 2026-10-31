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
assert.deepEqual(ir.entities.map(e=>e.name).sort(),["ChargeLine","Customer","Payment","Vehicle","WorkOrder"]);
const post=ir.operations.find(x=>x.entity==="Payment"&&x.behavior.kind==="create");
const reversed=ir.operations.find(x=>x.entity==="Payment"&&x.behavior.kind==="transition");
const recon=ir.operations.find(x=>x.entity==="WorkOrder"&&x.behavior.kind==="reconcileExact");
assert.deepEqual(post?.behavior.debitExact,{
  stockEntity:"WorkOrder",availableField:"available",referenceField:"orderNumber",quantityField:"amount"
});
assert.deepEqual(reversed?.behavior.reverseExact,post.behavior.debitExact);
assert.ok(recon?.behavior.reconcileExact);
assert.equal(recon.behavior.reconcileExact.chargeSource,"chargeTotal");
assert.equal(recon.behavior.reconcileExact.lifecycle,true);
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

const charge=(lineId,amount,kind="labor")=>({lineId,kind,
  description:"Cargo sintético "+lineId,amount});
const order=(number,charges)=>({
  number,vehiclePlate:"AA123BB",symptom:"Orden sintética sin datos personales",
  charges,openedAt:null
});
const pay=(receipt,orderNumber,amount)=>({
  receipt,orderNumber,amount,method:"cash",destinationAccount:"Caja sintética"
});
async function balance(number){
  const record=await status("/api/work-orders/"+number,200);
  const snapshot=await status("/api/work-orders/"+number+"/reconciliation",200);
  assert.equal(snapshot.balanced,true,"Ledger must balance at every accepted mutation");
  assert.equal(cents(snapshot.difference),0n);
  assert.equal(cents(record.available),cents(snapshot.available));
  return {record,snapshot};
}
async function browserSmoke(){
  if(process.env.PROTOCOLIA_BROWSER_VERIFY!=="true")return;
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(base+"/",{waitUntil:"domcontentloaded"});
    await page.getByTestId("username").fill(env.PROTOCOLIA_MANAGER_USERNAME);
    await page.getByTestId("password").fill(env.PROTOCOLIA_MANAGER_PASSWORD);
    await page.getByRole("button",{name:"Entrar"}).click();
    const nav=page.getByRole("navigation",{name:"Secciones de la aplicación"});
    await nav.waitFor({timeout:30000});
    await nav.getByRole("button",{name:"Órdenes de trabajo",exact:true}).click();
    await page.getByTestId("open-create").click();
    const form=page.getByTestId("create-form-WorkOrder");
    await form.waitFor({timeout:20000});
    for(const field of ["openingBalance","available","chargeTotal"])
      assert.equal(await form.getByTestId("create-"+field).count(),0,
        "No client-authoritative money: "+field);
    await form.getByTestId("dynamic-detail-editor").waitFor();
    const rows=page.getByTestId("detail-row-0");
    assert.equal(await rows.count(),1);
    await page.getByTestId("add-detail-row").click();
    assert.equal(await page.getByTestId("detail-row-1").count(),1);
    assert.deepEqual(errors,[],"Generated mobile UI must have zero JS exceptions");
    console.log("PROTOCOLIA_S2B_ITEMIZED_MOBILE_PASS");
  }finally{await browser.close();}
}
let started=false;
try{
  const port=await freePort();env.PROTOCOLIA_HOST_PORT=String(port);
  writeFileSync(join(scratch,"env"),
    Object.entries(env).map(([k,v])=>k+"="+v).join("\n")+"\n",{mode:0o600});
  docker("config","--quiet");
  started=true;docker("up","--detach","--build");
  base="http://127.0.0.1:"+port;await ready(base);
  await status("/api/customers",201,{method:"POST",body:{
    customerCode:"C-001",name:"Cliente de prueba",contactNote:"Sin PII"
  }});
  await status("/api/vehicles",201,{method:"POST",body:{
    plate:"AA123BB",customerCode:"C-001",modelName:"Modelo sintético",mileageKm:0
  }});
  await browserSmoke();
  const orderA=order("OT-EXACT",[
    charge("L-001","0.10","labor"),charge("P-001","0.20","parts")
  ]);
  await status("/api/work-orders",201,{method:"POST",body:orderA});
  const baseline=await balance("OT-EXACT");
  for(const field of ["openingBalance","available","chargeTotal"])
    assert.equal(cents(baseline.record[field]),30n,field+" must equal exact line sum");
  assert.equal(baseline.snapshot.coverageState,"unpaid");
  assert.equal(cents((await status("/api/charge-lines/L-001",200)).amount),10n);
  assert.equal(cents((await status("/api/charge-lines/P-001",200)).amount),20n);
  console.log("PROTOCOLIA_S2B_ITEMIZED_PASS S2B-01 exact atomic 0.10 + 0.20");

  const forged={...order("OT-FORGED",[charge("F-1","1.00")]),chargeTotal:"999.00"};
  await status("/api/work-orders",400,{method:"POST",body:forged});
  await status("/api/work-orders/OT-FORGED",404);
  await status("/api/work-orders",400,{method:"POST",
    body:{...order("OT-OPEN",[charge("OPEN-1","1.00")]),openingBalance:"1.00"}});
  await status("/api/work-orders/OT-OPEN",404);
  console.log("PROTOCOLIA_S2B_ITEMIZED_PASS S2B-02 forged scalar denial");

  const bad=[
    ["OT-EMPTY",[] ,400],
    ["OT-NEG",[charge("NEG-1","-0.01")],400],
    ["OT-WIRE",[charge("WIRE-1",0.2)],400],
    ["OT-NULL",[charge("NULL-1",null)],400],
    ["OT-EXTRA",[{...charge("EXTRA-1","1.00"),unauthorized:"x"}],400],
    ["OT-INJECT",[{...charge("INJECT-1","1.00"),orderNumber:"OT-EXACT"}],400],
    ["OT-OVERFLOW",[charge("OVER-1","999999999999.99"),charge("OVER-2","0.01")],400],
    ["OT-DUP",[charge("DUP-1","1.00"),charge("DUP-1","1.00")],409]
  ];
  for(const [number,lines,code] of bad){
    await status("/api/work-orders",code,{method:"POST",body:order(number,lines)});
    await status("/api/work-orders/"+number,404);
  }
  const twenty=Array.from({length:20},(_,i)=>
    charge("TWENTY-"+i,"0.01",i%2?"parts":"labor"));
  await status("/api/work-orders",201,{method:"POST",body:order("OT-TWENTY",twenty)});
  assert.equal(cents((await balance("OT-TWENTY")).record.chargeTotal),20n);
  await status("/api/work-orders",400,{method:"POST",body:order("OT-21",[
    ...twenty.map((x,i)=>({...x,lineId:"MANY-"+i})),charge("MANY-20","0.01")
  ])});
  await status("/api/work-orders/OT-21",404);
  console.log("PROTOCOLIA_S2B_ITEMIZED_PASS S2B-03 bounds, rollback and duplicate PK");

  await status("/api/charge-lines",409,{method:"POST",body:{
    ...charge("EVIL-1","5.00"),orderNumber:"OT-EXACT"
  }});
  await status("/api/charge-lines/EVIL-1",404);
  await status("/api/charge-lines",403,{method:"POST",role:"reader",body:{
    ...charge("EVIL-2","5.00"),orderNumber:"OT-EXACT"
  }});
  assert.equal(cents((await balance("OT-EXACT")).record.chargeTotal),30n);
  console.log("PROTOCOLIA_S2B_ITEMIZED_PASS S2B-04 direct charge mutation denied");

  const stored=docker("exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT COALESCE(SUM(amount),0)::text FROM charge_line WHERE order_number='OT-EXACT'");
  assert.equal(cents(stored),30n,"Persisted child rows are authoritative");
  await status("/api/work-orders",201,{method:"POST",body:order("OT-CONCURRENT",[
    charge("CON-1","3.00")
  ])});
  const attempts=await Promise.all(Array.from({length:10},(_,i)=>
    request("/api/payments",{method:"POST",body:pay("P-CON-"+i,"OT-CONCURRENT","1.00")})));
  assert.equal(attempts.filter(x=>x.status===201).length,3);
  assert.equal(attempts.filter(x=>x.status===409).length,7);
  const covered=await balance("OT-CONCURRENT");
  assert.equal(covered.snapshot.coverageState,"covered");
  const winning=attempts.findIndex(x=>x.status===201);
  await status("/api/payments/P-CON-"+winning+"/reverse",200,{method:"POST"});
  await status("/api/payments/P-CON-"+winning+"/reverse",409,{method:"POST"});
  const partial=await balance("OT-CONCURRENT");
  assert.equal(partial.snapshot.coverageState,"partial");
  assert.equal(cents(partial.record.available),100n);
  console.log("PROTOCOLIA_S2B_ITEMIZED_PASS S2B-05 concurrent receipts and reversal");
  console.log("PROTOCOLIA_S2B_ITEMIZED_ALL_PASS "+build.target);
}finally{
  if(started)try{docker("down","--volumes","--remove-orphans");}
    catch(e){console.error("PROTOCOLIA_S2B_CLEANUP_FAILED "+e.message);process.exitCode=1;}
  rmSync(scratch,{recursive:true,force:true});
}
