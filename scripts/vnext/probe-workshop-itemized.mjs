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
const sql=statement=>docker("exec","-T","db","psql","-v","ON_ERROR_STOP=1",
    "-U","protocolia","-d","protocolia","-Atc",statement);
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
async function previewMobileSmoke(){
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
    await page.getByTestId("open-detail-OT-EXACT").waitFor({timeout:15000});
    await page.getByTestId("open-detail-OT-EXACT").click();
    await page.getByTestId("exact-adjustment-preview").waitFor({timeout:15000});
    assert.equal(await page.getByTestId("max-safe-decrease").textContent(),"0.30");
    assert.equal(await page.getByTestId("max-safe-increase").textContent(),"999999999999.69");
    await page.getByTestId("detail-dialog").getByRole("button",{name:"Cerrar detalle"}).click();
    await page.getByTestId("open-detail-OT-UI-ADJUST").click();
    await page.getByTestId("exact-adjustment-composer").waitFor({timeout:15000});
    await page.getByTestId("exact-adjustment-toggle").click();
    const form=page.getByTestId("exact-adjustment-form");
    await form.getByTestId("exact-adjustment-direction").selectOption("increase");
    await form.getByTestId("exact-adjustment-amount").fill("0.05");
    await form.getByTestId("exact-adjustment-reason").fill(
      "Corrección autorizada y aprobada en navegador móvil");
    const original=await status("/api/work-orders/OT-UI-ADJUST",200);
    assert.equal(cents(original.chargeTotal),100n);
    assert.equal(await page.getByTestId("exact-adjustment-confirm").count(),0,
      "A financial write is never shown as an initial one-click button");
    await form.getByTestId("exact-adjustment-review").click();
    await page.getByTestId("exact-adjustment-confirmation").waitFor({timeout:15000});
    assert.equal(await page.getByTestId("exact-adjustment-after").textContent(),"1.05");
    assert.equal(cents((await status("/api/work-orders/OT-UI-ADJUST",200)).chargeTotal),100n,
      "Preview and explicit review must not mutate the ledger");
    const width=await page.getByTestId("exact-adjustment-confirmation").evaluate(
      el=>({right:el.getBoundingClientRect().right,
        viewport:document.documentElement.clientWidth}));
    assert.ok(width.right<=width.viewport+1,"Mobile correction confirmation must not overflow viewport");
    const [write]=await Promise.all([
      page.waitForResponse(response=>
        response.url().includes("/api/work-orders/OT-UI-ADJUST/adjustments")&&
        response.request().method()==="POST",{timeout:20000}),
      page.getByTestId("exact-adjustment-confirm").click()
    ]);
    assert.equal(write.status(),201,
      "Generated UI must send one authorized adjustment POST: "+await write.text());
    const changed=await status("/api/work-orders/OT-UI-ADJUST",200);
    assert.equal(cents(changed.chargeTotal),105n);
    assert.equal(cents(changed.available),105n);
    assert.equal((await balance("OT-UI-ADJUST")).snapshot.balanced,true);
    await page.getByTestId("exact-adjustment-toggle").click();
    const nextForm=page.getByTestId("exact-adjustment-form");
    await nextForm.getByTestId("exact-adjustment-direction").selectOption("increase");
    await nextForm.getByTestId("exact-adjustment-amount").fill("0.02");
    await nextForm.getByTestId("exact-adjustment-reason").fill(
      "Segunda corrección revisada antes de un cambio concurrente");
    await nextForm.getByTestId("exact-adjustment-review").click();
    await page.getByTestId("exact-adjustment-confirmation").waitFor({timeout:15000});
    assert.equal(await page.getByTestId("exact-adjustment-after").textContent(),"1.07");
    const live=(await balance("OT-UI-ADJUST")).snapshot;
    const concurrent=await request("/api/work-orders/OT-UI-ADJUST/adjustments",{
      method:"POST",body:{adjustmentId:"UI-OTHER-01",delta:"0.01",
        reason:"Cambio concurrente de otra sesión autorizada",
        expectedOpening:live.openingBalance,expectedAvailable:live.available,
        expectedPostingCount:live.postingCount,expectedReversedTotal:live.reversedTotal,
        expectedAdjustmentCount:live.adjustmentCount}
    });
    assert.equal(concurrent.status,201,JSON.stringify(concurrent.data));
    const journalBefore=sql("SELECT COUNT(*) FROM protocolia_exact_adjustment_work_order "+
      "WHERE parent_id='OT-UI-ADJUST'");
    const [staleWrite]=await Promise.all([
      page.waitForResponse(response=>response.url().includes(
        "/api/work-orders/OT-UI-ADJUST/adjustments")&&
        response.request().method()==="POST",{timeout:20000}),
      page.getByTestId("exact-adjustment-confirm").click()
    ]);
    assert.equal(staleWrite.status(),409,"Stale mobile approval must fail closed");
    await page.getByTestId("exact-adjustment-refresh-required").waitFor({timeout:10000});
    assert.equal(sql("SELECT COUNT(*) FROM protocolia_exact_adjustment_work_order "+
      "WHERE parent_id='OT-UI-ADJUST'"),journalBefore);
    await page.getByTestId("exact-adjustment-recover").click();
    await page.getByTestId("exact-adjustment-composer").waitFor({timeout:15000});
    await page.getByTestId("exact-adjustment-toggle").click();
    await page.getByTestId("exact-adjustment-form").waitFor({timeout:15000});
    assert.equal(await page.getByTestId("exact-adjustment-amount").inputValue(),"",
      "Recovery must require fresh human review rather than replaying the stale amount");
    const staleId=staleWrite.request().postDataJSON().adjustmentId;
    const freshForm=page.getByTestId("exact-adjustment-form");
    await freshForm.getByTestId("exact-adjustment-direction").selectOption("increase");
    await freshForm.getByTestId("exact-adjustment-amount").fill("0.02");
    await freshForm.getByTestId("exact-adjustment-reason").fill(
      "Nueva revisión humana después del conflicto concurrente");
    await freshForm.getByTestId("exact-adjustment-review").click();
    await page.getByTestId("exact-adjustment-confirmation").waitFor({timeout:15000});
    assert.equal(await page.getByTestId("exact-adjustment-after").textContent(),"1.08");
    const [freshWrite]=await Promise.all([
      page.waitForResponse(response=>response.url().includes(
        "/api/work-orders/OT-UI-ADJUST/adjustments")&&
        response.request().method()==="POST",{timeout:20000}),
      page.getByTestId("exact-adjustment-confirm").click()
    ]);
    assert.equal(freshWrite.request().postDataJSON().adjustmentId,staleId,
      "Unknown or rejected result must preserve the idempotency key");
    assert.equal(freshWrite.status(),201);
    assert.equal(cents((await balance("OT-UI-ADJUST")).record.chargeTotal),108n);
    // Simulate a server-side COMMIT whose HTTP response is lost in transit.
    // The client must consult the immutable journal rather than POST again.
    await page.getByTestId("exact-adjustment-toggle").click();
    const lostForm=page.getByTestId("exact-adjustment-form");
    await lostForm.getByTestId("exact-adjustment-direction").selectOption("increase");
    await lostForm.getByTestId("exact-adjustment-amount").fill("0.03");
    await lostForm.getByTestId("exact-adjustment-reason").fill(
      "Confirmación registrada con respuesta HTTP perdida");
    await lostForm.getByTestId("exact-adjustment-review").click();
    await page.getByTestId("exact-adjustment-confirmation").waitFor({timeout:15000});
    let lostWriteStatus=null,lostWriteId=null;
    const lostRoute="**/api/work-orders/OT-UI-ADJUST/adjustments";
    await page.route(lostRoute,async route=>{
      if(route.request().method()!=="POST"){await route.continue();return;}
      lostWriteId=route.request().postDataJSON().adjustmentId;
      const upstream=await route.fetch();
      lostWriteStatus=upstream.status();
      await route.abort("failed");
    });
    await page.getByTestId("exact-adjustment-confirm").click();
    await page.getByTestId("exact-adjustment-refresh-required").waitFor({timeout:15000});
    await page.unroute(lostRoute);
    assert.equal(lostWriteStatus,201,"Synthetic response loss must occur AFTER real commit");
    assert.equal(cents((await balance("OT-UI-ADJUST")).record.chargeTotal),111n);
    const journalBeforeRecovery=sql("SELECT COUNT(*) FROM protocolia_exact_adjustment_work_order "+
      "WHERE parent_id='OT-UI-ADJUST'");
    const [lookupResponse]=await Promise.all([
      page.waitForResponse(r=>r.url().includes(
        "/api/work-orders/OT-UI-ADJUST/adjustments/"+lostWriteId)&&
        r.request().method()==="GET",{timeout:20000}),
      page.getByTestId("exact-adjustment-check-outcome").click()
    ]);
    assert.equal(lookupResponse.status(),200);
    await page.getByTestId("exact-adjustment-outcome-committed").waitFor({timeout:10000});
    assert.equal(sql("SELECT COUNT(*) FROM protocolia_exact_adjustment_work_order "+
      "WHERE parent_id='OT-UI-ADJUST'"),journalBeforeRecovery,
      "Outcome recovery must never issue another correction");
    console.log("PROTOCOLIA_S2C1B5_MOBILE_LOST_RESPONSE_PASS "+build.target);
    console.log("PROTOCOLIA_S2C1B3_MOBILE_CAS_PASS "+build.target);
    assert.deepEqual(errors,[],"Generated mobile correction must have no JS exceptions");
    console.log("PROTOCOLIA_S2C1B2_MOBILE_ADJUST_PASS "+build.target);
    assert.deepEqual(errors,[],"Generated repricing preview must have zero JS errors");
    console.log("PROTOCOLIA_S2C1A_PREVIEW_MOBILE_PASS "+build.target);
  }finally{await browser.close();}
}
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
  await status("/api/work-orders",201,{method:"POST",body:order("OT-UI-ADJUST",[
    charge("UI-CORRECTION-LINE","1.00")
  ])});
  const baseline=await balance("OT-EXACT");
  for(const field of ["openingBalance","available","chargeTotal"])
    assert.equal(cents(baseline.record[field]),30n,field+" must equal exact line sum");
  assert.equal(baseline.snapshot.coverageState,"unpaid");
  assert.equal(baseline.snapshot.adjustmentPreviewEligible,true);
  assert.equal(cents(baseline.snapshot.maxSafeDecrease),30n);
  assert.equal(cents(baseline.snapshot.maxSafeIncrease),99999999999969n);
  console.log("PROTOCOLIA_S2C1A_PREVIEW_PASS unpaid");
  // A locally posted receipt is never evidence of bank/card clearing.
  // The source of truth for external settlement is intentionally absent.
  await status("/api/work-orders",201,{method:"POST",body:order("OT-PROVIDER-PROOF",[
    charge("PROOF-LABOR","3.00")
  ])});
  const proofBefore=await balance("OT-PROVIDER-PROOF");
  const forged=await request("/api/payments",{method:"POST",body:{
    ...pay("PROOF-FORGE","OT-PROVIDER-PROOF","1.00"),
    method:"card",providerSettlementState:"settled"
  }});
  assert.equal(forged.status,400,"A caller must not claim provider settlement");
  await status("/api/payments/PROOF-FORGE",404);
  await status("/api/payments",400,{method:"POST",body:{
    ...pay("PROOF-FORGE-SAME","OT-PROVIDER-PROOF","1.00"),
    providerSettlementState:"unverified"
  }});
  await status("/api/payments/PROOF-FORGE-SAME",404);
  assert.equal((await balance("OT-PROVIDER-PROOF")).record.available,
    proofBefore.record.available,"Forged provider proof must not debit the ledger");
  for(const method of ["cash","bank_transfer","card"]){
    const receipt="PROOF-"+method.toUpperCase().replace(/_/g,"-");
    const created=await status("/api/payments",201,{method:"POST",body:{
      ...pay(receipt,"OT-PROVIDER-PROOF","1.00"),method
    }});
    assert.equal(created.providerSettlementState,"unverified",
      "Internal receipt must never imply provider verification: "+method);
    assert.equal(created.status,"posted");
    const persisted=await status("/api/payments/"+receipt,200);
    assert.equal(persisted.providerSettlementState,"unverified");
    assert.equal(sql("SELECT provider_settlement_state FROM payment WHERE receipt='"+
      receipt+"'"),"unverified");
  }
  assert.throws(()=>sql("UPDATE payment SET provider_settlement_state='settled' "+
    "WHERE receipt='PROOF-CARD'"),"PostgreSQL must reject forged external proof");
  const proofCovered=await balance("OT-PROVIDER-PROOF");
  assert.equal(proofCovered.snapshot.coverageState,"covered",
    "Coverage is internal ledger coverage, not provider clearing");
  assert.equal(proofCovered.record.available,"0.00");
  const reversedProvider=await status("/api/payments/PROOF-BANK-TRANSFER/reverse",200,
    {method:"POST"});
  assert.equal(reversedProvider.providerSettlementState,"unverified",
    "An internal reversal is not an external refund");
  assert.equal((await balance("OT-PROVIDER-PROOF")).snapshot.coverageState,"partial");
  console.log("PROTOCOLIA_S2C1B6_PROVIDER_PROOF_PASS "+build.target);
  await previewMobileSmoke();
  const audit=await status("/api/work-orders/OT-EXACT/audit",200);
  assert.ok(audit.items.some(row=>row.fieldName==="chargeTotal"&&
    cents(String(row.afterValue).replace(/^"|"$/g,""))===30n),
    "The authoritative exact line sum must be durably audited");
  await status("/api/work-orders",201,{method:"POST",body:
    order("OT-NO-CHARGE",[charge("ZERO-1","0.00")])});
  const zeroSnapshot=(await balance("OT-NO-CHARGE")).snapshot;
  assert.equal(zeroSnapshot.coverageState,"no_charge");
  assert.equal(zeroSnapshot.adjustmentPreviewEligible,true);
  assert.equal(cents(zeroSnapshot.maxSafeDecrease),0n);
  console.log("PROTOCOLIA_S2C1A_PREVIEW_PASS zero_charge");
  console.log("PROTOCOLIA_S2B_ITEMIZED_PASS S2B-06 durable derived-total audit and zero-charge policy");
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
  const full=(await balance("OT-TWENTY"));
  assert.equal(cents(full.record.chargeTotal),20n);
  assert.equal(full.snapshot.adjustmentPreviewEligible,false);
  assert.equal(cents(full.snapshot.maxSafeDecrease),0n);
  assert.equal(cents(full.snapshot.maxSafeIncrease),0n);
  console.log("PROTOCOLIA_S2C1A_PREVIEW_PASS 20_row_limit");
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
  assert.equal(covered.snapshot.adjustmentPreviewEligible,true);
  assert.equal(cents(covered.snapshot.maxSafeDecrease),0n);
  console.log("PROTOCOLIA_S2C1A_PREVIEW_PASS covered");
  const winning=attempts.findIndex(x=>x.status===201);
  await status("/api/payments/P-CON-"+winning+"/reverse",200,{method:"POST"});
  await status("/api/payments/P-CON-"+winning+"/reverse",409,{method:"POST"});
  const partial=await balance("OT-CONCURRENT");
  assert.equal(partial.snapshot.coverageState,"partial");
  assert.equal(cents(partial.record.available),100n);
  assert.equal(partial.snapshot.adjustmentPreviewEligible,true);
  assert.equal(cents(partial.snapshot.maxSafeDecrease),100n);
  console.log("PROTOCOLIA_S2C1A_PREVIEW_PASS partial");
  console.log("PROTOCOLIA_S2B_ITEMIZED_PASS S2B-05 concurrent receipts and reversal");
  // S2c-0: simulate a privileged, out-of-band PostgreSQL source mutation.
  // These are fixed synthetic records in the disposable Compose DB, never production.

  const driftId="OT-SOURCE-DRIFT";
  const driftPath="/api/work-orders/"+driftId+"/reconciliation";
  await status("/api/work-orders",201,{method:"POST",body:order(driftId,[
    charge("DRIFT-L","2.00"),charge("DRIFT-P","1.00","parts")
  ])});
  await status("/api/payments",201,{method:"POST",body:pay("PD-BASE",driftId,"1.00")});
  assert.equal((await balance(driftId)).snapshot.coverageState,"partial");
  const mutations=[
    ["amount","UPDATE charge_line SET amount=2.50 WHERE line_id='DRIFT-L'",
      "UPDATE charge_line SET amount=2.00 WHERE line_id='DRIFT-L'"],
    ["insert","INSERT INTO charge_line (line_id,order_number,kind,description,amount) "+
      "VALUES ('DRIFT-EXTRA','OT-SOURCE-DRIFT','parts','Privileged addition',0.50)",
      "DELETE FROM charge_line WHERE line_id='DRIFT-EXTRA'"],
    ["delete","DELETE FROM charge_line WHERE line_id='DRIFT-P'",
      "INSERT INTO charge_line (line_id,order_number,kind,description,amount) "+
      "VALUES ('DRIFT-P','OT-SOURCE-DRIFT','parts','Cargo sintético DRIFT-P',1.00)"],
    ["parent_total","UPDATE work_order SET charge_total=4.00 WHERE number='OT-SOURCE-DRIFT'",
      "UPDATE work_order SET charge_total=3.00 WHERE number='OT-SOURCE-DRIFT'"],
    ["parent_opening","UPDATE work_order SET opening_balance=4.00 WHERE number='OT-SOURCE-DRIFT'",
      "UPDATE work_order SET opening_balance=3.00 WHERE number='OT-SOURCE-DRIFT'"]
  ];
  for(const [name,mutation,restore] of mutations){
    sql(mutation);
    try{
      const snapshot=await status(driftPath,200);
      assert.equal(snapshot.balanced,false,"Untrusted "+name+" cannot appear reconciled");
      assert.equal(snapshot.coverageState,"inconsistent",name);
      assert.equal(snapshot.adjustmentPreviewEligible,false);
      assert.equal(cents(snapshot.maxSafeDecrease),0n);
      assert.equal(cents(snapshot.maxSafeIncrease),0n);
      // The journal difference can remain zero even with an inconsistent source.
      if(name==="parent_opening")assert.notEqual(snapshot.difference,"0.00");
      else assert.equal(cents(snapshot.difference),0n);
      const denied="PD-DENIED-"+name;
      await status("/api/payments",409,{method:"POST",body:pay(denied,driftId,"0.01")});
      await status("/api/payments/"+denied,404);
      await status("/api/payments/PD-BASE/reverse",409,{method:"POST"});
      assert.equal(sql("SELECT COUNT(*) FROM payment WHERE order_number='OT-SOURCE-DRIFT'"),"1");
      assert.equal(sql("SELECT COUNT(*) FROM protocolia_audit_event WHERE entity_name='Payment' "+
        "AND resource_id='"+denied+"'"),"0");
      assert.equal(cents((await status("/api/work-orders/"+driftId,200)).available),200n);
      console.log("PROTOCOLIA_S2C0_DRIFT_DENIED "+name);
    }finally{sql(restore);}
    const restored=(await balance(driftId)).snapshot;
    assert.equal(restored.coverageState,"partial",
      "Restored source must reconcile again");
    assert.equal(restored.adjustmentPreviewEligible,true);
    assert.equal(cents(restored.maxSafeDecrease),200n);
  }
  await status("/api/payments",201,{method:"POST",body:
    pay("PD-AFTER-RESTORE",driftId,"0.50")});
  assert.equal(cents((await balance(driftId)).record.available),150n);
  await status("/api/payments/PD-BASE/reverse",200,{method:"POST"});
  assert.equal(cents((await balance(driftId)).record.available),250n);
  console.log("PROTOCOLIA_S2C0_DRIFT_ALL_PASS "+build.target);
  // S2c-1b0: actual PostgreSQL-only journal rehearsal. There is deliberately
  // NO adjustment HTTP write route; this isolated SQL validates its future
  // durable constraints and exact snapshot math, not customer authorization.
  const jtable="protocolia_exact_adjustment_work_order";
  const directInsert=(orderNo,id,delta)=>
    "INSERT INTO "+jtable+" (parent_id,adjustment_id,delta,reason,actor) VALUES ("+
    "'"+orderNo+"','"+id+"',"+delta+",'Ajuste firmado de ensayo','fixture_qa')";
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+
    " WHERE parent_id='OT-ADJ-NEG'"),"0");
  await status("/api/work-orders",201,{method:"POST",body:order("OT-ADJ-NEG",[
    charge("J-ORIG-L","2.00"),charge("J-ORIG-P","1.00","parts")
  ])});
  await status("/api/payments",201,{method:"POST",body:
    pay("J-POSTED-1","OT-ADJ-NEG","1.00")});
  sql(directInsert("OT-ADJ-NEG","J-NEG-0001","-0.50"));
  assert.equal((await request("/api/work-orders/OT-ADJ-NEG/adjustments/J-NEG-0001")).status,404,
    "A manager cannot claim another actor's journal row as its lost response");
  const journalDrift=await status("/api/work-orders/OT-ADJ-NEG/reconciliation",200);
  assert.equal(journalDrift.balanced,false);
  assert.equal(journalDrift.coverageState,"inconsistent");
  assert.equal(journalDrift.adjustmentPreviewEligible,false);
  assert.equal(cents(journalDrift.maxSafeDecrease),0n);
  await status("/api/payments",409,{method:"POST",body:
    pay("J-POSTED-DENIED","OT-ADJ-NEG","0.10")});
  await status("/api/payments/J-POSTED-DENIED",404);
  await status("/api/payments/J-POSTED-1/reverse",409,{method:"POST"});
  assert.throws(()=>sql("UPDATE "+jtable+" SET delta=-0.25 "+
    "WHERE parent_id='OT-ADJ-NEG'"),/append-only|Compose/i);
  assert.throws(()=>sql("DELETE FROM "+jtable+
    " WHERE parent_id='OT-ADJ-NEG'"),/append-only|Compose/i);
  assert.throws(()=>sql(directInsert("OT-ADJ-NEG","J-NEG-0001","-0.30")),
    /duplicate|Compose/i);
  assert.throws(()=>sql(directInsert("OT-ADJ-NEG","J-NEG-ZERO","0.00")),
    /check constraint|Compose/i);
  assert.throws(()=>sql(directInsert("OT-JOURNAL-ORPHAN","J-ORPHAN","1.00")),
    /foreign key|Compose/i);
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+
    " WHERE parent_id='OT-ADJ-NEG'"),"1");
  console.log("PROTOCOLIA_S2C1B0_JOURNAL_PASS immutable idempotency and source-drift denial");
  // Test fixture explicitly models the transaction that a future *reviewed*
  // authorized API must atomically execute. It bypasses no generated HTTP gate.
  sql("BEGIN; UPDATE work_order SET charge_total=2.50,"+
    " opening_balance=2.50,available=1.50 WHERE number='OT-ADJ-NEG'; COMMIT;");
  const signed=(await balance("OT-ADJ-NEG")).snapshot;
  assert.equal(signed.balanced,true);
  assert.equal(signed.coverageState,"partial");
  assert.equal(cents(signed.openingBalance),250n);
  assert.equal(cents(signed.available),150n);
  assert.equal(cents(signed.postedTotal),100n);
  assert.equal(cents(signed.maxSafeDecrease),150n);
  assert.equal(cents((await status("/api/charge-lines/J-ORIG-L",200)).amount),200n);
  assert.equal(cents((await status("/api/charge-lines/J-ORIG-P",200)).amount),100n);
  await status("/api/payments",201,{method:"POST",body:
    pay("J-POSTED-AFTER","OT-ADJ-NEG","0.50")});
  assert.equal(cents((await balance("OT-ADJ-NEG")).record.available),100n);
  await status("/api/work-orders",201,{method:"POST",body:order("OT-ADJ-POS",[
    charge("J-ORIG-0","0.00")
  ])});
  sql("BEGIN; "+directInsert("OT-ADJ-POS","J-POS-0001","0.30")+"; "+
    "UPDATE work_order SET charge_total=0.30,opening_balance=0.30,available=0.30 "+
    "WHERE number='OT-ADJ-POS'; COMMIT;");
  const plus=(await balance("OT-ADJ-POS")).snapshot;
  assert.equal(plus.coverageState,"unpaid");
  assert.equal(cents(plus.openingBalance),30n);
  assert.equal(cents(plus.maxSafeDecrease),30n);
  // S2c-1b1: real, authenticated, independent HTTP adjustment capability.
  const reviewedFields=record=>({
    expectedOpening:record.openingBalance,
    expectedAvailable:record.available,
    expectedPostingCount:record.postingCount,
    expectedReversedTotal:record.reversedTotal,
    expectedAdjustmentCount:record.adjustmentCount
  });
  const apply=async(number,id,delta,reason="Corrección autorizada de ensayo",extra={})=>{
    const snap=await request("/api/work-orders/"+number+"/reconciliation");
    const reviewed=snap.status===200?reviewedFields(snap.data):{
      expectedOpening:"0.00",expectedAvailable:"0.00",expectedPostingCount:"0",
      expectedReversedTotal:"0.00",expectedAdjustmentCount:"0"
    };
    return request("/api/work-orders/"+number+"/adjustments",{method:"POST",body:{
      adjustmentId:id,delta,reason,...reviewed,...extra
    }});
  };
  await status("/api/work-orders",201,{method:"POST",body:order("OT-HTTP-ADJ",[
    charge("AH-L","2.00"),charge("AH-P","1.00","parts")
  ])});
  await status("/api/payments",201,{method:"POST",body:
    pay("AH-PAY-1","OT-HTTP-ADJ","1.00")});
  let adjusted=await apply("OT-HTTP-ADJ","AH-PLUS-01","0.20");
  assert.equal(adjusted.status,201,JSON.stringify(adjusted.data));
  assert.equal(cents(adjusted.data.chargeTotal),320n);
  assert.equal(cents(adjusted.data.available),220n);
  // S2c-1b5: after an ambiguous HTTP outcome, read the committed journal
  // without reissuing a financial POST. This is not external PSP settlement.
  const outcomePath=(number,id)=>"/api/work-orders/"+number+"/adjustments/"+id;
  const auditBeforeLookup=sql("SELECT COUNT(*) FROM protocolia_audit_event "+
    "WHERE operation_name='adjustWorkOrder' AND resource_id='OT-HTTP-ADJ'");
  const outcomeHttp=await fetch(base+outcomePath("OT-HTTP-ADJ","AH-PLUS-01"),
    {headers:{Authorization:auth("manager")}});
  assert.equal(outcomeHttp.headers.get("cache-control"),"no-store");
  const observed=await status(outcomePath("OT-HTTP-ADJ","AH-PLUS-01"),200);
  assert.deepEqual(observed,{adjustmentId:"AH-PLUS-01",delta:"0.20",
    reason:"Corrección autorizada de ensayo",status:"committed"});
  assert.equal((await request(outcomePath("OT-HTTP-ADJ","AH-UNKNOWN-1"))).status,404);
  assert.equal((await request(outcomePath("OT-HTTP-ADJ","AH-PLUS-01"),{role:"reader"})).status,403);
  assert.equal((await request(outcomePath("OT-HTTP-ADJ","BAD"))).status,400);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_audit_event "+
    "WHERE operation_name='adjustWorkOrder' AND resource_id='OT-HTTP-ADJ'"),
    auditBeforeLookup,"Read-only recovery must not create audit writes");
  // S2c-1b4: one correction id must never settle a second parent.
  // This is a DB uniqueness guarantee, not merely an HTTP or UI check.
  await status("/api/work-orders",201,{method:"POST",body:order("OT-ADJ-CROSS",[
    charge("AH-CROSS-L","1.00")
  ])});
  assert.equal((await request(outcomePath("OT-ADJ-CROSS","AH-PLUS-01"))).status,404,
    "Journal-wide unique keys must not reveal another order's correction");
  const firstBeforeCross=await balance("OT-HTTP-ADJ");
  const crossBefore=await balance("OT-ADJ-CROSS");
  const duplicateAcrossParents=await apply("OT-ADJ-CROSS","AH-PLUS-01","0.10");
  assert.equal(duplicateAcrossParents.status,409,
    "A previously committed correction id cannot be replayed on another parent");
  assert.equal(cents((await balance("OT-ADJ-CROSS")).record.chargeTotal),
    cents(crossBefore.record.chargeTotal));
  assert.equal(cents((await balance("OT-HTTP-ADJ")).record.chargeTotal),
    cents(firstBeforeCross.record.chargeTotal));
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+
    " WHERE parent_id='OT-ADJ-CROSS'"),"0");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_audit_event "+
    "WHERE operation_name='adjustWorkOrder' AND resource_id='OT-ADJ-CROSS'"),"0");
  assert.throws(()=>sql(directInsert("OT-ADJ-CROSS","AH-PLUS-01","0.10")),
    /duplicate|unique|Compose/i,
    "Direct SQL must not bypass journal-wide key uniqueness");
  assert.equal((await apply("OT-ADJ-CROSS","AH-CROSS-01","0.10")).status,201,
    "A fresh id must remain usable after the rejected replay");
  assert.equal(cents((await balance("OT-ADJ-CROSS")).record.chargeTotal),110n);
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+
    " WHERE adjustment_id='AH-PLUS-01'"),"1");
  // Concurrent requests on distinct parents cannot bypass the global unique index.
  const raceParents=Array.from({length:10},(_,i)=>"OT-GLOBAL-"+String(i).padStart(2,"0"));
  for(let i=0;i<raceParents.length;i++)
    await status("/api/work-orders",201,{method:"POST",body:order(raceParents[i],[
      charge("GL-"+String(i).padStart(2,"0"),"1.00")
    ])});
  const crossRace=await Promise.all(raceParents.map(number=>
    apply(number,"AH-GLOBAL-RACE-01","0.01")));
  assert.equal(crossRace.filter(x=>x.status===201).length,1,
    "Exactly one cross-parent correction can commit with a shared key");
  assert.equal(crossRace.filter(x=>x.status===409).length,9,
    "All other cross-parent correction requests must conflict");
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+
    " WHERE adjustment_id='AH-GLOBAL-RACE-01'"),"1");
  let total=0n;
  for(const number of raceParents){
    const record=(await balance(number)).record;
    total+=cents(record.chargeTotal);
  }
  assert.equal(total,1001n,
    "Ten independent orders must receive exactly one 0.01 correction in total");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_audit_event "+
    "WHERE operation_name='adjustWorkOrder' AND resource_id LIKE 'OT-GLOBAL-%'"),"4",
    "Nine rejected cross-parent writes must leave no audit fragments");
