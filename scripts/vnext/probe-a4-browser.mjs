import assert from "node:assert/strict";
import {chromium} from "playwright";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on("pageerror",e=>console.log("A4_BROWSER_PAGE_ERROR="+e.message));
  page.on("response",r=>{if(r.url().includes("/api/"))
    console.log("A4_BROWSER_HTTP="+r.request().method()+" "+new URL(r.url()).pathname+" "+r.status());
  });
  await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded"});
  await page.locator('[data-testid="username"]').fill("manager");
  await page.locator('[data-testid="password"]').fill("test-manager-only-2026");
  await page.getByRole("button",{name:"Entrar"}).click();
  await page.locator("table tbody tr").filter({hasText:"E-001"}).waitFor({timeout:18000});
  await page.getByRole("navigation",{name:"Recursos"}).getByRole("button",{name:"Inspecciones"}).click();
  await page.getByRole("heading",{name:"Crear Inspection"}).waitFor({timeout:15000});
  const form=page.locator("section.panel").filter({has:page.getByRole("heading",{name:"Crear Inspection"})}).locator("form");
  const select=form.locator("select");
  await select.locator('option[value="E-001"]').waitFor({state:"attached",timeout:18000});
  await form.locator("input").nth(0).fill("I-UI-001");
  await select.selectOption("E-001");
  await form.locator("input").last().fill("Created from relation picker");
  await form.getByRole("button",{name:"Crear"}).click();
  await page.locator("table tbody tr").filter({hasText:"I-UI-001"}).waitFor({timeout:18000});
  console.log("A4_BROWSER_RELATION_PICKER_INSPECTION_CREATE_PASS");
  await page.getByRole("button",{name:"Salir"}).click();
  await page.locator('[data-testid="username"]').fill("reader");
  await page.locator('[data-testid="password"]').fill("test-reader-only-2026");
  await page.getByRole("button",{name:"Entrar"}).click();
  await page.getByRole("navigation",{name:"Recursos"}).getByRole("button",{name:"Inspecciones"}).click();
  await page.locator("table tbody tr").filter({hasText:"I-UI-001"}).waitFor({timeout:18000});
  assert.equal(await page.getByRole("heading",{name:"Crear Inspection"}).count(),0);
  console.log("A4_BROWSER_READER_MULTIRESOURCE_PASS");
}finally{await browser.close();}
