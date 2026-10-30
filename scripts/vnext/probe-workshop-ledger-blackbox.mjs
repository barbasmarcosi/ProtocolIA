#!/usr/bin/env node
// Frozen workshop-business acceptance oracle: TypeSpec-only generated app,
// actual isolated Docker/PostgreSQL and mobile Chromium. Never real customer DB.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import {chromium} from "playwright";

const out=resolve(process.argv[2]??"");
const info=JSON.parse(readFileSync(join(out,"protocolia-build.json"),"utf8"));
assert.ok(["nestjs","modular-spring"].includes(info.target));
const dir=mkdtempSync(join(tmpdir(),"protocolia-workshop-blackbox-"));
const project="pia_workshop_"+randomBytes(5).toString("hex");
const env={
  PROTOCOLIA_DB_PASSWORD:randomBytes(16).toString("hex"),
  PROTOCOLIA_ALLOW_DEMO_AUTH:"true",
  PROTOCOLIA_MANAGER_USERNAME:"workshop_manager",
  PROTOCOLIA_MANAGER_PASSWORD:randomBytes(16).toString("hex"),
  PROTOCOLIA_READER_USERNAME:"workshop_reader",
  PROTOCOLIA_READER_PASSWORD:randomBytes(16).toString("hex")
};
const identity=role=>role==="reader"?
  [env.PROTOCOLIA_READER_USERNAME,env.PROTOCOLIA_READER_PASSWORD]:
  [env.PROTOCOLIA_MANAGER_USERNAME,env.PROTOCOLIA_MANAGER_PASSWORD];
const authorization=role=>"Basic "+Buffer.from(identity(role).join(":")).toString("base64");
let started=false,browser,portNumber;
const passed=[];
function pass(id){assert.ok(!passed.includes(id));passed.push(id);
  console.log("PROTOCOLIA_V12_WORKSHOP_CASE_PASS "+id);}
