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
const label=randomBytes(5).toString("hex"),project="pia_b14_"+label;
const temp=mkdtempSync(join(tmpdir(),"pia-detail-lifecycle-"));
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
  // SQL-filtered server pagination: no cross-parent rows, bounded limit and durable total.
  const queryBase="/api/order-lines/query/by-order";
  const query=(key,limit=7,offset=0)=>request("GET",queryBase+"?"+
    new URLSearchParams({orderCode:key,limit:String(limit),offset:String(offset)}));
  let seen=0;
  for(let offset=0;offset<20;offset+=7){
    const page=await query("TWENTY",7,offset);
    assert.equal(page.status,200,JSON.stringify(page));
    assert.equal(page.body.total,20);
    assert.equal(page.body.items.length,Math.min(7,20-offset));
    assert.ok(page.body.items.every(line=>line.orderCode==="TWENTY"));
    seen+=page.body.items.length;
  }
  assert.equal(seen,20);
  const other=await query("SUCCESS");
  assert.equal(other.body.total,3);
  assert.ok(other.body.items.every(line=>line.orderCode==="SUCCESS"));
  assert.equal((await query("TWENTY",0)).status,400);
  assert.equal((await query("TWENTY",7,-1)).status,400);
  assert.equal((await request("GET",queryBase+"?bogus=1")).status,400);
  assert.equal((await request("GET",queryBase+"?orderCode=TWENTY",undefined,{
    Authorization:basic("nobody","bad")
  })).status,401);

  const total=(code,who)=>request("GET","/api/orders/"+code+"/total",undefined,
    who?{Authorization:who}:{});
  assert.equal((await total("TWENTY")).body.totalUnits,"210",
    "SQL aggregate includes all 20 lines not just first page");
  assert.equal((await total("SUCCESS")).body.totalUnits,"9");
  assert.equal((await total("UNKNOWN")).status,404);
  assert.equal((await total("TWENTY",basic("nobody","bad"))).status,401);
  const patchPath="/api/order-lines/SUCCESS-1/product";
  const edit=(product,expected,who)=>request("PATCH",patchPath,{product,expected},
    who?{Authorization:who}:{});
  assert.equal((await edit("Autorización prohibida","Café",basic("reader",readerPassword))).status,403);
  assert.equal((await edit("bad","Café",basic("nobody","bad"))).status,401);
  assert.equal((await edit("Error sin coincidencia","Inexistente")).status,409);
  assert.equal((await edit("","Café")).status,400);
  assert.equal((await edit(null,"Café")).status,400);
  assert.equal((await edit("Cambio",null)).status,400);
  assert.equal((await edit("Café","Café")).status,409,"No-op edit must not create audit noise");
  const competing=await Promise.all([
    edit("Café tostado","Café"),edit("Café molido","Café")
  ]);
  assert.equal(competing.filter(x=>x.status===200).length,1,JSON.stringify(competing));
  assert.equal(competing.filter(x=>x.status===409).length,1,JSON.stringify(competing));
  const winning=competing.find(x=>x.status===200).body.product;
  assert.equal((await readLine("SUCCESS-1")).product,winning);
  assert.equal((await edit("Sin dato","Café")).status,409,
    "stale requests must not overwrite committed edit");
  assert.equal((await total("SUCCESS")).body.totalUnits,"9",
    "Full sum remains independent of product description changes");
  const audit=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT before_value || ':' || after_value FROM protocolia_audit_event WHERE "+
      "entity_name='OrderLine' AND resource_id='SUCCESS-1' AND field_name='product'"]);
  assert.equal(audit,"Café:"+winning,"One atomic audit row after a 2-way race");
  const simultaneous=await Promise.all(Array.from({length:10},()=>create("RACE",[
    item("RACE-1","Café",1),item("RACE-2","Te",2)])));
  assert.equal(simultaneous.filter(x=>x.status===201).length,1,JSON.stringify(simultaneous));
  assert.equal(simultaneous.filter(x=>x.status===409).length,9,JSON.stringify(simultaneous));
  const sql=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT (SELECT count(*) FROM purchase_order)::text || ':' || "+
      "(SELECT count(*) FROM order_line)::text || ':' || "+
      "(SELECT count(*) FROM order_line WHERE order_code NOT IN (SELECT code FROM purchase_order))::text"]);
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
    // Query via generated read-side of the header, not custom app-specific UI.
    await page.getByTestId("open-detail-TWENTY").click();
    await page.getByTestId("detail-lines-panel").waitFor({timeout:20000});
    const panel=page.getByTestId("detail-lines-panel");
    await panel.getByTestId("detail-lines-count").getByText("20 renglones en total").waitFor();
    assert.equal(await panel.locator("tbody tr").count(),7);
    assert.match(await panel.getByTestId("detail-lines-subtotal").innerText(),
      /en esta página/i,"Must label subtotal honestly, not imply full-document sum");
    await panel.getByTestId("detail-lines-next").click();
    await panel.getByText("8–14 de 20").waitFor();
    assert.equal(await panel.locator("tbody tr").count(),7);
    await panel.getByTestId("detail-lines-next").click();
    await panel.getByText("15–20 de 20").waitFor();
    assert.equal(await panel.locator("tbody tr").count(),6);
    await panel.getByTestId("detail-lines-prev").click();
    await panel.getByText("8–14 de 20").waitFor();
    // A different parent must not leak previous parent rows on modal reopen.
    await page.getByRole("button",{name:"Cerrar detalle"}).click();
    await page.getByTestId("open-detail-SUCCESS").click();
    await panel.getByTestId("detail-lines-count").getByText("3 renglones en total").waitFor();
    await page.getByTestId("related-sum-panel").getByTestId("related-sum-value").getByText("9").waitFor();
    assert.equal(await panel.locator("tbody tr").count(),3);
    assert.ok((await panel.locator("tbody").innerText()).includes("SUCCESS-1"));
    assert.ok(!(await panel.locator("tbody").innerText()).includes("TWENTY-"));
    await panel.getByTestId("edit-detail-SUCCESS-1").click();
    const field=panel.getByTestId("detail-inline-edit");
    await field.fill("Café premium UI");
    const editResponse=page.waitForResponse(r=>r.request().method()==="PATCH"&&
      r.url().endsWith("/api/order-lines/SUCCESS-1/product"));
    await panel.getByRole("button",{name:"Guardar",exact:true}).click();
    assert.equal((await editResponse).status(),200);
    await panel.getByText("Café premium UI").waitFor();
    assert.equal((await readLine("SUCCESS-1")).product,"Café premium UI");
    assert.equal((await total("SUCCESS")).body.totalUnits,"9");
    await page.screenshot({path:join(generated,"b14-detail-lifecycle-mobile.png"),fullPage:true});
    assert.deepEqual(errors,[],"No JavaScript runtime failure");
    console.log("PROTOCOLIA_B14_DETAIL_EDIT_CHROMIUM_PASS");
  }finally{await browser.close();}
  const after=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT (SELECT count(*) FROM purchase_order)::text || ':' || "+
      "(SELECT count(*) FROM order_line)::text"]);
  assert.equal(after,"4:27");
  console.log("PROTOCOLIA_B14_GLOBAL_SUM_CAS_PASS "+JSON.stringify({
    atomic:true,maxRowsAccepted:20,duplicateChildRollback:true,
    concurrentCreateWinners:1,concurrentConflict:9,
    uiCreatedRows:2,noOrphans:true,allPagesScoped:true,paginatedTwenty:true,wholeDocumentSum210:true,
    auditedCompareAndSet:true,oneWinnerConcurrentPatch:true
  }));
}finally{
  if(started){try{docker([...args,"down","--volumes","--remove-orphans"],30000);}catch{}}
  rmSync(temp,{recursive:true,force:true});
}
