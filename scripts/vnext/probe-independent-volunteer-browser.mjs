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
      assert.equal(await form.getByTestId("create-name").getAttribute("placeholder"),"Nombre y apellido",
        "Generated placeholder follows the TypeSpec contract");
      await form.getByText(/^Guardia asignada\s*\*$/).waitFor();
      await form.getByText("Podés reasignarla más adelante desde el detalle.").waitFor();
      const help=await form.getByTestId("create-guardCode").getAttribute("aria-describedby");
      assert.ok(help?.length>0,"Generated reference picker exposes the contract hint to assistive technology");
    }
    if(entity==="MonthlyEvaluation"){
      const groups=form.locator(".form-section");
      assert.deepEqual(await groups.locator("h3").allTextContents(),["Identificación","Puntajes"],
        "Accessible form section headings follow TypeSpec metadata");
      assert.deepEqual(await groups.first().locator('[data-testid^="create-"]').evaluateAll(
        nodes=>nodes.map(node=>node.getAttribute("data-testid"))),
        ["create-number","create-volunteerBadge","create-period"],
        "Identity grouping retains the input order");
      await form.getByText(/^Período de evaluación\s*\*$/).waitFor();
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
        // Selecting a value must close the menu and retain the full dialog.
        // Nested Escape/reopen is exercised separately in the dedicated
        // reassignment workflow, avoiding a portal close/open timing race here.
        await page.getByRole("listbox").waitFor({state:"hidden"});
        assert.equal(await page.getByTestId("create-dialog").isVisible(),true,
          "Selection closes only the dropdown, not the enclosing dialog");
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
    await page.goto(base+"/?resource=GuardDuty",{waitUntil:"domcontentloaded",timeout:30000});
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
    assert.equal(new URL(page.url()).searchParams.get("resource"),"GuardDuty",
      "A direct resource URL loads the declared resource, not the default table");
    await page.getByRole("heading",{level:1,name:"Guardias"}).waitFor();

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
    // Generated form must require an explicit decision before discarding edits.
    const draft=await navigate("Secciones","Section");
    const draftCode=id("UNSAVED");
    await draft.getByTestId("create-code").fill(draftCode);
    await draft.getByTestId("create-name").fill("Borrador ficticio sin guardar");
    await draft.getByRole("button",{name:"Cancelar",exact:true}).click();
    const discardPrompt=page.getByTestId("unsaved-changes-confirmation");
    await discardPrompt.waitFor({state:"visible",timeout:7000});
    assert.equal(await page.getByTestId("create-dialog").isVisible(),true,
      "Cancel on dirty draft keeps the modal open until explicitly confirmed");
    await discardPrompt.screenshot({path:join(generated,"protocolia-generated-draft-warning-desktop.png")});
    await page.setViewportSize({width:390,height:780});
    await discardPrompt.screenshot({path:join(generated,"protocolia-generated-draft-warning-mobile.png")});
    await page.setViewportSize({width:1365,height:900});
    await page.keyboard.press("Escape");
    await discardPrompt.waitFor({state:"hidden",timeout:7000});
    assert.equal(await draft.getByTestId("create-code").inputValue(),draftCode,
      "Escape in confirmation returns to the preserved form");
    assert.equal(await draft.getByTestId("create-name").inputValue(),"Borrador ficticio sin guardar");
    await page.getByRole("button",{name:"Cerrar creación"}).click();
    await discardPrompt.waitFor({state:"visible"});
    await discardPrompt.getByRole("button",{name:"Seguir editando"}).click();
    await discardPrompt.waitFor({state:"hidden"});
    assert.equal(await draft.getByTestId("create-code").inputValue(),draftCode,
      "Explicitly continuing restores all draft fields");
    await draft.getByRole("button",{name:"Cancelar",exact:true}).click();
    await discardPrompt.getByRole("button",{name:"Descartar cambios"}).click();
    await page.getByTestId("create-dialog").waitFor({state:"hidden"});
    assert.equal((await req("/api/sections/"+encodeURIComponent(draftCode))).status,404,
      "Discarding unsubmitted changes never mutates PostgreSQL");
    await page.waitForFunction(()=>document.activeElement?.getAttribute("data-testid")==="open-create",
      {timeout:5000});
    assert.equal(await page.getByTestId("open-create").evaluate(el=>el===document.activeElement),true,
      "Focus returns to the invoking create action after modal auto-focus cleanup");
    // UX9: generated navigation is shareable and history-aware; Back/Forward
    // must never discard a live create draft, even across different resources.
    const routeName=()=>new URL(page.url()).searchParams.get("resource");
    assert.equal(routeName(),"Section");
    await nav().getByRole("button",{name:"Guardias",exact:true}).click();
    assert.equal(routeName(),"GuardDuty","Changing resource updates the browser URL");
    await nav().getByRole("button",{name:"Secciones",exact:true}).click();
    assert.equal(routeName(),"Section");
    await page.evaluate(()=>window.history.back());
    await page.waitForFunction(()=>new URL(location.href).searchParams.get("resource")==="GuardDuty");
    await page.getByRole("heading",{level:1,name:"Guardias"}).waitFor();
    await page.evaluate(()=>window.history.forward());
    await page.waitForFunction(()=>new URL(location.href).searchParams.get("resource")==="Section");
    await page.getByRole("heading",{level:1,name:"Secciones"}).waitFor();
    const routeDraft=await navigate("Secciones","Section"),routeCode=id("ROUTEDRAFT");
    await routeDraft.getByTestId("create-code").fill(routeCode);
    await routeDraft.getByTestId("create-name").fill("Borrador preservado en historial");
    await page.evaluate(()=>window.history.back());
    await discardPrompt.waitFor({state:"visible",timeout:7000});
    assert.equal(await routeDraft.getByTestId("create-code").count(),0,
      "The confirmation replaces the inputs while preserving their values");
    assert.equal(await page.getByTestId("create-dialog").isVisible(),true);
    await discardPrompt.getByRole("button",{name:"Seguir editando"}).click();
    await page.waitForFunction(()=>new URL(location.href).searchParams.get("resource")==="Section");
    await discardPrompt.waitFor({state:"hidden"});
    assert.equal(await routeDraft.getByTestId("create-code").inputValue(),routeCode,
      "Cancelling Back retains the resource and original form values");
    await page.evaluate(()=>window.history.back());
    await discardPrompt.waitFor({state:"visible"});
    await discardPrompt.getByRole("button",{name:"Descartar cambios"}).click();
    await page.waitForFunction(()=>new URL(location.href).searchParams.get("resource")==="GuardDuty");
    await page.getByRole("heading",{level:1,name:"Guardias"}).waitFor();
    await page.getByTestId("create-dialog").waitFor({state:"hidden"});
    assert.equal((await req("/api/sections/"+encodeURIComponent(routeCode))).status,404,
      "Back with explicit discard does not create the draft");
    await page.evaluate(()=>window.history.forward());
    await page.waitForFunction(()=>new URL(location.href).searchParams.get("resource")==="Section");
    await page.getByRole("heading",{level:1,name:"Secciones"}).waitFor();
    // Filter values and pagination are URL-derived and survive resource switching.
    const searchPanel=page.getByTestId("query-filters");
    await searchPanel.locator("summary").click();
    await searchPanel.getByRole("textbox",{name:"Nombre de la sección"}).fill("Seccion ficticia UI");
    await searchPanel.getByRole("button",{name:"Filtrar"}).click();
    await page.waitForFunction(()=>new URL(location.href).searchParams.get("filter.name")==="Seccion ficticia UI");
    await page.getByRole("row").filter({hasText:section}).waitFor();
    await nav().getByRole("button",{name:"Guardias",exact:true}).click();
    await nav().getByRole("button",{name:"Secciones",exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.get("filter.name"),"Seccion ficticia UI",
      "Resource switch restores its URL filter");
    assert.equal(await searchPanel.getByRole("textbox",{name:"Nombre de la sección"}).inputValue(),
      "Seccion ficticia UI","Search input is restored with applied filters");
    await searchPanel.getByRole("button",{name:"Limpiar filtros"}).click();
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has("filter.name"));
    // Simulate a stricter backend-only rule to verify mapping of contract-safe
    // field issues to the generated input, without adding a domain-specific validator.
    const serverForm=await navigate("Secciones","Section");
    const rejectedCode=id("SERVERVALIDATION");
    await serverForm.getByTestId("create-code").fill(rejectedCode);
    await serverForm.getByTestId("create-name").fill("Valid client-side value");
    await page.route(/\/api\/sections$/,async route=>{
      if(route.request().method()==="POST"&&
        JSON.parse(route.request().postData()??"{}").code===rejectedCode){
        await route.fulfill({status:400,contentType:"application/json",
          body:JSON.stringify({statusCode:400,message:"Validation failed",
            issues:[{field:"name",code:"invalid_format"}]})});
      }else await route.continue();
    });
    const validationResponse=page.waitForResponse(response=>
      response.request().method()==="POST"&&new URL(response.url()).pathname==="/api/sections"&&
      response.status()===400,{timeout:15000});
    await serverForm.getByRole("button",{name:"Crear",exact:true}).click();
    await validationResponse;
    await serverForm.getByText("El formato ingresado no es válido.").waitFor({state:"visible"});
    assert.equal(await serverForm.getByTestId("create-name").getAttribute("aria-invalid"),"true",
      "Generated field is marked invalid after a structured HTTP 400");
    const serverErrorId=await serverForm.getByText("El formato ingresado no es válido.",{exact:true}).getAttribute("id");
    const associated=await serverForm.getByTestId("create-name").getAttribute("aria-describedby");
    assert.ok(serverErrorId&&associated?.split(/\s+/).includes(serverErrorId),
      "Backend field validation is linked by the actual React-generated accessible description");
    await page.getByTestId("create-dialog").screenshot({
      path:join(generated,"protocolia-generated-server-field-error-desktop.png")
    });
    await page.setViewportSize({width:390,height:780});
    const compactBounds=await page.getByTestId("create-dialog").evaluate(element=>{
      const rect=element.getBoundingClientRect();
      return {height:rect.height,bottom:rect.bottom,windowHeight:window.innerHeight};
    });
    assert.ok(compactBounds.height<compactBounds.windowHeight*.85,
      "Short generated forms use compact mobile bottom sheets instead of empty full screens");
    assert.ok(Math.abs(compactBounds.bottom-compactBounds.windowHeight)<=2,
      "Compact mobile creation is anchored to the viewport bottom");
    await page.getByTestId("create-dialog").screenshot({
      path:join(generated,"protocolia-generated-server-field-error-mobile.png")
    });
    await page.getByTestId("create-dialog").screenshot({
      path:join(generated,"protocolia-generated-compact-create-mobile.png")
    });
    await page.setViewportSize({width:1365,height:900});
    assert.equal(await serverForm.getByTestId("create-code").inputValue(),rejectedCode,
      "Server rejection never silently discards the entered draft");
    await page.unroute(/\/api\/sections$/);
    await serverForm.getByRole("button",{name:"Cancelar",exact:true}).click();
    await page.getByTestId("unsaved-changes-confirmation")
      .getByRole("button",{name:"Descartar cambios"}).click();
    await page.getByTestId("create-dialog").waitFor({state:"hidden"});
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
    // Validate the generated multiline control on a different, unmodified domain field.
    const notesForm=await navigate("Licencias","LeaveRecord");
    const notes=notesForm.getByTestId("create-notes");
    assert.equal(await notes.evaluate(el=>el.tagName),"TEXTAREA");
    assert.equal(await notes.getAttribute("maxlength"),"160");
    assert.equal(await notes.getAttribute("placeholder"),"Anotá un detalle relevante de la licencia");
    assert.ok((await notes.getAttribute("aria-describedby"))?.length>0,
      "Textarea contract help is linked accessibly");
    await notes.fill("Breve descripción desde React generado.");
    assert.equal(await notes.inputValue(),"Breve descripción desde React generado.");
    await notesForm.getByRole("button",{name:"Cancelar",exact:true}).click();
    await page.getByTestId("unsaved-changes-confirmation")
      .getByRole("button",{name:"Descartar cambios"}).click();
    await page.getByTestId("create-dialog").waitFor({state:"hidden"});
    form=await navigate("Calificaciones mensuales","MonthlyEvaluation");
    await page.getByTestId("create-dialog").screenshot({
      path:join(generated,"protocolia-generated-sectioned-form-desktop.png")});
    await page.setViewportSize({width:390,height:780});
    await page.getByTestId("create-dialog").screenshot({
      path:join(generated,"protocolia-generated-sectioned-form-mobile.png")});
    // Long mobile create forms must scroll only their fields, never beneath the
    // fixed actions. Assert geometry against the actual rendered Chromium DOM.
    const createDialog=page.getByTestId("create-dialog");
    const fieldsViewport=createDialog.locator(".form-groups");
    assert.equal(await fieldsViewport.evaluate(el=>getComputedStyle(el).overflowY),"auto",
      "Grouped mobile fields must have an independent scroll region");
    const lastInput=form.getByTestId("create-otherPoints");
    await lastInput.scrollIntoViewIfNeeded();
    const regions=await createDialog.evaluate(el=>{
      const form=el.querySelector("form"),fields=form.querySelector(".form-groups"),
        actions=form.querySelector(".modal-actions"),last=form.querySelector('[data-testid="create-otherPoints"]');
      return {lastBottom:last.getBoundingClientRect().bottom,actionsTop:actions.getBoundingClientRect().top,
        scrollable:fields.scrollHeight>fields.clientHeight,
        actionsBottom:actions.getBoundingClientRect().bottom,dialogBottom:el.getBoundingClientRect().bottom};
    });
    assert.equal(regions.scrollable,true,"Long form fields must scroll");
    assert.ok(regions.lastBottom<=regions.actionsTop-2,
      "Last generated field must be fully visible above create/cancel buttons");
    assert.ok(regions.actionsBottom<=regions.dialogBottom,
      "Mobile form actions must remain inside their dialog");
    await createDialog.screenshot({path:join(generated,"protocolia-generated-sectioned-form-mobile-scrolled.png")});
    await fieldsViewport.evaluate(el=>{el.scrollTop=0;});
    const longBounds=await page.getByTestId("create-dialog").evaluate(element=>({
      height:element.getBoundingClientRect().height,windowHeight:window.innerHeight
    }));
    assert.ok(longBounds.height>=longBounds.windowHeight-3,
      "Complex generated forms retain scrollable full-height mobile layout");
    await page.setViewportSize({width:1365,height:900});
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
    const invalidDraftConfirmation=page.getByTestId("unsaved-changes-confirmation");
    await invalidDraftConfirmation.waitFor({state:"visible",timeout:6000});
    assert.equal(await form.getByTestId("create-number").count(),0,
      "Edited invalid form displays discard confirmation rather than losing draft silently");
    await invalidDraftConfirmation.getByRole("button",{name:"Descartar cambios"}).click();
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
    // 57 fixture parents exceed the first 50 authorized records.
    await page.setViewportSize({width:1365,height:900});
    for(let n=0;n<57;n++){
      const fixture=await req("/api/sections",{method:"POST",
        body:{code:id("PAGED"+String(n).padStart(3,"0")),name:"Paginada ficticia "+String(n).padStart(3,"0")}});
      assert.equal(fixture.status,201,"Fixture parent "+n+" created");
    }
    const pageForm=await navigate("Guardias","GuardDuty");
    await pageForm.locator(".relation-search-trigger").waitFor({state:"visible",timeout:15000});
    const trigger=pageForm.getByTestId("create-sectionCode");
    await trigger.click();
    const chooser=page.getByRole("dialog",{name:"Elegir sección"});
    await chooser.waitFor({state:"visible"});
    await chooser.getByRole("searchbox",{name:"Buscar sección"}).fill("PAGINADA FICTICIA 056");
    const beyond=chooser.getByRole("option").filter({hasText:id("PAGED056")});
    await beyond.waitFor({state:"visible",timeout:15000});
    await chooser.screenshot({path:join(generated,"protocolia-generated-picker-desktop.png")});
    await beyond.focus();
    assert.equal(await beyond.evaluate(el=>document.activeElement===el),true,
      "Paginated options can be focused by keyboard");
    await page.keyboard.press("Escape");
    await chooser.waitFor({state:"hidden",timeout:7000});
    assert.equal(await pageForm.isVisible(),true,
      "Escape dismisses chooser while retaining the parent form");
    await trigger.click();
    await chooser.getByRole("searchbox",{name:"Buscar sección"}).fill("PAGINADA FICTICIA 056");
    await beyond.waitFor({state:"visible",timeout:10000});
    await page.setViewportSize({width:390,height:780});
    await chooser.screenshot({path:join(generated,"protocolia-generated-picker-mobile.png")});
    const width=await chooser.evaluate(el=>el.getBoundingClientRect().width);
    assert.ok(width<=390,"Paginated picker fits small viewport");
    await page.setViewportSize({width:1365,height:900});
    await beyond.click();
    await chooser.waitFor({state:"hidden"});
    assert.equal(await trigger.getAttribute("data-selected-key"),id("PAGED056"),
      "Authorized server-side lookup returns parent outside first 50");
    await pageForm.getByTestId("create-code").fill(id("GUARDPAGED"));
    await pageForm.getByTestId("create-name").fill("Guardia con relación paginada");
    const saved=page.waitForResponse(r=>r.request().method()==="POST"&&
      new URL(r.url()).pathname==="/api/guards",{timeout:20000});
    await pageForm.getByRole("button",{name:"Crear",exact:true}).click();
    assert.equal((await saved).status(),201,"Generated form creates paged FK association");
    assert.equal((await req("/api/guards/"+encodeURIComponent(id("GUARDPAGED")))).body.sectionCode,
      id("PAGED056"),"Real PostgreSQL persists the selected FK");
    // Reassignment uses the same generated picker when there are >50 possible guards.
    for(let n=0;n<55;n++){
      const fixture=await req("/api/guards",{method:"POST",body:{
        code:id("PGGUARD"+String(n).padStart(3,"0")),sectionCode:section,
        name:"Guardia paginada ficticia "+String(n).padStart(3,"0")
      }});
      assert.equal(fixture.status,201,"Reassignment reference fixture "+n);
    }
    await nav().getByRole("button",{name:"Personal",exact:true}).click();
    const personRow=page.getByRole("row").filter({hasText:badge});
    await personRow.getByRole("button",{name:"Detalle"}).click();
    const personModal=page.getByRole("dialog",{name:"Detalle: "+badge});
    const assignment=personModal.getByTestId("reassign-reference");
    const guardPicker=assignment.getByTestId("create-guardCode");
    await assignment.locator(".relation-search-trigger").waitFor({state:"visible",timeout:15000});
    await guardPicker.click();
    const guardSearch=page.getByRole("dialog",{name:"Elegir guardia asignada"});
    await guardSearch.waitFor({state:"visible"});
    await guardSearch.getByRole("searchbox",{name:"Buscar guardia asignada"})
      .fill("GUARDIA PAGINADA FICTICIA 054");
    const targetKey=id("PGGUARD054");
    await guardSearch.getByRole("option").filter({hasText:targetKey})
      .waitFor({state:"visible",timeout:12000});
    await guardSearch.getByRole("option").filter({hasText:targetKey}).click();
    assert.equal(await guardPicker.getAttribute("data-selected-key"),targetKey,
      "The paginated reassignment picker stores the full FK identity");
    const replacement=page.waitForResponse(response=>response.request().method()==="PATCH"&&
      new URL(response.url()).pathname==="/api/volunteers/"+encodeURIComponent(badge)+"/guard",
      {timeout:18000});
    await assignment.getByTestId("confirm-reassign").click();
    assert.equal((await replacement).status(),200,"Paginated reassign succeeds");
    assert.equal((await req("/api/volunteers/"+encodeURIComponent(badge))).body.guardCode,targetKey,
      "CAS reassignment persists out-of-first-page reference");
    await personModal.getByRole("button",{name:"Cerrar detalle"}).click();
    await personModal.waitFor({state:"hidden"});
    await nav().getByRole("button",{name:"Secciones",exact:true}).click();
    await nav().getByRole("button",{name:"Personal",exact:true}).click();
    const readBack=page.waitForResponse(response=>response.request().method()==="GET"&&
      new URL(response.url()).pathname==="/api/guards/"+encodeURIComponent(targetKey),
      {timeout:18000});
    await page.getByRole("row").filter({hasText:badge}).getByRole("button",{name:"Detalle"}).click();
    await readBack;
    const restored=page.getByRole("dialog",{name:"Detalle: "+badge})
      .getByTestId("reassign-reference").getByTestId("create-guardCode");
    await restored.getByText("Guardia paginada ficticia 054")
      .waitFor({state:"visible",timeout:12000});
    assert.equal(await restored.getAttribute("data-selected-key"),targetKey,
      "Persisted off-page relation recovers its readable caption by authorized GET");
    await page.getByRole("dialog",{name:"Detalle: "+badge})
      .getByRole("button",{name:"Cerrar detalle"}).click();
    assert.equal(pageErrors.length,0,"Browser JavaScript exceptions: "+pageErrors.join("; "));
    console.log("BV_GENERATED_NATIVE_FK_BROWSER_PASS "+JSON.stringify({
      browser:"Chromium Playwright",entities:["Section","GuardDuty","Volunteer","MonthlyEvaluation"],
      fks:["GuardDuty.sectionCode","Volunteer.guardCode","MonthlyEvaluation.volunteerBadge"],
      emptyReferenceBlocked:true,computedBasePoints:80,detailModal:true,
      compiledFieldMetadata:true,accessibleFieldHints:true,
      reassignPicker:true,confirmedCasReferenceUpdate:true,
      preservedScroll:true,focusRestored:true,mobileInternalScroll:true,pagedRelationOver50:true,pagedReassignment:true,offPageHydration:true,draftLossGuard:true,urlNavigation:true,historyDraftGuard:true,clientJavascriptErrors:0
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
