import assert from "node:assert/strict";
import {chromium} from "playwright";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];
 page.on("pageerror",err=>errors.push(err.message));
 page.on("response",resp=>{if(resp.url().includes("/api/")&&resp.status()>=500)
   errors.push("HTTP "+resp.status()+" "+resp.url());});
 await page.goto("http://127.0.0.1:8080/",{waitUntil:"domcontentloaded"});
 await page.getByTestId("username").fill("reader");
 await page.getByTestId("password").fill(process.env.PROTOCOLIA_READER_PASSWORD);
 await page.getByRole("button",{name:"Entrar"}).click();
 await page.getByRole("navigation",{name:"Recursos"}).getByRole("button",{name:"Avisos de mantenimiento"}).click();
 const panel=page.getByTestId("query-filters");
 await panel.getByLabel("siteCode").fill("S-N");
 await panel.getByLabel("status").fill("reported");
 await panel.getByLabel("dueFrom").fill("2026-10-18T00:00");
 await panel.getByLabel("dueTo").fill("2026-10-23T00:00");
 await panel.getByRole("button",{name:"Filtrar"}).click();
 const table=page.locator("section.panel").filter({has:page.getByRole("heading",{name:/Listado/})}).locator("table");
 await table.getByText("K1",{exact:true}).waitFor({timeout:30000});
 assert.equal(await table.locator("tbody tr").count(),1);
 assert.equal(await table.getByText("K2",{exact:true}).count(),0);
 assert.equal(await table.getByText("K3",{exact:true}).count(),0);
 await panel.getByRole("button",{name:"Limpiar filtros"}).click();
 await table.getByText("K2",{exact:true}).waitFor({timeout:30000});
 assert.equal(await table.locator("tbody tr").count(),5);
 assert.equal(await page.getByRole("heading",{name:"Crear Ticket"}).count(),0);
 assert.deepEqual(errors,[]);
 console.log("A142_CHROMIUM_390X844_FILTERS_EMPTY_RESET_AND_READER_READONLY_PASS");
}finally{await browser.close();}
