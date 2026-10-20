import assert from "node:assert/strict";
import {chromium} from "playwright";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 page.on("response",response=>{
  if(response.url().includes("/api/")&&response.status()>=500)
    errors.push("HTTP "+response.status()+" "+response.url());
 });
 await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded"});
 await page.locator('[data-testid="username"]').fill("manager");
 await page.locator('[data-testid="password"]').fill("test-manager-only-2026");
 await page.getByRole("button",{name:"Entrar"}).click();
 const nav=page.getByRole("navigation",{name:"Recursos"});
 await nav.getByRole("button",{name:"Máquinas"}).click();
 const machineForm=page.locator("section.panel").filter({
  has:page.getByRole("heading",{name:"Crear Machine"})
 }).locator("form");
 await machineForm.locator('select option[value="S-WEST"]').waitFor({state:"attached",timeout:30000});
 await machineForm.getByLabel(/^tag/i).fill("MC-UI");
 await machineForm.locator("select").selectOption("S-WEST");
 await machineForm.getByLabel(/^name/i).fill("Bomba de achique nueva");
 await machineForm.getByLabel(/^category/i).fill("Hidráulica");
 await machineForm.getByRole("button",{name:"Crear"}).click();
 await page.locator("section.panel table tbody tr").filter({hasText:"MC-UI"}).first().waitFor({timeout:30000});
 console.log("A13_C11_BROWSER_MACHINE_CREATED_WITH_REAL_SITE_PICKER_PASS");
 await nav.getByRole("button",{name:"Avisos de mantenimiento"}).click();
 const ticketForm=page.locator("section.panel").filter({
  has:page.getByRole("heading",{name:"Crear Ticket"})
 }).locator("form");
 await ticketForm.locator('select').nth(0).locator('option[value="MC-UI"]').waitFor({state:"attached",timeout:30000});
 await ticketForm.locator('select').nth(1).locator('option[value="TE-A"]').waitFor({state:"attached",timeout:30000});
 await ticketForm.getByLabel(/^number/i).fill("TK-UI");
 await ticketForm.locator("select").nth(0).selectOption("MC-UI");
 await ticketForm.locator("select").nth(1).selectOption("TE-A");
 await ticketForm.getByLabel(/^title/i).fill("Inspeccionar bomba de achique");
 await ticketForm.getByLabel(/^severity/i).fill("high");
 await ticketForm.getByRole("button",{name:"Crear"}).click();
 const ticket=page.locator('section.panel table tbody tr').filter({hasText:"TK-UI"}).first();
 await ticket.waitFor({timeout:30000});
 await ticket.getByRole("button",{name:"Detalle"}).click();
 const detail=page.locator("section.panel").filter({has:page.getByRole("heading",{name:"Detalle: TK-UI"})});
 await detail.locator('[data-testid="transition-planTicket"]').click();
 await detail.locator('[data-testid="transition-completeTicket"]').waitFor({timeout:30000});
 await detail.locator('[data-testid="transition-completeTicket"]').click();
 await detail.getByText("completed",{exact:true}).first().waitFor({timeout:30000});
 const audit=detail.locator('[data-testid="audit-history"]');
 await audit.getByRole("row",{name:/completeTicket/}).waitFor({timeout:30000});
 assert.equal(await audit.locator("tbody tr").count(),4);
 assert.match(await audit.innerText(),/manager/);
 assert.match(await audit.innerText(),/reported/);
 assert.match(await audit.innerText(),/planned/);
 assert.match(await audit.innerText(),/completed/);
 console.log("A13_C11_C12_BROWSER_DOUBLE_REFERENCE_TICKET_TRANSITIONS_AND_AUDIT_PASS");
 await page.getByRole("button",{name:"Salir"}).click();
 await page.locator('[data-testid="username"]').fill("reader");
 await page.locator('[data-testid="password"]').fill("test-reader-only-2026");
 await page.getByRole("button",{name:"Entrar"}).click();
 const row=page.locator('section.panel table tbody tr').filter({hasText:"TK-UI"}).first();
 await row.waitFor({timeout:30000});
 await row.getByRole("button",{name:"Detalle"}).click();
 assert.equal(await page.locator('[data-testid="audit-history"]').count(),0);
 assert.equal(await page.locator('[data-testid^="transition-"]').count(),0);
 assert.equal(await page.getByRole("heading",{name:"Crear Ticket"}).count(),0);
 assert.deepEqual(errors,[],"Browser and API must have no runtime errors");
 console.log("A13_C09_C10_C12_BROWSER_READER_RESTRICTED_PASS");
}finally{await browser.close();}
