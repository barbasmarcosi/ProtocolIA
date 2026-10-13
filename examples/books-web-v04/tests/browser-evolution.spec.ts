import {test,expect} from '@playwright/test';

const OWNER=['integration-only','integration-only-test-password-2026'] as const;
const VIEWER=['catalog-viewer','integration-viewer-password-2026'] as const;

async function login(page:import('@playwright/test').Page,who:readonly [string,string],role:'writer'|'reader'='writer'){
 await page.goto('/');
 await page.getByLabel('Usuario').fill(who[0]);
 await page.getByLabel('Contraseña').fill(who[1]);
 await page.getByLabel('Vista').selectOption(role);
 await page.getByRole('button',{name:'Entrar al catálogo'}).click();
 await expect(page.getByRole('heading',{name:'Books'})).toBeVisible();
}

test('v0.4 PostgreSQL: RJSF optional publication date through real browser, API and restock',async ({page})=>{
 await login(page,OWNER);
 const create=page.locator('section[aria-label="Crear libro"]');
 await expect(create.getByLabel('Fecha de publicación')).toBeVisible();
 const isbn='g5-v04-browser-'+Date.now();
 await create.getByLabel('ISBN').fill(isbn);
 await create.getByLabel('Título').fill('Publicación verificable');
 await create.getByLabel('Existencias').fill('2');
 await create.getByLabel('Fecha de publicación').fill('2026-10-12T10:30');
 await create.getByRole('button',{name:'Crear libro'}).click();
 await expect(page.getByText('Libro creado: '+isbn)).toBeVisible();
 const detail=page.locator('section[aria-label="Detalle del libro"]');
 await expect(detail.getByText(isbn)).toBeVisible();
 await expect(detail.getByText(/2026-10-12/)).toBeVisible();
 await detail.getByLabel('Unidades').fill('7');
 await detail.getByRole('button',{name:'Aplicar reposición'}).click();
 await expect(page.getByText('Stock actualizado: 9 unidades')).toBeVisible();
 await expect(detail.getByText(/2026-10-12/)).toBeVisible();
 await detail.getByLabel('Título').fill('Renamed in browser');
 await detail.getByRole('button',{name:'Cambiar título'}).click();
 await expect(page.getByText('Título actualizado: Renamed in browser')).toBeVisible();
 await expect(detail.getByText('Renamed in browser')).toBeVisible();
 // Real HTTP response must include persisted date, not just browser-local form state.
 const response=await page.request.get('http://127.0.0.1:10111/api/books/'+isbn,{
  headers:{Authorization:'Basic '+Buffer.from(OWNER.join(':')).toString('base64')},
 });
 expect(response.status()).toBe(200);
 const data=await response.json();
 expect(data.publishedAt).toContain('2026-10-12');
 expect(data.stock).toBe(9);
});

test('v0.4 PostgreSQL: omitted publication date persists as null and reader write denied',async ({page,request})=>{
 await login(page,OWNER);
 const create=page.locator('section[aria-label="Crear libro"]');
 const isbn='g5-v04-omitted-'+Date.now();
 await create.getByLabel('ISBN').fill(isbn);
 await create.getByLabel('Título').fill('Sin fecha');
 await create.getByLabel('Existencias').fill('0');
 await create.getByRole('button',{name:'Crear libro'}).click();
 await expect(page.getByText('Libro creado: '+isbn)).toBeVisible();
 const r=await request.get('http://127.0.0.1:10111/api/books/'+isbn,{
  headers:{Authorization:'Basic '+Buffer.from(OWNER.join(':')).toString('base64')},
 });
 expect(r.status()).toBe(200);
 expect((await r.json()).publishedAt??null).toBeNull();
 const denied=await request.post('http://127.0.0.1:10111/api/books',{
  headers:{Authorization:'Basic '+Buffer.from(VIEWER.join(':')).toString('base64')},
  data:{isbn:'g5-reader-must-fail',title:'No',stock:1},
 });
 expect(denied.status()).toBe(403);
});
