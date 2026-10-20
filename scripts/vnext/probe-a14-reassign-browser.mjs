import assert from "node:assert/strict";
import {chromium} from "playwright";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];
 page.on("pageerror",err=>errors.push(err.message));
 page.on("response",res=>{if(res.url().includes("/api/")&&res.status()>=500)errors.push("HTTP "+res.status());});
 await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded"});
 const logIn=async(user,password)=>{
   await page.getByTestId("username").fill(user);
   await page.getByTestId("password").fill(password);
   await page.getByRole("button",{name:"Entrar"}).click();
 };
 await logIn("manager",process.env.PROTOCOLIA_MANAGER_PASSWORD);
 await page.getByRole("navigation",{name:"Recursos"}).getByRole("button",{name:"Avisos de mantenimiento"}).click();
 const row=page.locator("section.panel table tbody tr").filter({hasText:"TK-A14"}).first();
 await row.waitFor({timeout:30000});
 await row.getByRole("button",{name:"Detalle"}).click();
 const detail=page.locator("section.panel").filter({has:page.getByRole("heading",{name:"Detalle: TK-A14"})});
 const form=detail.getByTestId("reassign-reference");
 await form.locator('option[value="TE-A"]').waitFor({state:"attached",timeout:30000});
 await form.locator("select").selectOption("TE-A");
 await form.getByRole("button",{name:"Reasignar"}).click();
 await detail.getByText("TE-A",{exact:true}).first().waitFor({timeout:30000});
 await detail.locator('[data-testid="audit-history"] tbody tr').first().getByText("TE-A",{exact:true}).waitFor({timeout:30000});
 assert.equal(await detail.locator('[data-testid="audit-history"] tbody tr').count(),5);
 console.log("A14_MOBILE_390X844_REASSIGNMENT_AUDIT_PASS");
 await page.getByRole("button",{name:"Salir"}).click();
 await logIn("reader",process.env.PROTOCOLIA_READER_PASSWORD);
 const readerRow=page.locator("section.panel table tbody tr").filter({hasText:"TK-A14"}).first();
 await readerRow.waitFor({timeout:30000});
 await readerRow.getByRole("button",{name:"Detalle"}).click();
 assert.equal(await page.getByTestId("reassign-reference").count(),0);
 assert.equal(await page.getByTestId("audit-history").count(),0);
 assert.deepEqual(errors,[]);
 console.log("A14_MOBILE_READER_RESTRICTED_PASS");
}finally{await browser.close();}