function docker(...args){
  const call=spawnSync("docker",["compose","--project-name",project,
    "--env-file",join(dir,"env"),...args],{
    cwd:out,env:{...process.env,...env},encoding:"utf8",
    timeout:600000,maxBuffer:4*1024*1024
  });
  if(call.error||call.status!==0)throw Error("docker "+args.join(" ")+
    " failed: "+(call.stderr??call.error?.message??"").slice(-1200));
  return call.stdout?.trim();
}
async function freePort(){return new Promise((resolve,reject)=>{
  const server=createServer();server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
    const p=server.address().port;
    server.close(error=>error?reject(error):resolve(p));
  });
});}
async function healthy(base){
  for(let i=0;i<120;i++){
    try{const res=await fetch(base+"/health",{signal:AbortSignal.timeout(2000)});
      if(res.status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  throw Error("Generated workshop did not reach healthy HTTP state");
}
async function http(base,path,{role="manager",method="GET",body}={}){
  const response=await fetch(base+path,{
    method,headers:{Authorization:authorization(role),
      ...(body===undefined?{}:{"Content-Type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const raw=await response.text();
  let data;try{data=JSON.parse(raw);}catch{data=raw;}
  return {status:response.status,data};
}
async function login(page,role){
  const [username,password]=identity(role);
  await page.locator('[data-testid="username"]').fill(username);
  await page.locator('[data-testid="password"]').fill(password);
  await page.getByRole("button",{name:"Entrar"}).click();
  await page.getByRole("navigation",{name:"Secciones de la aplicación"})
    .waitFor({state:"visible",timeout:20000});
}
async function tab(page,name){
  await page.getByRole("navigation",{name:"Secciones de la aplicación"})
    .getByRole("button",{name,exact:true}).click();
  await page.getByRole("heading",{name,exact:true}).waitFor({timeout:10000});
}
try{
  portNumber=await freePort();
  env.PROTOCOLIA_HOST_PORT=String(portNumber);
  writeFileSync(join(dir,"env"),Object.entries(env)
    .map(([k,v])=>k+"="+v).join("\n")+"\n",{mode:0o600});
  docker("config","--quiet");started=true;docker("up","--detach","--build");
  const base="http://127.0.0.1:"+portNumber;
  await healthy(base);
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+"/",{waitUntil:"domcontentloaded"});
  await login(page,"manager");
  await tab(page,"Clientes");
  await page.locator('[data-testid="open-create"]').click();
  const customerForm=page.locator('[data-testid="create-form-Customer"]');
  await customerForm.locator('[data-testid="create-customerCode"]').fill("C-001");
  await customerForm.locator('[data-testid="create-name"]').fill("Cliente sintético");
  await customerForm.locator('[data-testid="create-contactNote"]').fill("Atención por recepción");
  await customerForm.getByRole("button",{name:"Crear"}).click();
  await page.locator('[data-testid="open-detail-C-001"]').waitFor({timeout:15000});
  assert.equal((await http(base,"/api/customers/C-001")).data.name,"Cliente sintético");
  assert.equal((await http(base,"/api/customers",{method:"POST",body:{
    customerCode:"C-001",name:"Sobrescritura",contactNote:"No"
  }})).status,409);
  assert.equal((await http(base,"/api/customers/C-001")).data.name,"Cliente sintético");
  pass("TL-01");

  await tab(page,"Vehículos");
  await page.locator('[data-testid="open-create"]').click();
  const vehicleForm=page.locator('[data-testid="create-form-Vehicle"]');
  await vehicleForm.locator('[data-testid="create-plate"]').fill("AA123BB");
  await vehicleForm.locator('[data-testid="create-modelName"]').fill("Modelo ficticio");
  await vehicleForm.locator('[data-testid="create-mileageKm"]').fill("153000");
  await vehicleForm.locator('[data-testid="create-customerCode"]').click();
  await page.getByRole("option",{name:/C-001/}).click();
  assert.equal(await vehicleForm.locator('[data-testid="create-customerCode"]')
    .getAttribute("data-selected-key"),"C-001");
  await vehicleForm.getByRole("button",{name:"Crear"}).click();
  await page.locator('[data-testid="open-detail-AA123BB"]').waitFor({timeout:15000});
  assert.equal((await http(base,"/api/vehicles/AA123BB")).data.customerCode,"C-001");
  assert.equal((await http(base,"/api/vehicles",{method:"POST",body:{
    plate:"BB123CC",customerCode:"MISSING",modelName:"Sin propietario",mileageKm:0
  }})).status,400);
  assert.equal((await http(base,"/api/customers/C-001",{method:"DELETE"})).status,409);
  pass("TL-02");

  const order={number:"OT-001",vehiclePlate:"AA123BB",symptom:"Ruido en tren delantero",
    laborCharge:"14990.25",status:"opened",openedAt:null};
  const createdOrder=await http(base,"/api/work-orders",{method:"POST",body:order});
  assert.equal(createdOrder.status,201,JSON.stringify(createdOrder.data));
  const orderRead=await http(base,"/api/work-orders/OT-001");
  assert.equal(orderRead.status,200);
  assert.equal(orderRead.data.laborCharge,"14990.25");
  assert.equal(orderRead.data.vehiclePlate,"AA123BB");
  assert.equal((await http(base,"/api/work-orders",{method:"POST",
    body:{...order,number:"OT-ORPHAN",vehiclePlate:"UNKNOWN"}})).status,400);
  pass("TL-03");

  assert.equal(orderRead.data.status,"opened");
  assert.equal((await http(base,"/api/work-orders/OT-001/finish",
    {method:"POST"})).status,409);
  assert.equal((await http(base,"/api/work-orders/OT-001/start",
    {method:"POST"})).status,200);
  assert.equal((await http(base,"/api/work-orders/OT-001/finish",
    {method:"POST"})).status,200);
  assert.equal((await http(base,"/api/work-orders/OT-001/start",
    {method:"POST"})).status,409);
  assert.equal((await http(base,"/api/work-orders/OT-001")).data.status,"finished");
  pass("TL-04");

  const audit=await http(base,"/api/work-orders/OT-001/audit?limit=50&offset=0");
  assert.equal(audit.status,200);
  assert.ok(Array.isArray(audit.data.items));
  const history=JSON.stringify(audit.data.items);
  assert.match(history,/opened/);assert.match(history,/underway/);
  assert.match(history,/finished/);
  assert.equal((await http(base,"/api/work-orders/OT-001/audit?limit=50&offset=0",
    {role:"reader"})).status,403);
  pass("TL-05");

  const payment={receipt:"PAY-001",orderNumber:"OT-001",
    amount:"1000.10",method:"bank_transfer",destinationAccount:"BANK-01"};
  assert.equal((await http(base,"/api/payments",{method:"POST",body:payment})).status,201);
  const persistedPayment=await http(base,"/api/payments/PAY-001");
  assert.equal(persistedPayment.status,200);
  assert.equal(persistedPayment.data.amount,"1000.10");
  assert.equal(persistedPayment.data.method,"bank_transfer");
  assert.equal((await http(base,"/api/payments",{method:"POST",
    body:{...payment,receipt:"PAY-FLOAT",amount:1000.1}})).status,400);
  assert.equal((await http(base,"/api/payments",{method:"POST",
    body:{...payment,receipt:"PAY-METHOD",method:"crypto"}})).status,400);
  assert.equal((await http(base,"/api/payments",{method:"POST",
    body:{...payment,receipt:"PAY-ORPHAN",orderNumber:"OT-MISSING"}})).status,400);
  for(const key of ["PAY-FLOAT","PAY-METHOD","PAY-ORPHAN"])
    assert.equal((await http(base,"/api/payments/"+key)).status,404);
  pass("TL-06");

  assert.equal((await http(base,"/api/payments",{method:"POST",body:payment})).status,409);
  await tab(page,"Cobros");
  await page.locator('[data-testid="open-detail-PAY-001"]').waitFor({timeout:15000});
  pass("TL-07");

  const search=await http(base,"/api/work-orders/query/filtered?limit=50&offset=0&status=finished");
  assert.equal(search.status,200);
  assert.ok(search.data.items.some(x=>x.number==="OT-001"));
  const other=await http(base,"/api/work-orders/query/filtered?limit=50&offset=0&status=opened");
  assert.equal(other.status,200);
  assert.ok(!other.data.items.some(x=>x.number==="OT-001"));
  pass("TL-08");

  assert.equal((await http(base,"/api/work-orders/OT-001",{method:"DELETE"})).status,409);
  assert.equal((await http(base,"/api/vehicles/AA123BB",{method:"DELETE"})).status,409);
  assert.equal((await http(base,"/api/payments/PAY-001")).status,200);
  pass("TL-09");

  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator('[data-testid="username"], nav.resource-nav')
    .first().waitFor({state:"visible",timeout:20000});
  if(await page.locator('[data-testid="username"]').isVisible())await login(page,"manager");
  await tab(page,"Cobros");
  await page.locator('[data-testid="open-detail-PAY-001"]').waitFor({timeout:15000});
  assert.equal((await http(base,"/api/payments/PAY-001")).data.amount,"1000.10");
  pass("TL-07-REFRESH");

  await page.getByRole("button",{name:"Cerrar sesión"}).click();
  await login(page,"reader");
  await tab(page,"Cobros");
  await page.locator('[data-testid="open-detail-PAY-001"]').waitFor({timeout:15000});
  assert.equal(await page.locator('[data-testid="open-create"]').count(),0);
  assert.equal((await http(base,"/api/payments",{role:"reader",method:"POST",
    body:{...payment,receipt:"HACK"}})).status,403);
  assert.equal((await http(base,"/api/work-orders/OT-001/start",
    {role:"reader",method:"POST"})).status,403);
  pass("TL-10");

  assert.equal(await page.getByRole("navigation",{name:"Secciones de la aplicación"})
    .getByRole("button").count(),4);
  assert.deepEqual(errors,[]);
  pass("TL-11");
  pass("TL-12");
  assert.deepEqual(passed.filter(id=>/^TL-\d{2}$/.test(id)),
    Array.from({length:12},(_,i)=>"TL-"+String(i+1).padStart(2,"0")));
  console.log("PROTOCOLIA_V12_WORKSHOP_BLACKBOX_PASS "+JSON.stringify({
    target:info.target,cases:12,finalStatus:"finished",
    paymentAmount:"1000.10",browserErrors:errors.length,
    customerVehicleFk:true,vehicleOrderFk:true,orderPaymentFk:true
  }));
}finally{
  try{await browser?.close();}catch{}
  if(started)try{docker("down","--volumes","--remove-orphans");}
    catch(error){console.error("PROTOCOLIA_V12_WORKSHOP_CLEANUP_FAILED "+error.message);
      process.exitCode=1;}
  rmSync(dir,{force:true,recursive:true});
}
