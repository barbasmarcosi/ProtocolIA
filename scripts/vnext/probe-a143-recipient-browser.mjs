import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 async function login(user){
  await page.getByTestId('username').fill(user);
  await page.getByTestId('password').fill(user==='manager'?process.env.PROTOCOLIA_MANAGER_PASSWORD:process.env.PROTOCOLIA_READER_PASSWORD);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.getByRole('button',{name:'Abrir bandeja'}).click();
  await page.getByTestId('notification-card').first().waitFor();
 }
 await page.goto('http://127.0.0.1:8080/');await login('manager');
 const inbox=page.getByTestId('notification-inbox');
 assert.equal(await inbox.getByTestId('notification-card').count(),10);
 assert.equal(await inbox.getByText('READER-ONLY',{exact:false}).count(),0);
 const unread=inbox.getByRole('button',{name:'Marcar como leída'}).first();
 const acked=page.waitForResponse(r=>r.url().includes('/ack')&&r.request().method()==='POST');
 await unread.click();const response=await acked;assert.equal(response.status(),200);
 const item=await response.json();
 await page.waitForFunction(id=>[...document.querySelectorAll('[data-testid="notification-card"]')].some(n=>n.textContent.includes(id)&&n.textContent.includes('Leída')&&!n.textContent.includes('Marcar como leída')),item.resourceId);
 await inbox.getByRole('button',{name:'Siguientes',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-testid="notification-card"]').length===3);
 assert.equal(await inbox.getByTestId('notification-card').count(),3);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'mobile viewport has no page overflow');
 await page.getByRole('button',{name:'Salir',exact:true}).click();
 assert.equal(await page.getByTestId('notification-card').count(),0);
 await login('reader');
 assert.equal(await inbox.getByTestId('notification-card').count(),1);
 assert.match(await inbox.textContent(),/READER-ONLY/);
 assert.equal(await inbox.getByRole('button',{name:'Marcar como leída'}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('A143_RECIPIENT_CHROMIUM_MOBILE_PAGING_ACK_LOGOUT_ROLE_ISOLATION_PASS');
}finally{await browser.close();}
