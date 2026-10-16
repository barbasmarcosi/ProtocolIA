#!/usr/bin/env node
// Black-box acceptance: exact decimals emitted from native TypeSpec, both real backends.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {readFileSync,mkdtempSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
const generated=resolve(process.argv[2]??"");
assert.ok(process.argv[2],"Usage: probe-finite-choices-http.mjs generated-dir [--browser]");
const token=randomBytes(5).toString("hex"), project="decimal_oracle_"+token;
const work=mkdtempSync(join(tmpdir(),"protocolia-b1-decimal-"));
const manager="decimal_manager",reader="decimal_reader";
const pw=randomBytes(18).toString("hex"),rp=randomBytes(18).toString("hex");
const basic=(user,pass)=>"Basic "+Buffer.from(user+":"+pass).toString("base64");
const nestSchema=join(generated,"src/schema.sql");
const springSchema=join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql");
const schema=readFileSync(existsSync(nestSchema)?nestSchema:springSchema,"utf8");
assert.match(schema,/CHECK \(quality IN \('ready','needs_service','retired'\)\)|CHECK \(quality IN \('needs_service','ready','retired'\)\)/,
  "SQL must reject values outside the TypeSpec enum");
assert.ok(schema.includes("unit_price NUMERIC(24,4)")&&
  schema.includes("cost NUMERIC(24,4)")&&schema.includes("quantity NUMERIC(16,6)")&&
  schema.includes("unit_price>=0")&&
  schema.includes("unit_price::text NOT IN ('NaN','Infinity','-Infinity')"),
  "Both generators must persist source-declared decimals using NUMERIC(p,s) and checked bounds");
assert.ok(schema.includes("price_ceiling NUMERIC(24,4)")&&
  schema.includes("quantity_limit NUMERIC(16,4)")&&
  schema.includes("CONSTRAINT ck_gt_gauge_price_ceiling CHECK (price_ceiling IS NULL OR price_ceiling > unit_price)")&&
  schema.includes("CONSTRAINT ck_gt_gauge_quantity_limit CHECK (quantity_limit IS NULL OR quantity_limit > quantity)"),
  "Both backends must preserve exact decimal comparison in independent PostgreSQL CHECK constraints");
assert.ok(schema.includes("extended_value NUMERIC(26,7) GENERATED ALWAYS AS (unit_rate * batch_units) STORED"),
  "Product value must be a real PostgreSQL generated column with exact base10 scale");
assert.ok(schema.includes("rounded_total NUMERIC(22,2) GENERATED ALWAYS AS (round(unit_rate * batch_units, 2)) STORED"),
  "Both adapters must emit authoritative exact half_up rounding");
assert.ok(schema.includes("discounted_total NUMERIC(22,2) GENERATED ALWAYS AS (round((unit_rate * batch_units * (100 - discount_percent)) / 100, 2)) STORED"),
  "Exact discounted total must be computed by PostgreSQL");
assert.ok(schema.includes("CONSTRAINT ck_cond_gauge_maintenance_reason CHECK (")&&
  schema.includes("quality IS DISTINCT FROM 'needs_service'")&&
  schema.includes("maintenance_reason IS NOT NULL AND char_length(btrim(maintenance_reason)) > 0"),
  "Generated PostgreSQL must independently require maintenance reason for needs_service");
