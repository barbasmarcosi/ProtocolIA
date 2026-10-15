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
  const nav=()=>page.getByRole("navigation",{name:"Recursos"});
  async function navigate(title,entity){
    await nav().getByRole("button",{name:title,exact:true}).click();
    await page.getByTestId("open-create").click();
    await page.getByRole("dialog",{name:"Nuevo "+entity}).waitFor({state:"visible",timeout:10000});
    const form=page.getByTestId("create-form-"+entity);
    await form.waitFor({state:"visible",timeout:20000});
    return form;
  }
  async function create({tab,entity,endpoint,key,fields,fk={}}){
    const form=await navigate(tab,entity);
    for(const [field,value] of Object.entries(fields)){
      const input=form.getByTestId("create-"+field);
      if(Object.hasOwn(fk,field)){
        const expected=String(value);
        // Native select options must load only through the declared authorized list endpoint.
        await input.locator("option").filter({hasText:expected}).first().waitFor({state:"attached",timeout:20000});
        await input.selectOption(expected);
        assert.equal(await input.inputValue(),expected,entity+"."+field+" selection must persist in controlled React state");
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
    await form.getByText("Primero creá un registro de Section.").waitFor({timeout:10000});
    assert.equal(await initialFK.isDisabled(),true,"FK selector disabled until parent records exist");
    assert.equal(await form.getByRole("button",{name:"Crear",exact:true}).isDisabled(),true,
      "No silent child creation when related list is empty");
    await page.getByRole("button",{name:"Cancelar",exact:true}).click();
    await page.getByTestId("create-dialog").waitFor({state:"hidden"});

    const section=id("SEC"),guard=id("GUARD"),badge=id("PERSON"),evaluation=id("EVAL");
    await create({tab:"Secciones",entity:"Section",endpoint:"/api/sections",key:"code",
      fields:{code:section,name:"Seccion ficticia UI"}});
    await create({tab:"Guardias",entity:"GuardDuty",endpoint:"/api/guards",key:"code",
      fields:{code:guard,sectionCode:section,name:"Guardia ficticia UI"},fk:{sectionCode:true}});
    await create({tab:"Personal",entity:"Volunteer",endpoint:"/api/volunteers",key:"badge",
      fields:{badge,guardCode:guard,name:"Persona ficticia UI",rank:"Aspirante"},fk:{guardCode:true}});
    form=await navigate("Calificaciones mensuales","MonthlyEvaluation");
    assert.equal(await form.getByTestId("create-basePoints").count(),0,
      "Computed basePoints must never be an editable/form-submitted input");
    await page.getByRole("dialog",{name:"Nuevo MonthlyEvaluation"}).getByRole("button",{name:"Cancelar"}).click();
    await page.getByTestId("create-dialog").waitFor({state:"hidden"});
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
    assert.match(details,/base Points\s+80/,"Generated detail modal shows computed base score");
    for(let i=0;i<8;i++){
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]'))),true,
        "Keyboard focus remains inside modal");
    }
    await page.keyboard.press("Escape");
    await modal.waitFor({state:"hidden"});
    assert.equal(await opener.evaluate(el=>el===document.activeElement),true,
      "Closing detail returns focus to the original table row action");
    const scrollAfter=await page.evaluate(()=>window.scrollY);
    assert.ok(Math.abs(scrollAfter-scrollBefore)<10,"Opening and closing detail preserves list scroll position");
    await page.setViewportSize({width:390,height:780});
    await opener.click();
    await modal.waitFor({state:"visible"});
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