// The winner is discovered from committed PostgreSQL, never inferred from response order.
  const committedWinner=sql("SELECT parent_id FROM "+jtable+
    " WHERE adjustment_id='AH-GLOBAL-RACE-01'");
  assert.ok(raceParents.includes(committedWinner));
  assert.equal((await status(outcomePath(committedWinner,"AH-GLOBAL-RACE-01"),200)).delta,"0.01");
  for(const number of raceParents.filter(x=>x!==committedWinner))
    assert.equal((await request(outcomePath(number,"AH-GLOBAL-RACE-01"))).status,404);
  console.log("PROTOCOLIA_S2C1B5_OUTCOME_PASS exact committed read, privacy and zero writes "+build.target);
  console.log("PROTOCOLIA_S2C1B4_GLOBAL_KEY_PASS cross-parent replay, race and rollback "+build.target);
  adjusted=await apply("OT-HTTP-ADJ","AH-MINUS-1","-0.10");
  assert.equal(adjusted.status,201,JSON.stringify(adjusted.data));
  assert.equal(cents(adjusted.data.chargeTotal),310n);
  assert.equal(cents(adjusted.data.available),210n);
  assert.equal((await balance("OT-HTTP-ADJ")).snapshot.coverageState,"partial");
  assert.equal(cents((await status("/api/charge-lines/AH-L",200)).amount),200n);
  assert.equal(cents((await status("/api/charge-lines/AH-P",200)).amount),100n);
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+
    " WHERE parent_id='OT-HTTP-ADJ'"),"2");
  assert.equal(sql("SELECT actor FROM "+jtable+
    " WHERE adjustment_id='AH-PLUS-01'"),env.PROTOCOLIA_MANAGER_USERNAME);
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_audit_event "+
    "WHERE entity_name='WorkOrder' AND resource_id='OT-HTTP-ADJ' "+
    "AND operation_name='adjustWorkOrder'"),"8");
  const beforeDuplicate=await balance("OT-HTTP-ADJ");
  adjusted=await apply("OT-HTTP-ADJ","AH-PLUS-01","0.20");
  assert.equal(adjusted.status,409);
  assert.equal(cents((await balance("OT-HTTP-ADJ")).record.available),
    cents(beforeDuplicate.record.available));
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_audit_event "+
    "WHERE operation_name='adjustWorkOrder' AND resource_id='OT-HTTP-ADJ'"),"8");
  console.log("PROTOCOLIA_S2C1B1_ADJUST_PASS signed money, actor, audit and idempotency");
  const invalidAdjustment=[
    ["AH-ZERO-01","0.00","Corrección autorizada de ensayo",{},400],
    ["AH-WIRE-01",0.1,"Corrección autorizada de ensayo",{},400],
    ["AH-PRECI-1","0.001","Corrección autorizada de ensayo",{},400],
    ["AH-OVER-01","999999999999.99","Corrección autorizada de ensayo",{},409],
    ["BAD","0.10","Corrección autorizada de ensayo",{},400],
    ["AH-REASON","0.10","   ",{},400],
    ["AH-FORGE-1","0.10","Corrección autorizada de ensayo",{actor:"fake"},400],
    ["AH-FORGE-2","0.10","Corrección autorizada de ensayo",{chargeTotal:"999.00"},400],
    ["AH-FORGE-3","0.10","Corrección autorizada de ensayo",{orderNumber:"OT-OTHER"},400]
  ];
  for(const [id,delta,reason,extra,code] of invalidAdjustment){
    const result=await apply("OT-HTTP-ADJ",id,delta,reason,extra);
    assert.equal(result.status,code,id+" "+JSON.stringify(result.data));
  }
  const forbidden=await request("/api/work-orders/OT-HTTP-ADJ/adjustments",{
    method:"POST",role:"reader",body:{adjustmentId:"AH-READER-1",delta:"0.10",
      reason:"Sin permiso para corregir"}
  });
  assert.equal(forbidden.status,403);
  assert.equal((await apply("OT-NOT-FOUND","AH-NO-ORD","0.10")).status,404);
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+" WHERE parent_id='OT-HTTP-ADJ'"),"2");
  assert.equal((await apply("OT-HTTP-ADJ","AH-COVER-1","-2.10")).status,201);
  const exactlyCovered=(await balance("OT-HTTP-ADJ")).snapshot;
  assert.equal(exactlyCovered.coverageState,"covered");
  assert.equal(cents(exactlyCovered.available),0n);
  assert.equal((await apply("OT-HTTP-ADJ","AH-OVERPAY","-0.01")).status,409);
  assert.equal((await apply("OT-HTTP-ADJ","AH-REOPEN","0.15")).status,201);
  assert.equal((await balance("OT-HTTP-ADJ")).snapshot.coverageState,"partial");
  console.log("PROTOCOLIA_S2C1B1_ADJUST_PASS forged inputs, read authority and covered guard");

  await status("/api/work-orders",201,{method:"POST",body:
    order("OT-ADJ-RACE",[charge("AR-FIRST","3.00")])});
  const reviewedRace=reviewedFields((await balance("OT-ADJ-RACE")).snapshot);
  const decreasing=await Promise.all(Array.from({length:10},(_,i)=>
    apply("OT-ADJ-RACE","AR-NEG-"+String(i).padStart(3,"0"),"-1.00",
      "Corrección autorizada de ensayo",reviewedRace)));
  assert.equal(decreasing.filter(x=>x.status===201).length,1);
  assert.equal(decreasing.filter(x=>x.status===409).length,9);
  assert.equal((await balance("OT-ADJ-RACE")).snapshot.coverageState,"unpaid");
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+" WHERE parent_id='OT-ADJ-RACE'"),"1");
  const reviewedSame=reviewedFields((await balance("OT-ADJ-RACE")).snapshot);
  const sameId=await Promise.all(Array.from({length:5},()=>
    apply("OT-ADJ-RACE","AR-SAME-ID","0.10",
      "Corrección autorizada de ensayo",reviewedSame)));
  assert.equal(sameId.filter(x=>x.status===201).length,1);
  assert.equal(sameId.filter(x=>x.status===409).length,4);
  const afterRace=await balance("OT-ADJ-RACE");
  assert.equal(cents(afterRace.record.chargeTotal),210n);
  assert.equal(cents(afterRace.record.available),210n);
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+" WHERE parent_id='OT-ADJ-RACE'"),"2");
  assert.throws(()=>sql("UPDATE "+jtable+" SET delta=9.00 "+
    "WHERE adjustment_id='AR-SAME-ID'"),/append-only|Compose/i);
  const beforeAba=reviewedFields(afterRace.snapshot);
  assert.equal((await apply("OT-ADJ-RACE","AR-ABA-UP","0.10")).status,201);
  assert.equal((await apply("OT-ADJ-RACE","AR-ABA-DN","-0.10")).status,201);
  const afterAba=await balance("OT-ADJ-RACE");
  assert.equal(afterAba.snapshot.openingBalance,afterRace.snapshot.openingBalance);
  assert.equal(afterAba.snapshot.available,afterRace.snapshot.available);
  assert.equal(afterAba.snapshot.adjustmentCount,"4");
  const auditBeforeStale=sql("SELECT COUNT(*) FROM protocolia_audit_event "+
    "WHERE operation_name='adjustWorkOrder' AND resource_id='OT-ADJ-RACE'");
  const staleAba=await apply("OT-ADJ-RACE","AR-ABA-OLD","0.01",
    "Intento de confirmación con saldo anterior",beforeAba);
  assert.equal(staleAba.status,409,JSON.stringify(staleAba.data));
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+" WHERE parent_id='OT-ADJ-RACE'"),"4");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_audit_event "+
    "WHERE operation_name='adjustWorkOrder' AND resource_id='OT-ADJ-RACE'"),auditBeforeStale);
  await status("/api/work-orders",201,{method:"POST",body:
    order("OT-REVIEW-REVERSE",[charge("RR-LINE-1","2.00")])});
  const beforeReversal=reviewedFields((await balance("OT-REVIEW-REVERSE")).snapshot);
  await status("/api/payments",201,{method:"POST",body:
    pay("RR-PAY-1","OT-REVIEW-REVERSE","0.10")});
  await status("/api/payments/RR-PAY-1/reverse",200,{method:"POST"});
  const afterReversal=await balance("OT-REVIEW-REVERSE");
  assert.equal(afterReversal.snapshot.openingBalance,beforeReversal.expectedOpening);
  assert.equal(afterReversal.snapshot.available,beforeReversal.expectedAvailable);
  assert.equal(afterReversal.snapshot.postingCount,"1");
  assert.equal(cents(afterReversal.snapshot.reversedTotal),10n);
  const staleReceipt=await apply("OT-REVIEW-REVERSE","RR-STALE-1","0.01",
    "Confirmación obsoleta tras cobro y reversión",beforeReversal);
  assert.equal(staleReceipt.status,409);
  assert.equal(sql("SELECT COUNT(*) FROM "+jtable+
    " WHERE parent_id='OT-REVIEW-REVERSE'"),"0");
  assert.equal(sql("SELECT COUNT(*) FROM protocolia_audit_event "+
    "WHERE operation_name='adjustWorkOrder' AND resource_id='OT-REVIEW-REVERSE'"),"0");
  console.log("PROTOCOLIA_S2C1B3_CAS_PASS stale and ABA-safe reviewed snapshot "+build.target);
  console.log("PROTOCOLIA_S2C1B1_ADJUST_ALL_PASS "+build.target);
  console.log("PROTOCOLIA_S2C1B0_JOURNAL_ALL_PASS "+build.target);
  console.log("PROTOCOLIA_S2C1A_PREVIEW_ALL_PASS "+build.target);
  console.log("PROTOCOLIA_S2B_ITEMIZED_ALL_PASS "+build.target);
}finally{
  if(started)try{docker("down","--volumes","--remove-orphans");}
    catch(e){console.error("PROTOCOLIA_S2B_CLEANUP_FAILED "+e.message);process.exitCode=1;}
  rmSync(scratch,{recursive:true,force:true});
}
