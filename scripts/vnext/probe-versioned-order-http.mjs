#!/usr/bin/env node
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";

assert.ok(process.argv[2],"Supply generated app directory");
const dir=resolve(process.argv[2]),work=mkdtempSync(join(tmpdir(),"pia-b17-ver-"));
const project="pia_b17v_"+randomBytes(5).toString("hex");
const schema=readFileSync(existsSync(join(dir,"src/schema.sql"))?
  join(dir,"src/schema.sql"):join(dir,"src/main/resources/db/migration/V1__contract_baseline.sql"),"utf8");
assert.match(schema,/document_version INTEGER NOT NULL DEFAULT 1 CHECK \(document_version >= 1\)/);
const secret=randomBytes(20).toString("hex"),readerPass=randomBytes(20).toString("hex"),scopedPass=randomBytes(20).toString("hex");
const basic=(u,p)=>"Basic "+Buffer.from(u+":"+p).toString("base64");
function docker(params,timeout=180000){
  const r=spawnSync("docker",params,{cwd:dir,encoding:"utf8",timeout});
  if(r.status!==0||r.error)throw Error("Docker failed: "+params.join(" ")+" "+(r.stderr??r.error?.message??"").slice(-1400));
  return r.stdout.trim();
}
const openPort=()=>new Promise((done,fail)=>{const s=createServer();
  s.once("error",fail);s.listen(0,"127.0.0.1",()=>{
    const n=s.address().port;s.close(()=>done(n));
  });
});
let args=[],started=false;
try{
  const number=await openPort(),env=join(work,".env");
  writeFileSync(env,[
    "PROTOCOLIA_DB_PASSWORD="+randomBytes(20).toString("hex"),
    "PROTOCOLIA_ALLOW_DEMO_AUTH=true",
    "PROTOCOLIA_MANAGER_USERNAME=manager","PROTOCOLIA_MANAGER_PASSWORD="+secret,
    "PROTOCOLIA_READER_USERNAME=reader","PROTOCOLIA_READER_PASSWORD="+readerPass,
    "PROTOCOLIA_SCOPED_USERNAME=child_writer","PROTOCOLIA_SCOPED_PASSWORD="+scopedPass,
    "PROTOCOLIA_SCOPED_CAPABILITIES=orders.read,lines.read,lines.write",
    "PROTOCOLIA_HOST_PORT="+number
  ].join("\n")+"\n",{mode:0o600});
  args=["compose","--project-name",project,"--env-file",env];
  docker([...args,"config","--quiet"],20000);
  started=true;
  docker([...args,"up","--detach","--build"],600000);
  const base="http://127.0.0.1:"+number;
  let ready=false;
  for(let i=0;i<120;i++){
    try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(2400)})).ok){ready=true;break;}}catch{}
    await new Promise(done=>setTimeout(done,900));
  }
  assert.ok(ready,"Generated versioned app must be healthy");
  async function req(method,path,body,headers={}){
    const res=await fetch(base+path,{method,headers:{
      Authorization:basic("manager",secret),
      ...(body===undefined?{}:{"Content-Type":"application/json"}),...headers
    },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
    const raw=await res.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
    return {status:res.status,body:data,etag:res.headers.get("etag")};
  }
  const line=(lineCode,units=1)=>({lineCode,product:"Producto",units});
  const create=await req("POST","/api/orders",{
    code:"VERSIONED",title:"Orden con version",lines:[line("INITIAL")]
  });
  assert.equal(create.status,201,JSON.stringify(create));
  assert.equal(create.body.documentVersion,1);
  assert.equal(create.etag,'"1"');
  const header=async()=>req("GET","/api/orders/VERSIONED");
  const append=(lineCode,tag)=>req("POST","/api/order-lines",
    {...line(lineCode),orderCode:"VERSIONED"},tag?{"If-Match":tag}:{});
  const patch=(units,expected,tag)=>req("PATCH","/api/order-lines/INITIAL/units",
    {units,expected},tag?{"If-Match":tag}:{});
  assert.equal((await header()).etag,'"1"');
  assert.equal((await append("NO-IFMATCH")).status,400);
  for(const invalid of ['*','1','W/"1"','"0"','"2147483648"'])
    assert.equal((await append("BAD-"+invalid.replace(/[^A-Za-z0-9]/g,"").slice(0,12),invalid)).status,400);
  assert.equal((await req("POST","/api/order-lines",
    {...line("UNAUTHORIZED"),orderCode:"VERSIONED"},
    {"If-Match":'"1"',Authorization:basic("child_writer",scopedPass)})).status,403);
  assert.equal((await append("ADDED",'"1"')).status,201);
  assert.equal((await append("STALE",'"1"')).status,409);
  assert.equal((await header()).body.documentVersion,2);
  const race=await Promise.all([append("RACE-ONE",'"2"'),append("RACE-TWO",'"2"')]);
  assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
  assert.equal((await header()).body.documentVersion,3);
  assert.equal((await patch(5,1)).status,400);
  assert.equal((await patch(5,1,'"2"')).status,409);
  assert.equal((await patch(5,1,'"3"')).status,200);
  assert.equal((await header()).body.documentVersion,4);
  const product=await req("PATCH","/api/order-lines/INITIAL/product",
    {product:"Nuevo",expected:"Producto"},{"If-Match":'"4"'});
  assert.equal(product.status,200,JSON.stringify(product));
  assert.equal((await header()).body.documentVersion,5);
  const cross=await Promise.all([patch(7,5,'"5"'),append("CROSS-NEW",'"5"')]);
  assert.ok((cross[0].status===200&&cross[1].status===409)||
    (cross[0].status===409&&cross[1].status===201),
    "Append vs patch must have one winner: "+JSON.stringify(cross.map(x=>x.status)));
  const parent=await header();
  assert.equal(parent.body.documentVersion,6);
  assert.equal(parent.etag,'"6"');
  const sql=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT document_version::text || ':' || "+
      "(SELECT count(*) FROM order_line WHERE order_code='VERSIONED')::text "+
      "FROM purchase_order WHERE code='VERSIONED'"]);
  assert.match(sql,/^6:[34]$/);
  const rejects=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT count(*)::text FROM order_line WHERE line_code IN "+
      "('NO-IFMATCH','STALE','UNAUTHORIZED')"]);
  assert.equal(rejects,"0");
  // Inject a deterministic database failure in the audit step: the inserted
  // detail AND its document version must both roll back on the same connection.
  const failSql=[
    "CREATE OR REPLACE FUNCTION protocolia_test_version_audit_fail()",
    "RETURNS trigger LANGUAGE plpgsql AS $p$",
    "BEGIN IF NEW.resource_id = 'AUDIT-ROLLBACK' THEN",
    "RAISE EXCEPTION 'B17 forced audit transaction failure';",
    "END IF; RETURN NEW; END; $p$;",
    "CREATE TRIGGER protocolia_test_version_audit_fail",
    "BEFORE INSERT ON protocolia_audit_event FOR EACH ROW",
    "EXECUTE FUNCTION protocolia_test_version_audit_fail();"
  ].join(" ");
  docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-v","ON_ERROR_STOP=1","-c",failSql]);
  assert.equal((await append("AUDIT-ROLLBACK",'"6"')).status,500);
  assert.equal((await header()).body.documentVersion,6,
    "Audit exception must not increment document version");
  assert.equal((await req("GET","/api/order-lines/AUDIT-ROLLBACK")).status,404);
  assert.equal(docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT count(*)::text FROM protocolia_audit_event "+
      "WHERE resource_id='AUDIT-ROLLBACK'"]),"0");
  docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-v","ON_ERROR_STOP=1","-c",
    "DROP TRIGGER protocolia_test_version_audit_fail ON protocolia_audit_event; "+
    "DROP FUNCTION protocolia_test_version_audit_fail()"]);
  assert.equal((await append("AUDIT-ROLLBACK",'"6"')).status,201,
    "Rolled-back version must remain reusable after audit failure is repaired");
  assert.equal((await header()).body.documentVersion,7);
  // B17.3b: versioned DELETE with permission, audit, last-row floor and rollback.
  const remove=(code,tag,headers={})=>req("DELETE","/api/order-lines/"+code,undefined,{
    ...(tag==null?{}:{"If-Match":tag}),...headers
  });
  const raceLine=race[0].status===201?"RACE-ONE":"RACE-TWO";
  const beforeDeleteTotal=Number((await req("GET","/api/orders/VERSIONED/total")).body.totalUnits);
  assert.equal((await remove("INITIAL")).status,400,"Deleting a detail requires If-Match");
  assert.equal((await remove("INITIAL",'W/"7"')).status,400);
  assert.equal((await remove("INITIAL",'"6"')).status,409);
  assert.equal((await remove("INITIAL",'"7"',{
    Authorization:basic("child_writer",scopedPass)
  })).status,403,"Child writer without parent write must not delete");
  assert.equal((await req("GET","/api/order-lines/INITIAL")).status,200);
  const firstDelete=await remove("INITIAL",'"7"');
  assert.equal(firstDelete.status,204,JSON.stringify(firstDelete));
  assert.equal((await req("GET","/api/order-lines/INITIAL")).status,404);
  assert.equal((await header()).body.documentVersion,8);
  const removedQuantity=cross[0].status===200?7:5;
  assert.equal(Number((await req("GET","/api/orders/VERSIONED/total")).body.totalUnits),
    beforeDeleteTotal-removedQuantity);
  const deleteAudit=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT field_name || ':' || COALESCE(before_value,'<null>') || ':' || "+
      "COALESCE(after_value,'<null>') FROM protocolia_audit_event "+
      "WHERE operation_name='deleteOrderLine' AND resource_id='INITIAL' ORDER BY field_name"]);
  assert.equal(deleteAudit,[
    "orderCode:VERSIONED:<null>","product:Nuevo:<null>",
    "units:"+removedQuantity+":<null>"
  ].join("\n"),"DELETE audit must contain original values and empty after values");
  const deletes=await Promise.all([
    remove("ADDED",'"8"'),remove(raceLine,'"8"')
  ]);
  assert.deepEqual(deletes.map(x=>x.status).sort(),[204,409],
    "Two different details cannot both delete against the same document version");
  assert.equal((await header()).body.documentVersion,9);
  const survivingDelete=deletes[0].status===204?raceLine:"ADDED";
  assert.equal((await req("GET","/api/order-lines/"+survivingDelete)).status,200);
  const loserAudit=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT count(*)::text FROM protocolia_audit_event "+
      "WHERE operation_name='deleteOrderLine' AND resource_id IN ('ADDED','RACE-ONE','RACE-TWO')"]);
  assert.equal(loserAudit,"3","The losing delete must not generate audit events");
  const deleteFailSql=[
    "CREATE OR REPLACE FUNCTION protocolia_test_delete_audit_fail()",
    "RETURNS trigger LANGUAGE plpgsql AS $p$",
    "BEGIN IF NEW.resource_id='AUDIT-ROLLBACK' AND NEW.operation_name='deleteOrderLine'",
    "THEN RAISE EXCEPTION 'B17 forced DELETE audit failure'; END IF;",
    "RETURN NEW; END; $p$;",
    "CREATE TRIGGER protocolia_test_delete_audit_fail",
    "BEFORE INSERT ON protocolia_audit_event FOR EACH ROW",
    "EXECUTE FUNCTION protocolia_test_delete_audit_fail();"
  ].join(" ");
  docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-v","ON_ERROR_STOP=1","-c",deleteFailSql]);
  const countBeforeFailedDelete=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT count(*)::text FROM order_line WHERE order_code='VERSIONED'"]);
  assert.equal((await remove("AUDIT-ROLLBACK",'"9"')).status,500);
  assert.equal((await header()).body.documentVersion,9,"Failed audit must rollback document version");
  assert.equal((await req("GET","/api/order-lines/AUDIT-ROLLBACK")).status,200,
    "Failed audit must rollback physical DELETE");
  assert.equal(docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT count(*)::text FROM order_line WHERE order_code='VERSIONED'"]),
    countBeforeFailedDelete);
  assert.equal(docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT count(*)::text FROM protocolia_audit_event "+
      "WHERE operation_name='deleteOrderLine' AND resource_id='AUDIT-ROLLBACK'"]),"0");
  docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-v","ON_ERROR_STOP=1","-c",
    "DROP TRIGGER protocolia_test_delete_audit_fail ON protocolia_audit_event; "+
    "DROP FUNCTION protocolia_test_delete_audit_fail()"]);
  assert.equal((await remove("AUDIT-ROLLBACK",'"9"')).status,204,
    "Rolled-back version must remain usable for DELETE after auditing recovers");
  assert.equal((await header()).body.documentVersion,10);
  assert.equal((await req("GET","/api/order-lines/AUDIT-ROLLBACK")).status,404);
  const single=await req("POST","/api/orders",{
    code:"SINGLE",title:"Una línea",lines:[line("SINGLE-1")]
  });
  assert.equal(single.status,201,JSON.stringify(single));
  assert.equal((await remove("SINGLE-1",'"1"')).status,409,
    "A bounded document may not be left without its last detail");
  assert.equal((await req("GET","/api/orders/SINGLE")).body.documentVersion,1);
  assert.equal((await req("GET","/api/order-lines/SINGLE-1")).status,200);
  // B17.4: prove generated React UI on mobile, including a stale writer and
  // deliberate recovery. All mutations originate in generated controls.
  const uiCreated=await req("POST","/api/orders",{
    code:"UI-VERSION",title:"Orden en móvil",lines:[line("UI-BASE-1",2),line("UI-BASE-2",3)]
  });
  assert.equal(uiCreated.status,201,JSON.stringify(uiCreated));
  const {chromium}=await import("playwright");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:"es-AR"});
    const pageErrors=[];page.on("pageerror",error=>pageErrors.push(error.message));
    await page.goto(base+"/",{waitUntil:"domcontentloaded"});
    await page.getByTestId("username").fill("manager");
    await page.getByTestId("password").fill(secret);
    await page.getByRole("button",{name:"Entrar"}).click();
    await page.getByRole("button",{name:"Órdenes",exact:true}).waitFor({timeout:30000});
    await page.getByRole("button",{name:"Órdenes",exact:true}).click();
    await page.getByTestId("open-detail-UI-VERSION").click();
    const panel=page.getByTestId("detail-lines-panel");
    await panel.getByTestId("detail-document-version").getByText("1",{exact:true}).waitFor({timeout:20000});
    await panel.getByTestId("detail-lines-count").getByText("2 renglones en total").waitFor();
    await panel.getByTestId("edit-detail-UI-BASE-1-product").click();
    await panel.getByTestId("detail-inline-edit").fill("Editado desde la pantalla");
    assert.equal((await req("POST","/api/order-lines",{
      ...line("EXTERNAL",1),orderCode:"UI-VERSION"
    },{"If-Match":'"1"'})).status,201);
    const stale=page.waitForResponse(r=>r.request().method()==="PATCH"&&
      r.url().endsWith("/api/order-lines/UI-BASE-1/product"));
    await panel.getByRole("button",{name:"Guardar",exact:true}).click();
    const staleReply=await stale;
    assert.equal(staleReply.status(),409);
    assert.equal(staleReply.request().headers()["if-match"],'"1"');
    await panel.getByTestId("detail-version-conflict").waitFor();
    await panel.getByTestId("detail-conflict-refresh").click();
    await panel.getByTestId("detail-document-version").getByText("2",{exact:true}).waitFor();
    await panel.getByTestId("detail-version-conflict").waitFor({state:"detached"});
    const patchResponse=page.waitForResponse(r=>r.request().method()==="PATCH"&&
      r.url().endsWith("/api/order-lines/UI-BASE-1/product"));
    await panel.getByRole("button",{name:"Guardar",exact:true}).click();
    const patched=await patchResponse;
    assert.equal(patched.status(),200);
    assert.equal(patched.request().headers()["if-match"],'"2"');
    await panel.getByTestId("detail-document-version").getByText("3",{exact:true}).waitFor();
    assert.equal((await req("GET","/api/order-lines/UI-BASE-1")).body.product,
      "Editado desde la pantalla");
    await panel.getByTestId("detail-append-open").click();
    const form=panel.getByTestId("detail-append-form");
    await form.getByTestId("create-lineCode").fill("UI-ADDED");
    await form.getByTestId("create-product").fill("Nuevo renglón");
    await form.getByTestId("create-units").fill("4");
    const addReply=page.waitForResponse(r=>r.request().method()==="POST"&&
      r.url().endsWith("/api/order-lines"));
    await form.getByTestId("detail-append-submit").click();
    const added=await addReply;
    assert.equal(added.status(),201);
    assert.equal(added.request().headers()["if-match"],'"3"');
    await panel.getByTestId("detail-document-version").getByText("4",{exact:true}).waitFor();
    assert.equal((await req("GET","/api/order-lines/UI-ADDED")).body.orderCode,"UI-VERSION");
    await panel.getByTestId("delete-detail-UI-BASE-2").click();
    const deleteReply=page.waitForResponse(r=>r.request().method()==="DELETE"&&
      r.url().endsWith("/api/order-lines/UI-BASE-2"));
    await panel.getByTestId("confirm-delete-detail-UI-BASE-2").click();
    const removed=await deleteReply;
    assert.equal(removed.status(),204);
    assert.equal(removed.request().headers()["if-match"],'"4"');
    await panel.getByTestId("detail-document-version").getByText("5",{exact:true}).waitFor();
    assert.equal((await req("GET","/api/order-lines/UI-BASE-2")).status,404);
    assert.equal((await req("GET","/api/orders/UI-VERSION/total")).body.totalUnits,"7");
    const styles=await panel.evaluate(node=>({
      scrollWidth:node.scrollWidth,clientWidth:node.clientWidth
    }));
    assert.ok(styles.clientWidth>0);
    await page.screenshot({path:join(dir,"b17-versioned-mobile.png"),fullPage:true});
    // Preserve the invariant in the presentation as well as the API: the
    // final row may not expose an enabled Delete action.
    await page.getByRole("button",{name:"Cerrar detalle"}).click();
    await page.getByTestId("open-detail-SINGLE").click();
    const singlePanel=page.getByTestId("detail-lines-panel");
    await singlePanel.getByTestId("detail-document-version").getByText("1",{exact:true}).waitFor();
    assert.equal(await singlePanel.getByTestId("delete-detail-SINGLE-1").isDisabled(),true);
    await page.getByRole("button",{name:"Cerrar detalle"}).click();
    // The UI must not expose append/delete to an actor who can write child
    // fields but cannot write parent headers. Server-side enforcement is
    // independently proven by the B17.3b HTTP suite above.
    await page.getByRole("button",{name:"Cerrar sesión"}).click();
    await page.getByTestId("username").fill("child_writer");
    await page.getByTestId("password").fill(scopedPass);
    await page.getByRole("button",{name:"Entrar"}).click();
    await page.getByRole("button",{name:"Órdenes",exact:true}).waitFor();
    await page.getByRole("button",{name:"Órdenes",exact:true}).click();
    await page.getByTestId("open-detail-UI-VERSION").click();
    const scopedPanel=page.getByTestId("detail-lines-panel");
    await scopedPanel.getByTestId("detail-document-version").getByText("5",{exact:true}).waitFor();
    assert.equal(await scopedPanel.getByTestId("detail-append-open").count(),0);
    assert.equal(await scopedPanel.getByTestId("delete-detail-UI-BASE-1").count(),0);
    await page.getByRole("button",{name:"Cerrar detalle"}).click();
    await page.getByRole("button",{name:"Cerrar sesión"}).click();
    await page.getByTestId("username").fill("manager");
    await page.getByTestId("password").fill(secret);
    await page.getByRole("button",{name:"Entrar"}).click();
    await page.getByRole("button",{name:"Órdenes",exact:true}).waitFor();
    await page.getByRole("button",{name:"Órdenes",exact:true}).click();
    await page.getByTestId("open-detail-UI-VERSION").click();
    const closingPanel=page.getByTestId("detail-lines-panel");
    await closingPanel.getByTestId("detail-document-version").getByText("5",{exact:true}).waitFor();
    const browserClose=page.waitForResponse(r=>r.request().method()==="POST"&&
      r.url().endsWith("/api/orders/UI-VERSION/close"));
    await page.getByTestId("transition-closePurchaseOrder").click();
    const closedResponse=await browserClose;
    assert.equal(closedResponse.status(),200);
    assert.equal(closedResponse.request().headers()["if-match"],'"5"');
    await closingPanel.getByTestId("detail-document-closed").waitFor();
    await closingPanel.getByTestId("detail-document-version").getByText("6",{exact:true}).waitFor();
    assert.equal(await closingPanel.getByTestId("detail-append-open").isDisabled(),true);
    assert.equal(await closingPanel.getByTestId("delete-detail-UI-BASE-1").isDisabled(),true);
    assert.equal(await closingPanel.getByTestId("edit-detail-UI-BASE-1-product").isDisabled(),true);
    assert.equal((await req("GET","/api/orders/UI-VERSION")).body.status,"closed");
    assert.deepEqual(pageErrors,[],"React must have no JavaScript runtime error");
    console.log("PROTOCOLIA_B17_VERSIONED_REACT_PASS "+JSON.stringify({
      mobileViewport390:true,stalePatch409:true,
      conflictRecoveryRefresh:true,generatedPatch:true,generatedAppend:true,
      generatedDelete:true,strongIfMatchForwarded:true,
      totalsUpdated:true,lastRowDeleteDisabled:true,capabilityActionsHidden:true,
      terminalCloseUi:true,closedDocumentUiReadOnly:true,
      consoleErrorsNone:true
    }));
  }finally{await browser.close();}
  // B17.5a — closing a document is an audited, terminal transition
  // protected by the same parent lock and If-Match across all mutations.
  const makeOrder=(code,rows)=>req("POST","/api/orders",{
    code,title:"Cierre versionado",lines:rows
  });
  const close=(code,tag,headers={})=>req("POST","/api/orders/"+code+"/close",
    undefined,{...(tag?{"If-Match":tag}:{}),...headers});
  assert.equal((await makeOrder("TO-CLOSE",[line("CLOSE-1",2),line("CLOSE-2",4)])).status,201);
  assert.equal((await close("TO-CLOSE")).status,400,
    "Closing requires a strong If-Match");
  assert.equal((await close("TO-CLOSE",'W/"1"')).status,400);
  const scopedClose=await close("TO-CLOSE",'"1"',{
    Authorization:basic("child_writer",scopedPass)
  });
  assert.equal(scopedClose.status,403,"Only the parent writer can close");
  const finalized=await close("TO-CLOSE",'"1"');
  assert.equal(finalized.status,200,JSON.stringify(finalized));
  assert.equal(finalized.body.status,"closed");
  assert.equal(finalized.body.documentVersion,2);
  const closedHeader=await req("GET","/api/orders/TO-CLOSE");
  assert.equal(closedHeader.body.status,"closed");
  assert.equal(closedHeader.body.documentVersion,2);
  assert.equal(closedHeader.etag,'"2"');
  assert.equal((await close("TO-CLOSE",'"1"')).status,409);
  assert.equal((await close("TO-CLOSE",'"2"')).status,409,
    "A terminal document cannot be closed again even with its current version");
  const closedAppend=await req("POST","/api/order-lines",{
    ...line("CLOSE-APPEND",2),orderCode:"TO-CLOSE"
  },{"If-Match":'"2"'});
  assert.equal(closedAppend.status,409,"Append must be rejected after close");
  assert.equal((await req("PATCH","/api/order-lines/CLOSE-1/units",
    {units:5,expected:2},{"If-Match":'"2"'})).status,409,
    "Audited PATCH must be rejected after close");
  assert.equal((await req("DELETE","/api/order-lines/CLOSE-2",
    undefined,{"If-Match":'"2"'})).status,409,
    "Audited DELETE must be rejected after close");
  assert.equal((await req("GET","/api/orders/TO-CLOSE/total")).body.totalUnits,"6");
  assert.equal((await req("GET","/api/order-lines/CLOSE-2")).status,200);
  const closeAudit=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT field_name || ':' || before_value || ':' || after_value "+
      "FROM protocolia_audit_event WHERE entity_name='PurchaseOrder' "+
      "AND operation_name='closePurchaseOrder' AND resource_id='TO-CLOSE'"]);
  assert.equal(closeAudit,"status:draft:closed");
  // Concurrent close/append with exactly one matching ETag: one succeeds.
  assert.equal((await makeOrder("CLOSE-RACE",[line("CLOSE-RACE-1")])).status,201);
  const closureRace=await Promise.all([
    close("CLOSE-RACE",'"1"'),
    req("POST","/api/order-lines",{
      ...line("CLOSE-RACE-2"),orderCode:"CLOSE-RACE"
    },{"If-Match":'"1"'})
  ]);
  assert.ok((closureRace[0].status===200&&closureRace[1].status===409)||
    (closureRace[0].status===409&&closureRace[1].status===201),
    "Close/append must arbitrate a shared version: "+
    JSON.stringify(closureRace.map(x=>x.status)));
  const raceDoc=await req("GET","/api/orders/CLOSE-RACE");
  assert.equal(raceDoc.body.documentVersion,2);
  const raceRows=docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT count(*)::text FROM order_line WHERE order_code='CLOSE-RACE'"]);
  assert.equal(raceRows,closureRace[0].status===200?"1":"2");
  if(closureRace[0].status===200){
    assert.equal((await req("POST","/api/order-lines",{
      ...line("CLOSE-RACE-3"),orderCode:"CLOSE-RACE"
    },{"If-Match":'"2"'})).status,409);
  }else{
    assert.equal((await close("CLOSE-RACE",'"2"')).status,200);
    assert.equal((await req("GET","/api/orders/CLOSE-RACE")).body.documentVersion,3);
  }
  // Forced PostgreSQL failure during close audit must revert status/version
  // and make the exact same If-Match reusable on the next attempt.
  assert.equal((await makeOrder("CLOSE-ROLLBACK",[line("CLOSE-ROLLBACK-1")])).status,201);
  const failCloseSql=[
    "CREATE OR REPLACE FUNCTION protocolia_test_close_audit_fail()",
    "RETURNS trigger LANGUAGE plpgsql AS $p$",
    "BEGIN IF NEW.resource_id='CLOSE-ROLLBACK' AND NEW.operation_name='closePurchaseOrder'",
    "THEN RAISE EXCEPTION 'B17 forced closing audit failure'; END IF;",
    "RETURN NEW; END; $p$;",
    "CREATE TRIGGER protocolia_test_close_audit_fail",
    "BEFORE INSERT ON protocolia_audit_event FOR EACH ROW",
    "EXECUTE FUNCTION protocolia_test_close_audit_fail();"
  ].join(" ");
  docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-v","ON_ERROR_STOP=1","-c",failCloseSql]);
  assert.equal((await close("CLOSE-ROLLBACK",'"1"')).status,500);
  const reverted=await req("GET","/api/orders/CLOSE-ROLLBACK");
  assert.equal(reverted.body.status,"draft");
  assert.equal(reverted.body.documentVersion,1);
  assert.equal(docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-Atc","SELECT count(*)::text FROM protocolia_audit_event "+
      "WHERE operation_name='closePurchaseOrder' AND resource_id='CLOSE-ROLLBACK'"]),"0");
  docker([...args,"exec","-T","db","psql","-U","protocolia","-d","protocolia",
    "-v","ON_ERROR_STOP=1","-c",
    "DROP TRIGGER protocolia_test_close_audit_fail ON protocolia_audit_event; "+
    "DROP FUNCTION protocolia_test_close_audit_fail()"]);
  const retried=await close("CLOSE-ROLLBACK",'"1"');
  assert.equal(retried.status,200);
  assert.equal(retried.body.documentVersion,2);
  assert.equal(retried.body.status,"closed");
  console.log("PROTOCOLIA_B17_TERMINAL_DOCUMENT_PASS "+JSON.stringify({
    strongIfMatchRequired:true,parentWriteRequired:true,
    auditableClose:true,closePreventsAppend:true,closePreventsPatch:true,
    closePreventsDelete:true,closeVersusAppendOneWinner:true,
    auditRollbackPreservesDraft:true,retrySameVersionAfterRollback:true
  }));
  console.log("PROTOCOLIA_B17_VERSIONED_DELETE_PASS "+JSON.stringify({
    bothCapabilitiesRequired:true,ifMatchRequired:true,auditedBeforeValues:true,
    lastRowGuarded:true,concurrentDeletesOneWinner:true,
    failedAuditRollsBackDeletion:true,failedAuditRollsBackVersion:true,
    sqlAggregateUpdated:true
  }));
  console.log("PROTOCOLIA_B17_VERSIONED_DETAILS_PASS "+JSON.stringify({
    persisted:true,strongIfMatch:true,staleAppendConflict:true,concurrentAppendOneWinner:true,
    auditedPatchVersioned:true,appendVsPatchOneWinner:true,versionEtag:true,parentPermission:true,
    failedAuditRollsBackVersion:true
  }));
}finally{
  if(started)try{docker([...args,"down","--volumes","--remove-orphans"],120000);}catch(e){console.error(String(e));}
  rmSync(work,{recursive:true,force:true});
}
