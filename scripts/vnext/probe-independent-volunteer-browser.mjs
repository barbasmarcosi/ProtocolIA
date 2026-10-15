// Real Chromium proof of the generic generated React FK-creation path.
// Independent, fictional volunteer-evaluation requirements; no handwritten app code.
// This is intentionally run against a freshly generated Docker Compose + PostgreSQL app.
import assert from "node:assert/strict";
import {chromium} from "playwright";
import {join} from "node:path";

export async function verifyGeneratedFkBrowser({base,manager,managerPassword,token,req,generated}){
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:1365,height:900},locale:"es-AR"});
  const pageErrors=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  const id=suffix=>"UI"+token+"-"+suffix;
  const nav=()=>page.getByRole("navigation",{name:"Secciones de la aplicación"});
  async function navigate(title,entity){
    await nav().getByRole("button",{name:title,exact:true}).click();
    await page.getByTestId("open-create").click();
    await page.getByRole("dialog",{name:"Nuevo registro"}).waitFor({state:"visible",timeout:10000});
    const form=page.getByTestId("create-form-"+entity);
    await form.waitFor({state:"visible",timeout:20000});
    if(entity==="Volunteer"){
      await form.getByText("Guardia asignada",{exact:true}).waitFor();
      await form.getByText("Podés reasignarla más adelante desde el detalle.").waitFor();
      const help=await form.getByTestId("create-guardCode").getAttribute("aria-describedby");
      assert.ok(help?.length>0,"Generated reference picker exposes the contract hint to assistive technology");
    }
    if(entity==="MonthlyEvaluation"){
      await form.getByText("Período de evaluación",{exact:true}).waitFor();
      await form.getByText("Seleccioná el mes de la evaluación.").waitFor();
      const help=await form.getByTestId("create-period").getAttribute("aria-describedby");
      assert.ok(help?.length>0,"Generated month input uses contract help in accessible description");
    }
    return form;
  }
  async function create({tab,entity,endpoint,key,fields,fk={}}){
    const form=await navigate(tab,entity);
    for(const [field,value] of Object.entries(fields)){
      const input=form.getByTestId("create-"+field);
      if(Object.hasOwn(fk,field)){
        const expected=String(value);
        // Generated accessible picker renders readable names and stores the exact FK key.
        await input.waitFor({state:"visible",timeout:20000});
        await input.click();
        const option=page.getByRole("option").filter({hasText:expected}).first();
        await option.waitFor({state:"visible",timeout:20000});
        await option.click();
        // Closing the nested picker must not dismiss the parent Radix dialog.
        await input.click();
        await page.getByRole("listbox").waitFor({state:"visible"});
        await page.keyboard.press("Escape");
        await page.getByRole("listbox").waitFor({state:"hidden"});
        assert.equal(await page.getByTestId("create-dialog").isVisible(),true,
          "Escape closes the dropdown alone, not the enclosing creation dialog");
        assert.equal(await input.getAttribute("data-selected-key"),expected,
          entity+"."+field+" must store exactly the declared public identity");
        assert.equal(await page.getByRole("listbox").count(),0,
          "Selecting an option dismisses only the popover, not its parent dialog");
        assert.equal(await page.getByTestId("create-dialog").isVisible(),true,
          "The parent form remains open after choosing a relation");
      }else{
        await input.fill(String(value));
      }
    }
    const resourceId=String(fields[key]);
    const responsePromise=page.waitForResponse(r=>r.request().method()==="POST"&&
      new URL(r.url()).pathname===endpoint,{timeout:20000});
    await form.getByRole("button",{name:"Crear",exact:true}).click();
    const response=await responsePromise;
    assert.equal(response.status(),201,entity+" created through UI, got "+response.status()+": "+
      (await response.text()).slice(0,500));
    await page.getByTestId("create-dialog").waitFor({state:"hidden",timeout:15000});
    const row=page.getByRole("row").filter({hasText:resourceId});
    await row.waitFor({timeout:15000});
    const lookup=await req(endpoint+"/"+encodeURIComponent(resourceId),{as:"reader"});
    assert.equal(lookup.status,200,entity+" persisted via UI/API");
    for(const [field,value] of Object.entries(fields))
      assert.equal(lookup.body[field],value,entity+"."+field+" persisted as selected/entered");
    return {row,stored:lookup.body};
  }
  try{
    await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:30000});
    // Hold the first authorized FK-list response to verify a visible and accessible
    // asynchronous loading affordance rather than a static "Cargando..." string.
    let gatedFkRequest=0;
    await page.route(/\/api\/sections\?limit=50&offset=0$/,async route=>{
      gatedFkRequest++;
      if(gatedFkRequest===1)await new Promise(resolve=>setTimeout(resolve,1600));
      await route.continue();
    });
    await page.getByTestId("username").fill(manager);
    await page.getByTestId("password").fill(managerPassword);
    const login=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/_protocolia/me");
    await page.getByRole("button",{name:"Entrar",exact:true}).click();
    assert.equal((await login).status(),200,"Browser authentication must succeed");
    await nav().waitFor({timeout:15000});

    // Before creating the parent, the FK field and create action must be blocked
    // with a visible explanatory status rather than a silent invalid submit.
    let form=await navigate("Guardias","GuardDuty");
    const initialFK=form.getByTestId("create-sectionCode");
    await form.getByRole("status").filter({hasText:/Cargando/i}).first()
      .waitFor({state:"visible",timeout:12000});
    assert.equal(await form.locator(".loading-spinner").count(),1,
      "A visible motion-safe spinner accompanies async relation loading");
    await form.getByText(/Primero creá un registro de/).waitFor({timeout:10000});
    assert.equal(await initialFK.isDisabled(),true,"FK selector disabled until parent records exist");
    assert.equal(await form.getByRole("button",{name:"Crear",exact:true}).isDisabled(),true,
      "No silent child creation when related list is empty");
    await page.getByRole("button",{name:"Cancelar",exact:true}).click();
    await page.getByTestId("create-dialog").waitFor({state:"hidden"});

    const section=id("SEC"),guard=id("GUARD"),badge=id("PERSON"),evaluation=id("EVAL");
    await create({tab:"Secciones",entity:"Section",endpoint:"/api/sections",key:"code",
      fields:{code:section,name:"Seccion ficticia UI"}});
    const guardCreated=await create({tab:"Guardias",entity:"GuardDuty",endpoint:"/api/guards",key:"code",
      fields:{code:guard,sectionCode:section,name:"Guardia ficticia UI"},fk:{sectionCode:true}});
    assert.match(await guardCreated.row.innerText(),/Seccion ficticia UI/,
      "Generated relation column shows a human label, not only the foreign key");
    assert.equal(await guardCreated.row.locator("td[title]").count(),0,
      "Generated table does not expose confusing native cell tooltips");
    await page.getByText("Registro creado correctamente.").waitFor({timeout:5000});
    await create({tab:"Personal",entity:"Volunteer",endpoint:"/api/volunteers",key:"badge",
      fields:{badge,guardCode:guard,name:"Persona ficticia UI",rank:"Aspirante"},fk:{guardCode:true}});
    const replacementGuard=id("NEWGUARD");
    await create({tab:"Guardias",entity:"GuardDuty",endpoint:"/api/guards",key:"code",
      fields:{code:replacementGuard,sectionCode:section,name:"Guardia alternativa UI"},fk:{sectionCode:true}});
    // The former native reassign dropdown was a separate unpolished UI path.
    // Both create and reassign must now share the generated accessible reference picker.
    await nav().getByRole("button",{name:"Personal",exact:true}).click();
    const volunteerRow=page.getByRole("row").filter({hasText:badge});
    await volunteerRow.getByRole("button",{name:"Detalle"}).click();
    const volunteerModal=page.getByRole("dialog",{name:"Detalle: "+badge});
    await volunteerModal.waitFor({state:"visible"});
    const reassignment=volunteerModal.getByTestId("reassign-reference");
    const changePicker=reassignment.getByTestId("create-guardCode");
    await changePicker.click();
    await page.getByRole("listbox").waitFor({state:"visible"});
    await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({state:"hidden"});
    assert.equal(await volunteerModal.isVisible(),true,"Escape closes reassign picker but retains record dialog");
    await changePicker.click();
    await page.getByRole("option").filter({hasText:replacementGuard}).click();
    assert.equal(await changePicker.getAttribute("data-selected-key"),replacementGuard,
      "Reassignment selects the immutable public reference ID");
    await changePicker.hover();
    assert.equal(await changePicker.evaluate(el=>getComputedStyle(el).backgroundColor),
      "rgb(255, 255, 255)","Hovered picker must never inherit an unreadable primary CTA background");
    assert.equal(await changePicker.evaluate(el=>getComputedStyle(el).color),
      "rgb(21, 35, 58)","Hovered picker retains readable foreground color");
    const patchResponse=page.waitForResponse(response=>
      response.request().method()==="PATCH"&&
      new URL(response.url()).pathname==="/api/volunteers/"+encodeURIComponent(badge)+"/guard",
      {timeout:15000});
    await reassignment.getByTestId("confirm-reassign").click();
    assert.equal((await patchResponse).status(),200,"Generated reassignment is successful");
    await volunteerModal.getByText("Asignación actualizada correctamente.").waitFor({timeout:10000});
    assert.equal((await req("/api/volunteers/"+encodeURIComponent(badge),{as:"reader"})).body.guardCode,
      replacementGuard,"Updated association persisted via CAS to Postgres");
    await volunteerModal.screenshot({path:join(generated,"protocolia-generated-detail-desktop.png")});
    await volunteerModal.getByRole("button",{name:"Cerrar detalle"}).click();
    await volunteerModal.waitFor({state:"hidden"});
    await page.screenshot({path:join(generated,"protocolia-generated-list-desktop.png"),fullPage:true});
    form=await navigate("Calificaciones mensuales","MonthlyEvaluation");
    assert.equal(await form.getByTestId("create-basePoints").count(),0,
      "Computed basePoints must never be an editable/form-submitted input");
    assert.equal(await form.getByTestId("create-status").count(),0,
      "Contract-defined initial status is not an editable user field");
    assert.equal(await form.getByTestId("create-period").getAttribute("type"),"month",
      "YYYY-MM periods are generated as month controls, not unstructured text");
    await form.getByTestId("create-number").fill(id("INVALID"));
    await form.getByTestId("create-period").fill("2026-09");
    await form.getByTestId("create-incidentPoints").fill("26");
    await form.getByRole("button",{name:"Crear",exact:true}).click();
    await form.getByText("El máximo permitido es 25.").waitFor({timeout:6000});
    assert.equal(await form.getByTestId("create-incidentPoints").getAttribute("aria-invalid"),"true",
      "Business contract violations visibly identify the offending input");
    assert.equal((await req("/api/monthly-evaluations/"+id("INVALID"),{as:"reader"})).status,404,
      "Client-side contract validation prevents invalid API writes");
    await page.getByRole("dialog",{name:"Nuevo registro"}).getByRole("button",{name:"Cancelar"}).click();
    await page.getByTestId("create-dialog").waitFor({state:"hidden"});
    await page.waitForFunction(()=>document.activeElement?.getAttribute("data-testid")==="open-create",
      null,{timeout:5000});
    assert.equal(await page.getByTestId("open-create").evaluate(el=>document.activeElement===el),true,
      "Close new-record modal returns focus to the Nuevo action");
    const created=await create({tab:"Calificaciones mensuales",entity:"MonthlyEvaluation",
      endpoint:"/api/monthly-evaluations",key:"number",
      fields:{number:evaluation,volunteerBadge:badge,period:"2026-09",
        incidentPoints:5,mandatoryPoints:35,guardPoints:20,internalPoints:20,otherPoints:0},
      fk:{volunteerBadge:true}});
    assert.equal(created.stored.basePoints,80,"DB-derived 80 visible through GET after form submit");
    const rowText=await created.row.innerText();
    assert.match(rowText,/\b80\b/,"Generated table displays the database-computed score");
    assert.equal(await created.row.locator("td[title]").count(),0,
      "No browser-native debug tooltip on generated table data");
    const opener=created.row.getByRole("button",{name:"Detalle"});
    await opener.scrollIntoViewIfNeeded();
    const scrollBefore=await page.evaluate(()=>window.scrollY);
    await opener.click();
    const modal=page.getByRole("dialog",{name:"Detalle: "+evaluation});
    await modal.waitFor({state:"visible",timeout:10000});
    assert.equal(await modal.getAttribute("aria-modal"),"true","Detail is a proper modal");
    assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]'))),true,
      "Focus moves inside detail modal");
    const details=await modal.locator("dl").first().innerText();
    assert.match(details,/Base puntos\s+80/,"Generated detail modal shows computed base score");
    const transition=modal.getByTestId("transition-closeMonthlyEvaluation");
    await transition.waitFor({state:"visible",timeout:8000});
    assert.match(await transition.innerText(),/Cerrar registro\s+Estado nuevo: Cerrado/,
      "Generated state transition uses intelligible Spanish action/status");
    for(let i=0;i<8;i++){
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]'))),true,
        "Keyboard focus remains inside modal");
    }
    await page.keyboard.press("Escape");
    await modal.waitFor({state:"hidden"});
    await page.waitForFunction(expected=>document.activeElement?.getAttribute("data-testid")===expected,
      "open-detail-"+evaluation,{timeout:5000});
    assert.equal(await opener.evaluate(el=>el===document.activeElement),true,
      "Closing detail returns focus to the original table row action");
    const scrollAfter=await page.evaluate(()=>window.scrollY);
    assert.ok(Math.abs(scrollAfter-scrollBefore)<10,"Opening and closing detail preserves list scroll position");
    await page.setViewportSize({width:390,height:780});
    await opener.click();
    await modal.waitFor({state:"visible"});
    await page.screenshot({path:join(generated,"protocolia-generated-detail-mobile.png"),fullPage:true});
    const mobile=await modal.evaluate(el=>({width:el.getBoundingClientRect().width,
      viewport:window.innerWidth,height:el.getBoundingClientRect().height,
      viewportHeight:window.innerHeight,
      internalScroll:getComputedStyle(el.querySelector(".modal-scroll")).overflowY}));
    assert.ok(Math.abs(mobile.width-mobile.viewport)<2,"Mobile dialog uses full-screen width");
    assert.ok(mobile.height<=mobile.viewportHeight,"Mobile dialog fits viewport");
    assert.equal(mobile.internalScroll,"auto","Long modal content scrolls internally, not behind");
    await modal.getByRole("button",{name:"Cerrar detalle"}).click();
    await modal.waitFor({state:"hidden"});
    assert.equal(pageErrors.length,0,"Browser JavaScript exceptions: "+pageErrors.join("; "));
    console.log("BV_GENERATED_NATIVE_FK_BROWSER_PASS "+JSON.stringify({
      browser:"Chromium Playwright",entities:["Section","GuardDuty","Volunteer","MonthlyEvaluation"],
      fks:["GuardDuty.sectionCode","Volunteer.guardCode","MonthlyEvaluation.volunteerBadge"],
      emptyReferenceBlocked:true,computedBasePoints:80,detailModal:true,
      compiledFieldMetadata:true,accessibleFieldHints:true,
      reassignPicker:true,confirmedCasReferenceUpdate:true,
      preservedScroll:true,focusRestored:true,mobileInternalScroll:true,clientJavascriptErrors:0
    }));
  }catch(error){
    try{const screenshot=join(generated,"protocolia-fk-browser-failure.png");
      await page.screenshot({path:screenshot,fullPage:true,timeout:10000});
      console.error("BV_BROWSER_SCREENSHOT "+screenshot);
    }catch{}
    throw Error("BV_GENERATED_NATIVE_FK_BROWSER_FAIL "+error.message+
      (pageErrors.length?" browser errors="+pageErrors.join("; "):""));
  }finally{
    await browser.close();
  }
}