function docker(args,timeout=600000){
 const r=spawnSync("docker",args,{cwd:generated,encoding:"utf8",timeout});
 if(r.status!==0||r.error)throw Error("docker "+args.join(" ")+" failed "+(r.stderr??r.error?.message??"").slice(-1600));
 return r.stdout;
}
async function freePort(){return new Promise((ok,no)=>{
 const s=createServer();s.once("error",no);s.listen(0,"127.0.0.1",()=>{
 const p=s.address().port;s.close(()=>ok(p));});
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
 const base="http://127.0.0.1:"+port,end=Date.now()+150000;
 let ready=false;
 while(Date.now()<end){
  try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2000)})).status===200){ready=true;break;}}catch{}
  await new Promise(ok=>setTimeout(ok,1000));
 }
 assert.ok(ready,"Generated app health");
 async function req(path,{method="GET",body,who="manager"}={}){
  const response=await fetch(base+path,{method,headers:{
   ...(who==="manager"?{Authorization:basic(manager,pw)}:who==="reader"?{Authorization:basic(reader,rp)}:{}),
   ...(body===undefined?{}:{"Content-Type":"application/json"})},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(13000)});
  const raw=await response.text();let json;try{json=JSON.parse(raw)}catch{json=raw}
  return {status:response.status,body:json};
 }
 const path="/api/gauges",payload={serial:token+"-one",label:"Medidor ficticio",reading:2,quality:"ready",unitPrice:"9007199254740993.1234",quantity:"0.000001",unitRate:"99999999.9999",batchUnits:"99999999.125",discountPercent:"12.50"};
 assert.equal((await req(path,{who:null})).status,401);
 assert.equal((await req(path,{method:"POST",body:payload,who:"reader"})).status,403);
 for(const [bad,code] of [["unknown","invalid_choice"],[17,"invalid_type"],["READY","invalid_choice"]]){
  const result=await req(path,{method:"POST",body:{...payload,quality:bad}});
  assert.equal(result.status,400,JSON.stringify(result.body));
  assert.deepEqual(result.body.issues,[{field:"quality",code}],"Consistent Nest/Spring typed enum rejection");
 }
 assert.equal((await req(path+"/"+payload.serial)).status,404,"Invalid values cannot persist");
 // Independent of HTTP code: bypass the app and prove PostgreSQL itself refuses an enum breach.
 const dbIdentity=token+"-invalid-direct";
 const sql="INSERT INTO gauge(serial,label,reading,unit_price,quantity,quality,unit_rate,batch_units,discount_percent) VALUES ('"+
   dbIdentity+"','Direct PostgreSQL invariant probe',1,1.0000,1.000000,'unlisted_value',1.0000,1.000,0.00)";
 const direct=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",sql],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(direct.status,0,"PostgreSQL must independently refuse undeclared enum values");
 assert.match((direct.stderr??"")+(direct.stdout??""),/violates check constraint/i,
   "Negative DB mutation must specifically fail its enum CHECK constraint");
 assert.equal((await req(path+"/"+dbIdentity)).status,404,"Invalid direct SQL insert rolled back");
 const incomplete=token+"-invalid-condition";
 const conditionalSql="INSERT INTO gauge(serial,label,reading,unit_price,quantity,quality,unit_rate,batch_units,discount_percent) VALUES ('"+
   incomplete+"','Conditional SQL check',1,1.0000,1.000000,'needs_service',1.0000,1.000,0.00)";
 const rejected=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",conditionalSql],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(rejected.status,0,"PostgreSQL must reject missing conditional field");
 assert.match((rejected.stderr??"")+(rejected.stdout??""),/ck_cond_gauge_maintenance_reason/i);
 assert.equal((await req(path+"/"+incomplete)).status,404,"Conditional SQL breach is rolled back");
 for(const [reason,serial] of [[undefined,"absent"],["","empty"],["   ","spaces"]]){
   const input={...payload,serial:token+"-"+serial,quality:"needs_service"};
   if(reason!==undefined)input.maintenanceReason=reason;
   const response=await req(path,{method:"POST",body:input});
   assert.equal(response.status,400,"Conditional reason must fail before persistence");
   assert.deepEqual(response.body?.issues,[{field:"maintenanceReason",code:"required"}]);
   assert.equal((await req(path+"/"+input.serial)).status,404);
 }
 const serviced={...payload,serial:token+"-serviced",quality:"needs_service",
   maintenanceReason:"Pérdida de calibración verificada"};
 assert.equal((await req(path,{method:"POST",body:serviced})).status,201);
 assert.equal((await req(path+"/"+serviced.serial)).body.maintenanceReason,serviced.maintenanceReason);
 const retired={...payload,serial:token+"-retired",quality:"retired"};
 assert.equal((await req(path,{method:"POST",body:retired})).status,201,
   "Other enum values must not require the conditional field");
 // Exact base10: the value 9007199254740993.1234 would lose precision in JS Number.
 for(const [value,code] of [
  [9007199254740992,"invalid_type"],["1.23456","invalid_format"],
  ["1e3","invalid_format"],["NaN","invalid_format"],["Infinity","invalid_format"],
  ["-0.0001","out_of_range"],["100000000000000000000.0000","out_of_range"],
  ["0001.23","invalid_format"],[" 1.20 ","invalid_format"]]){
  const attempt=await req(path,{method:"POST",body:{...payload,serial:token+"-bad-"+Math.random().toString(36).slice(2),unitPrice:value}});
  assert.equal(attempt.status,400,JSON.stringify({value,attempt}));
  assert.deepEqual(attempt.body.issues,[{field:"unitPrice",code}]);
 }
 // Exact inclusive bounds, values beyond JS safe integer range and nullable fields.
 const maxExact={...payload,serial:token+"-max",
   unitPrice:"99999999999999999999.9999",quantity:"9999999999.999999",
   percentage:"100.000",cost:"0.0100"};
 const maxResponse=await req(path,{method:"POST",body:maxExact});
 assert.equal(maxResponse.status,201,JSON.stringify(maxResponse.body));
 const maxRead=(await req(path+"/"+maxExact.serial)).body;
 assert.equal(maxRead.unitPrice,maxExact.unitPrice,"Exact precision maximum round trip");
 assert.equal(maxRead.quantity,maxExact.quantity,"Exact quantity maximum round trip");
 assert.equal(maxRead.cost,"0.0100","No precision loss for optional nullable cost");
 const minExact={...payload,serial:token+"-min",unitPrice:"0.0000",quantity:"0.000001",
   percentage:"0.000"};
 assert.equal((await req(path,{method:"POST",body:minExact})).status,201);
 assert.equal((await req(path+"/"+minExact.serial)).body.unitPrice,"0.0000");
 const belowQuantity={...payload,serial:token+"-below",quantity:"0.000000"};
 const belowResult=await req(path,{method:"POST",body:belowQuantity});
 assert.equal(belowResult.status,400,JSON.stringify(belowResult.body));
 assert.deepEqual(belowResult.body.issues,[{field:"quantity",code:"out_of_range"}]);
 const nullRequired=await req(path,{method:"POST",body:{...payload,serial:token+"-null-required",unitPrice:null}});
 assert.equal(nullRequired.status,400);
 assert.deepEqual(nullRequired.body.issues,[{field:"unitPrice",code:"required"}]);
 const omittedOptional={...payload,serial:token+"-omitted"};
 assert.equal((await req(path,{method:"POST",body:omittedOptional})).status,201);
 assert.equal((await req(path+"/"+omittedOptional.serial)).body.cost,null);
 const explicitNull={...payload,serial:token+"-null",cost:null,percentage:"100.000"};
 assert.equal((await req(path,{method:"POST",body:explicitNull})).status,201);
 assert.equal((await req(path+"/"+explicitNull.serial)).body.percentage,"100.000");
 const tooHigh={...payload,serial:token+"-pct-invalid",percentage:"100.001"};
 assert.deepEqual((await req(path,{method:"POST",body:tooHigh})).body.issues,[{field:"percentage",code:"out_of_range"}]);
 // Mixed-scale and greater-than-safe-integer comparisons must not round through JS Number.
 for(const [key,from,to,code,i] of [
   ["priceCeiling","9007199254740993.1234","9007199254740993.1234","invalid_comparison",1],
   ["priceCeiling","9007199254740993.1234","9007199254740993.1233","invalid_comparison",2],
   ["quantityLimit","0.000001","0.0000","invalid_comparison",3],
   ["quantityLimit","0.100001","0.1000","invalid_comparison",4],
   ["priceCeiling","9007199254740993.1234",null,"required",5],
   ["priceCeiling","9007199254740993.1234",12,"invalid_type",6]
 ]){
   const field=key==="priceCeiling"?"unitPrice":"quantity";
   const candidate={...payload,serial:token+"-compare-bad-"+i,[field]:from,[key]:to};
   const response=await req(path,{method:"POST",body:candidate});
   assert.equal(response.status,400,JSON.stringify({candidate,response}));
   assert.deepEqual(response.body.issues,[{field:key,code}]);
   assert.equal((await req(path+"/"+candidate.serial)).status,404);
 }
 const comparable={...payload,serial:token+"-compare-valid",
   priceCeiling:"9007199254740993.1235",quantityLimit:"0.0001"};
 assert.equal((await req(path,{method:"POST",body:comparable})).status,201);
 const comparedRead=(await req(path+"/"+comparable.serial)).body;
 assert.equal(comparedRead.priceCeiling,comparable.priceCeiling);
 assert.equal(comparedRead.quantityLimit,comparable.quantityLimit);
 const invalidSql=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",
   "INSERT INTO gauge(serial,label,reading,unit_price,price_ceiling,quantity,quantity_limit,unit_rate,batch_units,discount_percent) VALUES ('"+
   token+"-sql-equal','SQL direct comparison',1,9007199254740993.1234,9007199254740993.1234,0.000001,0.0001,1.0000,1.000,0.00)"],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(invalidSql.status,0,"Direct SQL must reject equal high-precision decimals");
 assert.match((invalidSql.stderr??"")+(invalidSql.stdout??""),/ck_gt_gauge_price_ceiling/i);
 assert.equal((await req(path+"/"+token+"-sql-equal")).status,404);
 const invalidScaleSql=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",
   "INSERT INTO gauge(serial,label,reading,unit_price,quantity,quantity_limit,unit_rate,batch_units,discount_percent) VALUES ('"+
   token+"-sql-scale','SQL direct scale',1,1.0000,0.100001,0.1000,1.0000,1.000,0.00)"],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(invalidScaleSql.status,0,"Mixed-scale comparison must reject direct SQL");
 assert.match((invalidScaleSql.stderr??"")+(invalidScaleSql.stdout??""),/ck_gt_gauge_quantity_limit/i);
 const directBad=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",
   "INSERT INTO gauge(serial,label,reading,unit_price,quantity,unit_rate,batch_units,discount_percent) VALUES ('"+token+"-bad-sql','Overflow',1,100000000000000000000.0000,1.000000,1.0000,1.000,0.00)"],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(directBad.status,0,"DB NUMERIC(p,s) overflow must fail independently of HTTP");
 const sqlNaN=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",
   "INSERT INTO gauge(serial,label,reading,unit_price,quantity,unit_rate,batch_units,discount_percent) VALUES ('"+
     token+"-nan-direct','Forbidden NaN',1,'NaN',1.000000,1.0000,1.000,0.00)"],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(sqlNaN.status,0,"PostgreSQL CHECK must reject non-finite numeric input");
 assert.equal((await req(path,{method:"POST",body:payload})).status,201);
 assert.equal((await req(path+"/"+payload.serial,{who:"reader"})).body.quality,"ready");
 assert.equal((await req(path+"/"+payload.serial)).body.extendedValue,
   "9999999912490000.0000875","Server result must remain exact beyond JS safe integer range");
 assert.equal((await req(path+"/"+payload.serial)).body.roundedTotal,
   "9999999912490000.00","Large rounded result retains full exact digits and cents");
 assert.equal((await req(path+"/"+payload.serial)).body.discountedTotal,
   "8749999923428750.00","Large exact fractional discounts retain decimal precision");
 const forged={...payload,serial:token+"-forged",extendedValue:"0.0000000"};
 const forgedResponse=await req(path,{method:"POST",body:forged});
 assert.equal(forgedResponse.status,400,"Computed product cannot be submitted by a client");
 assert.equal((await req(path+"/"+forged.serial)).status,404);
 const forgedRound={...payload,serial:token+"-forged-round",roundedTotal:"0.00"};
 assert.equal((await req(path,{method:"POST",body:forgedRound})).status,400,
   "Computed rounded monetary value must be read-only over HTTP");
 assert.equal((await req(path+"/"+forgedRound.serial)).status,404);
 for(const [unitRate,expected,suffix] of [
   ["1.0050","1.01","tie"],["1.0049","1.00","below"],
   ["1.0150","1.02","second-tie"],["0.0000","0.00","zero"]
 ]){
   const record={...payload,serial:token+"-"+suffix,unitRate,batchUnits:"1.000"};
   assert.equal((await req(path,{method:"POST",body:record})).status,201,suffix);
   assert.equal((await req(path+"/"+record.serial)).body.roundedTotal,expected,
     "PostgreSQL half_up "+suffix);
 }
 const directRound=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",
   "INSERT INTO gauge(serial,label,reading,unit_price,quantity,unit_rate,batch_units,discount_percent) "+
   "VALUES ('"+token+"-sql-rounded','Direct SQL rounding',1,1.0000,1.000000,1.0050,1.000,0.00)"],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.equal(directRound.status,0,"Direct SQL inserts must compute rounded values");
 assert.equal((await req(path+"/"+token+"-sql-rounded")).body.roundedTotal,"1.01");
 const forgedSqlRound=spawnSync("docker",[...args,"exec","-T","db","psql","-U","protocolia",
   "-d","protocolia","-v","ON_ERROR_STOP=1","-c",
   "INSERT INTO gauge(serial,label,reading,unit_price,quantity,unit_rate,batch_units,rounded_total,discount_percent) "+
   "VALUES ('"+token+"-sql-forged','Generated override',1,1.0000,1.000000,1.0050,1.000,0.00,0.00)"],{
   cwd:generated,encoding:"utf8",timeout:15000
 });
 assert.notEqual(forgedSqlRound.status,0,"Database must block overrides to generated rounded values");
 assert.match((forgedSqlRound.stderr??"")+(forgedSqlRound.stdout??""),/generated column/i);
 const minimal={...payload,serial:token+"-small",unitRate:"0.0001",batchUnits:"0.001"};
 assert.equal((await req(path,{method:"POST",body:minimal})).status,201);
 assert.equal((await req(path+"/"+minimal.serial)).body.extendedValue,"0.0000001",
   "Exact scale 7 must persist the smallest representable multiplication");
 assert.equal((await req(path+"/"+minimal.serial)).body.roundedTotal,"0.00",
   "Half-up cent rounding is explicit and must not preserve sub-cent amounts");
 assert.equal((await req(path,{method:"POST",body:{...payload,serial:token+"-no-choice",quality:undefined}})).status,201);
 assert.equal((await req(path,{method:"POST",body:payload})).status,409);
 if(process.argv.includes("--browser")){
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
   const page=await browser.newPage({viewport:{width:390,height:780},locale:"es-AR"});
   const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.goto(base+"/",{waitUntil:"domcontentloaded"});
   await page.getByTestId("username").fill(manager);
   await page.getByTestId("password").fill(pw);
   await page.getByRole("button",{name:"Entrar",exact:true}).click();
   await page.getByTestId("open-create").click();
   const form=page.getByTestId("create-form-Gauge");
   await form.waitFor({state:"visible"});
   const selected=token+"-web";
   await form.getByTestId("create-serial").fill(selected);
   await form.getByTestId("create-label").fill("Instrumento generado");
   await form.getByTestId("create-reading").fill("3");
   await form.getByTestId("create-unitPrice").fill("9007199254740993.1234");
   await form.getByTestId("create-quantity").fill("0.000001");
   assert.equal(await form.getByTestId("create-extendedValue").count(),0,
     "Generated exact product is read-only and never editable in React");
   assert.equal(await form.getByTestId("create-roundedTotal").count(),0,
     "Rounded total must not be editable from the generated React UI");
   await form.getByTestId("create-unitRate").fill("99999999.9999");
   await form.getByTestId("create-batchUnits").fill("99999999.125");
   await form.getByTestId("create-priceCeiling").fill("9007199254740993.1234");
   await form.getByTestId("create-quantityLimit").fill("0.0000");
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   assert.equal(await form.getByTestId("create-priceCeiling").getAttribute("aria-invalid"),"true",
     "React must reject exact decimal equality beyond MAX_SAFE_INTEGER");
   assert.equal(await form.getByTestId("create-quantityLimit").getAttribute("aria-invalid"),"true",
     "React must reject mixed-scale inequality before any API request");
   await form.getByTestId("create-priceCeiling").fill("9007199254740993.1235");
   await form.getByTestId("create-quantityLimit").fill("0.0001");
   assert.equal(await form.getByTestId("create-unitPrice").getAttribute("inputmode"),"decimal");
   await form.getByTestId("create-quality").click();
   await page.getByRole("option",{name:"Needs Service"}).click();
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   assert.equal(await page.getByTestId("create-dialog").isVisible(),true,
     "A missing conditional reason must not close the create form");
   assert.equal(await form.getByTestId("create-maintenanceReason").getAttribute("aria-invalid"),"true",
     "The generated UI identifies the conditional field before API write");
   const requiredLabel=await form.getByTestId("create-maintenanceReason").locator("..").innerText();
   assert.match(requiredLabel,/obligatorio/i,"Mobile form explains the conditional requirement");
   await form.getByTestId("create-maintenanceReason").fill("Falla en la calibración de prueba");
   await page.screenshot({path:join(generated,"protocolia-b1-enum-mobile.png"),fullPage:true});
   await form.getByRole("button",{name:"Crear",exact:true}).click();
   await page.getByTestId("create-dialog").waitFor({state:"hidden",timeout:15000});
   const stored=await req(path+"/"+selected);
   assert.equal(stored.body.quality,"needs_service","UI persists source enum value, not caption");
   assert.equal(stored.body.unitPrice,"9007199254740993.1234","UI persists exact decimal string");
   assert.equal(stored.body.extendedValue,"9999999912490000.0000875",
     "React submission never computes or rounds the PostgreSQL-generated product");
   assert.equal(stored.body.roundedTotal,"9999999912490000.00",
     "PostgreSQL returns a correctly rounded amount from browser-created operands");
   assert.equal(stored.body.priceCeiling,"9007199254740993.1235","UI keeps high-precision cross-field ordering");
   assert.equal(stored.body.quantityLimit,"0.0001","UI keeps mixed-scale exact decimal ordering");
   assert.equal(stored.body.maintenanceReason,"Falla en la calibración de prueba");
   assert.equal(errors.length,0,"React errors: "+errors.join(";"));
   console.log("PROTOCOLIA_B1_EXACT_DECIMAL_BROWSER_PASS "+JSON.stringify({choice:"needs_service",conditionalRequired:true,mobile:true,jsErrors:0}));
  }finally{await browser.close();}
 }
 docker([...args,"restart","app"],120000);
 const after=Date.now()+80000;let returned=false;
 while(Date.now()<after){
  try{if((await req(path+"/"+payload.serial)).body.unitPrice==="9007199254740993.1234"){returned=true;break;}}catch{}
  await new Promise(ok=>setTimeout(ok,1000));
 }
 assert.ok(returned,"PostgreSQL value persisted across restart");
 console.log("PROTOCOLIA_B1_EXACT_DECIMAL_HTTP_PASS "+JSON.stringify({source:"TypeSpec exact decimal",invalidChoice400:true,postgresConstraint:true,conditionalRequired:true,dbRejectsIncomplete:true,persisted:true}));
}finally{
 if(started)try{docker([...args,"down","--volumes","--remove-orphans"],120000)}
 catch(e){console.error("B1 cleanup failed",e.message);process.exitCode=1}
 rmSync(work,{recursive:true,force:true});
}
