import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on("pageerror",error=>console.log("A0_MODULAR_BROWSER_PAGE_ERROR="+error.message));
  page.on("response",response=>{
    if(response.url().includes("/api/"))console.log("A0_MODULAR_BROWSER_API_RESPONSE="+response.request().method()+" "+new URL(response.url()).pathname+" "+response.status());
  });
  const base="http://127.0.0.1:8080";
  await page.goto(base+"/",{waitUntil:"domcontentloaded"});
  await page.locator('[data-testid="username"]').fill("manager");
  await page.locator('[data-testid="password"]').fill("test-manager-only-2026");
  await page.getByRole("button",{name:"Entrar"}).click();
  const row=page.locator("table tbody tr").filter({hasText:"A0-MODULAR-001"}).first();
  await row.waitFor({timeout:30000});
  assert.match(await row.innerText(),/Renamed drill/);
  await row.getByRole("button",{name:"Detalle"}).click();
  await page.locator('[data-testid="rename"]').fill("Updated through Chromium");
  await page.getByRole("button",{name:"Guardar cambios"}).click();
  try {
    await page.getByRole("status").getByText("Operación confirmada: patchFields").waitFor({timeout:15000});
  } catch(error) {
    console.log("A0_MODULAR_BROWSER_AFTER_RENAME_TEXT="+(await page.locator("body").innerText()).slice(-1700));
    throw error;
  }
  await page.locator('[data-testid="increment"]').fill("2");
  await page.getByRole("button",{name:"Incrementar"}).click();
  await page.getByRole("status").getByText("Operación confirmada: atomicIncrement").waitFor({timeout:15000});
  await page.waitForFunction(()=>{
    const text=document.querySelector("dl")?.textContent??"";
    return text.includes("17");
  },null,{timeout:15000});
  assert.match(await row.innerText(),/Updated through Chromium/);
  const verify=await page.evaluate(async()=>{
    const response=await fetch("/api/tools/A0-MODULAR-001");
    return response.status;
  });
  assert.equal(verify,401,"Anonymous browser fetch cannot bypass backend auth");
  // UI discovers authorities from the protected server endpoint, not local assumptions.
  await page.getByRole("button",{name:"Salir"}).click();
  await page.locator('[data-testid="username"]').fill("reader");
  await page.locator('[data-testid="password"]').fill("incorrect");
  await page.getByRole("button",{name:"Entrar"}).click();
  await page.getByRole("alert").getByText("Credenciales incorrectas o servicio no disponible").waitFor({timeout:15000});
  assert.equal(await page.locator("table tbody tr").count(),0);
  await page.locator('[data-testid="password"]').fill("test-reader-only-2026");
  await page.getByRole("button",{name:"Entrar"}).click();
  await page.locator("table tbody tr").filter({hasText:"A0-MODULAR-001"}).first().waitFor({timeout:15000});
  assert.equal(await page.getByRole("heading",{name:"Crear Tool"}).count(),0);
  await page.locator("table tbody tr").filter({hasText:"A0-MODULAR-001"}).first().getByRole("button",{name:"Detalle"}).click();
  assert.equal(await page.getByRole("button",{name:"Guardar cambios"}).count(),0);
  assert.equal(await page.getByRole("button",{name:"Incrementar"}).count(),0);
  console.log("A2_READER_BROWSER_NO_MUTATION_CONTROLS_AND_BAD_LOGIN_RECOVERS_PASS");
  const screenshot=await page.screenshot({fullPage:true});
  console.log("A0_MODULAR_CHROMIUM_SCREENSHOT_SHA256="+createHash("sha256").update(screenshot).digest("hex"));
  console.log("A0_MODULAR_BROWSER_VIEWPORT=390x844");
  console.log("A0_MODULAR_REACT_REAL_POSTGRES_CREATE_READ_PATCH_INCREMENT_PASS");
} finally {
  await browser.close();
}
