import {test,expect} from '@playwright/test';

const OWNER=['integration-only','integration-only-test-password-2026'] as const;
const VIEWER=['catalog-viewer','integration-viewer-password-2026'] as const;

async function login(page:import('@playwright/test').Page, user:string,pass:string,view:'Gestor'|'Lector'='Gestor'){
 await page.goto('/');
 await page.getByLabel('Usuario').fill(user);
 await page.getByLabel('Contraseña').fill(pass);
 await page.getByLabel('Vista').selectOption(view==='Gestor'?'writer':'reader');
 await page.getByRole('button',{name:'Entrar al catálogo'}).click();
 await expect(page.getByRole('heading',{name:'Books'})).toBeVisible();
}

test('real browser: schema-driven create, pagination, details and stock refresh',async ({page})=>{
 await login(page,...OWNER);
 await expect(page.getByText(/Mostrando/)).toBeVisible();
 const create=page.getByRole('region',{name:'Crear libro'}).or(page.locator('section[aria-label="Crear libro"]'));
 await expect(create.getByRole('heading',{name:'Create book'})).toBeVisible();

 const isbn1='g3-a-browser-'+Date.now();
 const isbn2='g3-b-browser-'+Date.now();
 let postCount=0;
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/books'))postCount++;});
 await create.getByRole('button',{name:'Crear libro'}).click();
 await expect.poll(()=>postCount).toBe(0);
 await create.getByLabel('ISBN').fill('  ');
 await create.getByLabel('Título').fill('No debería crearse');
 await create.getByLabel('Existencias').fill('-1');
 await create.getByRole('button',{name:'Crear libro'}).click();
 await expect.poll(()=>postCount).toBe(0);
 await create.getByLabel('Existencias').fill('1');
 await create.getByRole('button',{name:'Crear libro'}).click();
 await expect(create.getByText('No puede contener solo espacios.')).toBeVisible();
 await expect.poll(()=>postCount).toBe(0);
 await create.getByLabel('ISBN').fill(isbn1);
 await create.getByLabel('Título').fill('Primera prueba real');
 await create.getByLabel('Existencias').fill('2');
 await create.getByRole('button',{name:'Crear libro'}).click();
 await expect(page.getByText('Libro creado: '+isbn1)).toBeVisible();
 const detail=page.locator('section[aria-label="Detalle del libro"]');
 await expect(detail.getByText(isbn1)).toBeVisible();

 const restock=detail.getByRole('button',{name:'Aplicar reposición'});
 let patchCount=0;
 page.on('request',r=>{if(r.method()==='PATCH'&&r.url().includes('/stock'))patchCount++;});
 await detail.getByLabel('Unidades').fill('0');
 await restock.click();
 await expect.poll(()=>patchCount).toBe(0);
 await detail.getByLabel('Unidades').fill('7');
 await restock.click();
 await expect(page.getByText('Stock actualizado: 9 unidades')).toBeVisible();
 await expect(detail.locator('dd').filter({hasText:'9'})).toBeVisible();

 // Another record; bounded real pages remain distinct and refreshed.
 await create.getByLabel('ISBN').fill(isbn2);
 await create.getByLabel('Título').fill('Segunda prueba real');
 await create.getByLabel('Existencias').fill('3');
 await create.getByRole('button',{name:'Crear libro'}).click();
 await expect(page.getByText('Libro creado: '+isbn2)).toBeVisible();
 await page.getByRole('combobox',{name:'Por página'}).selectOption('1');
 await expect(page.getByRole('button',{name:'Siguiente'})).toBeEnabled();
 await page.getByRole('button',{name:'Siguiente'}).click();
 await expect(page.getByRole('button',{name:'Anterior'})).toBeEnabled();
 await expect(page.getByText('Mostrando 2–2 de 2')).toBeVisible();
 await page.getByRole('button',{name:'Anterior'}).click();
 await expect(page.getByText('Mostrando 1–1 de 2')).toBeVisible();
});

test('real browser: 401 visible, reader access and 403 enforced on backend',async ({page,request})=>{
 await login(page,'integration-only','wrong-password');
 await expect(page.getByRole('alert').getByText(/401/)).toBeVisible();
 await page.getByRole('button',{name:'Cerrar sesión'}).click();
 await login(page,...VIEWER,'Lector');
 await expect(page.getByRole('heading',{name:'Books'})).toBeVisible();
 await expect(page.locator('section[aria-label="Crear libro"]')).toHaveCount(0);
 const response=await request.post('http://127.0.0.1:10111/api/books',{
  headers:{Authorization:'Basic '+Buffer.from(VIEWER.join(':')).toString('base64')},
  data:{isbn:'g3-viewer-rejected',title:'No autorizado',stock:1},
 });
 expect(response.status()).toBe(403);
});

test('real mobile browser: constrained layout and reader workflow',async ({page})=>{
 await page.setViewportSize({width:390,height:844});
 await login(page,...VIEWER,'Lector');
 await expect(page.getByRole('heading',{name:'Books'})).toBeVisible();
 const overflowing=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
 expect(overflowing).toBe(false);
 await expect(page.getByRole('button',{name:'Cerrar sesión'})).toBeVisible();
});
