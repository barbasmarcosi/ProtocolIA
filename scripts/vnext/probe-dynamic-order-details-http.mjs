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
const label=randomBytes(5).toString("hex"),project="pia_b12_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-details-"));
const schema=readFileSync(
  existsSync(join(generated,"src/schema.sql"))?join(generated,"src/schema.sql"):
    join(generated,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/CREATE TABLE order_line \(/,"Relational detail table required");
assert.match(schema,/CREATE TABLE purchase_order \(/,"Relational order header required");
assert.match(schema,/FOREIGN KEY \(order_code\) REFERENCES purchase_order \(code\)/,
  "Generated detail rows require real FK to order header");
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




  const orders="/api/orders";
  const item=(lineCode,product,units)=>({lineCode,product,units});
  const order=(code,lines,title="Orden generada")=>({code,title,lines});
  const create=(code,lines,title)=>request("POST",orders,order(code,lines,title));
  const readOrder=code=>expect("GET",orders+"/"+code,undefined,200);
  const readLine=code=>expect("GET","/api/order-lines/"+code,undefined,200);
  assert.equal((await request("POST",orders,order("R-NO",[item("ROW-NO","Café",1)]),
    {Authorization:basic("reader",readerPassword)})).status,403);
  assert.equal((await create("EMPTY",[])).status,400);
  assert.equal((await create("OVER",Array.from({length:21},(_,i)=>
    item("O-"+i,"Producto",1)))).status,400);
  assert.equal((await create("UNKNOWN",[{
    ...item("UNKNOWN-1","Producto",1),unexpected:"unsafe"}])).status,400);
  assert.equal((await create("INJECT",[{
    ...item("INJECT-1","Producto",1),orderCode:"ANOTHER"}])).status,400);
  assert.equal((await create("INVALID",[item("BAD-1","Producto",0)])).status,400);
  assert.equal((await create("DUP-IN-BODY",[item("TWICE","Café",1),
    item("TWICE","Te",3)])).status,409);
  assert.equal((await request("GET",orders+"/DUP-IN-BODY")).status,404,
    "Duplicate child must rollback parent header");
  assert.equal((await create("SUCCESS",[
    item("SUCCESS-1","Café",2),item("SUCCESS-2","Te",3),item("SUCCESS-3","Agua",4)
  ])).status,201);
  assert.equal((await readOrder("SUCCESS")).title,"Orden generada");
  for(const n of [1,2,3]){
    const data=await readLine("SUCCESS-"+n);
    assert.equal(data.orderCode,"SUCCESS");
    assert.equal(data.units,n+1);
  }
  assert.equal((await create("DUP-CHILD",[item("SUCCESS-1","Reuso",1)])).status,409);
  assert.equal((await request("GET",orders+"/DUP-CHILD")).status,404,
    "Existing child key must rollback newly-created parent");
  const twenty=Array.from({length:20},(_,i)=>item("TWENTY-"+i,"Producto "+i,i+1));
  assert.equal((await create("TWENTY",twenty)).status,201);
  assert.equal((await readLine("TWENTY-19")).orderCode,"TWENTY");
  const simultaneous=await Promise.all(Array.from({length:10},()=>create("RACE",[
    item("RACE-1","Café",1),item("RACE-2","Te",2)])));
  assert.equal(simultaneous.filter(x=>x.status===201).length,1,JSON.stringify(simultaneous));
  assert.equal(simultaneous.filter(x=>x.status===409).length,9,JSON.stringify(simultaneous));
  const sql=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT (SELECT count(*) FROM \"order\")::text || ':' || "+
      "(SELECT count(*) FROM order_line)::text || ':' || "+
      "(SELECT count(*) FROM order_line WHERE order_code NOT IN (SELECT code FROM \"order\"))::text"]);
  assert.equal(sql,"3:25:0","Three headers and 25 persisted FK children; zero orphans");
  // Generated responsive React must edit 1..20 rows without app-specific components.
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(base+"/",{waitUntil:"domcontentloaded"});
    await page.getByTestId("username").fill("manager");
    await page.getByTestId("password").fill(password);
    await page.getByRole("button",{name:"Entrar"}).click();
    await page.getByRole("button",{name:"Órdenes",exact:true}).waitFor({timeout:30000});
    await page.getByRole("button",{name:"Órdenes",exact:true}).click();
    await page.getByTestId("open-create").click();
    await page.getByTestId("dynamic-detail-editor").waitFor({timeout:20000});
    await page.getByTestId("create-code").fill("UI-ORDER");
    await page.getByTestId("create-title").fill("Orden creada en el celular");
    const fill=async(i,key,product,units)=>{
      const row=page.getByTestId("detail-row-"+i);
      await row.getByTestId("create-lineCode").fill(key);
      await row.getByTestId("create-product").fill(product);
      await row.getByTestId("create-units").fill(String(units));
    };
    await fill(0,"UI-LINE-1","Jabón",2);
    await page.getByTestId("add-detail-row").click();
    await fill(1,"UI-REMOVED","Temporal",3);
    await page.getByTestId("add-detail-row").click();
    await fill(2,"UI-LINE-2","Pan",5);
    await page.getByRole("button",{name:"Quitar renglón 2"}).click();
    assert.equal(await page.getByTestId("detail-row-1").getByTestId("create-lineCode").inputValue(),
      "UI-LINE-2","Removed middle row must not remove the last item");
    let posts=0;page.on("request",req=>{if(req.method()==="POST"&&req.url().endsWith(orders))posts++;});
    const submit=page.getByTestId("create-form-PurchaseOrder").getByRole("button",{name:"Crear",exact:true});
    const result=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().endsWith(orders));
    await submit.click();
    assert.equal((await result).status(),201);
    assert.equal(posts,1,"One API create only");
    assert.equal((await readLine("UI-LINE-1")).orderCode,"UI-ORDER");
    assert.equal((await readLine("UI-LINE-2")).orderCode,"UI-ORDER");
    assert.equal((await request("GET","/api/order-lines/UI-REMOVED")).status,404);
    await page.screenshot({path:join(generated,"b12-dynamic-details-mobile.png"),fullPage:true});
    assert.deepEqual(errors,[],"No JavaScript runtime failure");
    console.log("PROTOCOLIA_B12_DYNAMIC_DETAILS_CHROMIUM_PASS");
  }finally{await browser.close();}
  const after=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT (SELECT count(*) FROM \"order\")::text || ':' || "+
      "(SELECT count(*) FROM order_line)::text"]);
  assert.equal(after,"4:27");
  console.log("PROTOCOLIA_B12_RELATIONAL_DETAILS_PASS "+JSON.stringify({
    atomic:true,maxRowsAccepted:20,duplicateChildRollback:true,
    concurrentCreateWinners:1,concurrentConflict:9,
    uiCreatedRows:2,noOrphans:true
  }));
}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
