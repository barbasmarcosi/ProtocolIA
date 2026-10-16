#!/usr/bin/env node
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {readFileSync,mkdtempSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Usage: probe-exact-debits-http.mjs generated-dir [--browser]");
const token=randomBytes(5).toString("hex"),project="debit_oracle_"+token;
const work=mkdtempSync(join(tmpdir(),"protocolia-exact-debit-"));
const manager="debit_manager",reader="debit_reader";
const pw=randomBytes(18).toString("hex"),rp=randomBytes(18).toString("hex");
const basic=(u,p)=>"Basic "+Buffer.from(u+":"+p).toString("base64");
const a=join(generated,"src/schema.sql");
const b=join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql");
const schema=readFileSync(existsSync(a)?a:b,"utf8");
assert.ok(schema.includes("available NUMERIC(24,2)")&&
  schema.includes("amount NUMERIC(24,2)")&&schema.includes("available>=0")&&
  schema.includes("amount>=0.01"),"PostgreSQL exact balance/amount constraints");
function docker(args,timeout=600000){
 const r=spawnSync("docker",args,{cwd:generated,encoding:"utf8",timeout});
 if(r.status!==0||r.error)throw Error("docker "+args.join(" ")+" failed "+(r.stderr??r.error?.message??"").slice(-1800));
 return r.stdout;
}
async function freePort(){return new Promise((resolve,reject)=>{
 const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{
  const port=s.address().port;s.close(()=>resolve(port));});
});}
let args=[],started=false;
try{
 const port=await freePort(),env=join(work,"env");
 writeFileSync(env,[
  "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
  "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
  "PROTOCOLIA_MANAGER_USERNAME="+manager,
  "PROTOCOLIA_MANAGER_PASSWORD="+pw,
  "PROTOCOLIA_READER_USERNAME="+reader,
  "PROTOCOLIA_READER_PASSWORD="+rp,
  "PROTOCOLIA_HOST_PORT="+port
 ].join("\n")+"\n",{mode:0o600});
 args=["compose","--project-name",project,"--env-file",env];
 docker([...args,"config","--quiet"],15000);started=true;
 docker([...args,"up","--detach","--build"]);
 const base="http://127.0.0.1:"+port,deadline=Date.now()+150000;
 let ready=false;
 while(Date.now()<deadline){
  try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2000)})).status===200){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(ready,"Generated app must become healthy");
 async function req(path,{method="GET",body,who="manager"}={}){
  const response=await fetch(base+path,{method,headers:{
    ...(who==="manager"?{Authorization:basic(manager,pw)}:who==="reader"?{Authorization:basic(reader,rp)}:{}),
    ...(body===undefined?{}:{"Content-Type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  let data;const raw=await response.text();try{data=JSON.parse(raw)}catch{data=raw}
  return {status:response.status,body:data};
 }
 const wallet="/api/wallets",charge="/api/charges",key=token+"-main";
 const createWallet=body=>req(wallet,{method:"POST",body});
 const createCharge=body=>req(charge,{method:"POST",body});
 const getBalance=async name=>req(wallet+"/"+name);
 const reverse=id=>req(charge+"/"+id+"/reverse",{method:"POST"});
 const readCharge=id=>req(charge+"/"+id);
 assert.equal((await req(wallet,{who:null})).status,401);
 assert.equal((await createWallet({walletCode:key,name:"Saldo de prueba",available:"10.00"})).status,201);
 assert.equal((await req(wallet,{method:"POST",who:"reader",body:{walletCode:token+"-deny",name:"Sin permiso",available:"4.00"}})).status,403);
 const payload={walletCode:key,amount:"1.00"};
 assert.equal((await req(charge,{method:"POST",who:"reader",body:{...payload,chargeNumber:token+"-unauthorized"}})).status,403);
 for(const [value,code] of [[0,"invalid_type"],["0.00","out_of_range"],["-1.00","out_of_range"],["0.001","invalid_format"],["NaN","invalid_format"],["1e3","invalid_format"]]){
  const response=await createCharge({...payload,chargeNumber:token+"-bad-"+String(value).replace(/[^a-z0-9]/gi,""),amount:value});
  assert.equal(response.status,400,JSON.stringify(response));
  assert.deepEqual(response.body.issues,[{field:"amount",code}]);
 }
 assert.equal((await createCharge({...payload,chargeNumber:token+"-missing",walletCode:token+"-absent"})).status,400);
 assert.equal((await getBalance(key)).body.available,"10.00");
 // Unique posting identifier is an atomic rollback gate for the already-performed debit.
 assert.equal((await createCharge({...payload,chargeNumber:token+"-one"})).status,201);
 assert.equal((await getBalance(key)).body.available,"9.00");
 assert.equal((await createCharge({...payload,chargeNumber:token+"-one",amount:"2.00"})).status,409);
 assert.equal((await getBalance(key)).body.available,"9.00","Duplicate posting must not consume funds");
 assert.equal((await createCharge({...payload,chargeNumber:token+"-too-much",amount:"9.01"})).status,409);
 assert.equal((await getBalance(key)).body.available,"9.00");
 // 12 simultaneous posting attempts for the nine remaining units. Exactly nine may commit.
 const outcomes=await Promise.all(Array.from({length:12},(_,i)=>createCharge({
  ...payload,chargeNumber:token+"-race-"+i
 })));
 assert.equal(outcomes.filter(x=>x.status===201).length,9,JSON.stringify(outcomes));
 assert.equal(outcomes.filter(x=>x.status===409).length,3,JSON.stringify(outcomes));
 assert.equal((await getBalance(key)).body.available,"0.00");
 const page=await req(charge+"?limit=50&offset=0",{who:"reader"});
 assert.equal(page.status,200);
 assert.equal(page.body.total,10);
 assert.equal((await req(charge+"/"+token+"-one",{who:"reader"})).body.amount,"1.00");
 assert.equal((await readCharge(token+"-one")).body.status,"posted");
 assert.equal((await req(charge+"/"+token+"-one"+"/reverse",{method:"POST",who:"reader"})).status,403);
 assert.equal((await reverse(token+"-missing")).status,404);
 assert.equal((await getBalance(key)).body.available,"0.00");
 const competingReversals=await Promise.all(Array.from({length:10},()=>reverse(token+"-one")));
 assert.equal(competingReversals.filter(x=>x.status===200).length,1,JSON.stringify(competingReversals));
 assert.equal(competingReversals.filter(x=>x.status===409).length,9,JSON.stringify(competingReversals));
 assert.equal((await getBalance(key)).body.available,"1.00");
 assert.equal((await readCharge(token+"-one")).body.status,"reversed");
 assert.equal((await reverse(token+"-one")).status,409,"A double credit is forbidden");
 assert.equal((await reverse(token+"-race-0")).status,200);
 assert.equal((await getBalance(key)).body.available,"2.00");
 const reverseAudit=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia","-t","-A","-c",
   "SELECT COUNT(*) FROM protocolia_audit_event WHERE entity_name='Charge' AND operation_name='reverseCharge' AND field_name='status'"],15000).trim();
 assert.equal(reverseAudit,"2","Exactly one audit event per committed reversal");
 // No IEEE-754 conversion: a decimal balance above Number.MAX_SAFE_INTEGER.
 const huge=token+"-huge",big="9007199254740993.99";
 assert.equal((await createWallet({walletCode:huge,name:"High precision",available:big})).status,201);
 assert.equal((await createCharge({chargeNumber:token+"-precise",walletCode:huge,amount:"0.01"})).status,201);
 assert.equal((await getBalance(huge)).body.available,"9007199254740993.98");
 const ceiling="9999999999999999999999.99";
 docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia","-v","ON_ERROR_STOP=1","-c",
   "UPDATE wallet SET available='"+ceiling+"' WHERE wallet_code='"+huge+"'"],15000);
 assert.equal((await reverse(token+"-precise")).status,409,"Overflow credit refused");
 assert.equal((await readCharge(token+"-precise")).body.status,"posted","Failed credit rolls back state");
 assert.equal((await getBalance(huge)).body.available,ceiling);
 docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia","-v","ON_ERROR_STOP=1","-c",
   "UPDATE wallet SET available='9007199254740993.98' WHERE wallet_code='"+huge+"'"],15000);
 assert.equal((await reverse(token+"-precise")).status,200);
 assert.equal((await getBalance(huge)).body.available,"9007199254740993.99");
 assert.equal((await readCharge(token+"-precise")).body.status,"reversed");
 const audit=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia","-t","-A","-c",
  "SELECT COUNT(*) FROM protocolia_audit_event WHERE entity_name='Charge' AND operation_name='createCharge' AND field_name='amount'"],15000).trim();
 assert.equal(audit,"11","Audits must roll back for duplicate/failed postings");
 // Direct SQL negative check: database rejects an invalid negative balance.
 const bad=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
  "-v","ON_ERROR_STOP=1","-c","UPDATE wallet SET available=-1 WHERE wallet_code='"+huge+"'"],{
  cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(bad.status,0,"Direct SQL cannot make balance negative");
 assert.match((bad.stderr??"")+(bad.stdout??""),/violates check constraint/i);
 assert.equal((await getBalance(huge)).body.available,"9007199254740993.99");
 if(process.argv.includes("--browser")){
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
   const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.goto(base+"/",{waitUntil:"domcontentloaded"});
   await page.getByTestId("username").fill(manager);
   await page.getByTestId("password").fill(pw);
   await page.getByRole("button",{name:"Entrar",exact:true}).click();
   await page.getByRole("button",{name:"Saldos",exact:true}).click();
   await page.getByTestId("open-create").click();
   const form=page.getByTestId("create-form-Wallet");
   await form.getByTestId("create-walletCode").fill(token+"-web");
   await form.getByTestId("create-name").fill("Cuenta desde móvil");
   await form.getByTestId("create-available").fill("5.25");
   await page.screenshot({path:join(generated,"exact-debit-mobile.png"),fullPage:true});
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   await page.getByTestId("create-dialog").waitFor({state:"hidden",timeout:15000});
   assert.equal((await getBalance(token+"-web")).body.available,"5.25");
   await page.getByRole("button",{name:"Cargos",exact:true}).click();
   await page.getByTestId("open-create").click();
   const chargeForm=page.getByTestId("create-form-Charge");
   await chargeForm.getByTestId("create-chargeNumber").fill(token+"-web-charge");
   await chargeForm.getByTestId("create-walletCode").click();
   await page.getByRole("option").filter({hasText:token+"-web"}).first().click();
   await chargeForm.getByTestId("create-amount").fill("1.25");
   await chargeForm.getByRole("button",{name:"Crear",exact:true}).click();
   await page.getByTestId("create-dialog").waitFor({state:"hidden",timeout:15000});
   assert.equal((await getBalance(token+"-web")).body.available,"4.00");
   await page.getByTestId("open-detail-"+token+"-web-charge").click();
   await page.getByTestId("transition-reverseCharge").click();
   const endReversal=Date.now()+16000;
   let reversed=false;
   while(Date.now()<endReversal){
     const record=await readCharge(token+"-web-charge");
     if(record.body?.status==="reversed"){reversed=true;break;}
     await page.waitForTimeout(300);
   }
   assert.ok(reversed,"Generated transition button executes the atomic reversal");
   assert.equal((await getBalance(token+"-web")).body.available,"5.25");
   await page.screenshot({path:join(generated,"exact-reversal-mobile.png"),fullPage:true});
   assert.equal(errors.length,0,errors.join("; "));
  }finally{await browser.close();}
 }
 docker([...args,"restart","app"],120000);
 const end=Date.now()+80000;
 let persisted=false;
 while(Date.now()<end){
  try{if((await getBalance(huge)).body.available==="9007199254740993.99"){persisted=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(persisted,"Exact debits must persist after restart");
 console.log("PROTOCOLIA_B2_EXACT_REVERSAL_PASS "+JSON.stringify({concurrentDebit:9,conflictDebit:3,concurrentReversal:1,conflictReversal:9,rollback:true,overflowGuard:true,exact:true,audit:true,persistent:true,mobile:process.argv.includes("--browser")}));
}finally{
 if(started)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}
 catch(e){console.error("Exact debit cleanup failed",e.message);process.exitCode=1}
 rmSync(work,{recursive:true,force:true});
}
