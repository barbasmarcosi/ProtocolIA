import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import {
  adjustStock,
  createBook,
  getBook,
  getGetBookQueryKey,
  getGetBookQueryOptions,
  getListBooksQueryKey,
  getListBooksQueryOptions,
  listBooks,
} from '../src/generated/orval/books';
import { ApiHttpError, configureTransport } from '../src/api/http';
import { adjustStockAndRefresh, createBookAndRefresh } from '../src/api/cache';

const baseUrl = process.env.G2_API_BASE_URL;
if (!baseUrl || !baseUrl.startsWith('http://127.0.0.1:')) {
  throw new Error('G2 refuses to run state-mutating tests against a remote/public URL');
}
const api = new URL(baseUrl);
const owner = 'integration-only';
const ownerPassword = 'integration-only-test-password-2026';
const viewer = 'catalog-viewer';
const viewerPassword = 'integration-viewer-password-2026';
const header = (user: string, password: string) => 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
const auth = (user?: string, password?: string) => configureTransport({
  baseUrl,
  getHeaders: user && password ? () => ({Authorization: header(user, password)}) : undefined,
});
async function failsStatus(job: Promise<unknown>, status: number, context: string): Promise<void> {
  await assert.rejects(job, (e: unknown) => {
    assert.ok(e instanceof ApiHttpError, context);
    assert.equal(e.status, status, context);
    return true;
  });
}
async function direct(method: string, path: string, payload?: string): Promise<Response> {
  return fetch(new URL(path, api), {
    method,
    headers: {
      Authorization: header(owner, ownerPassword),
      ...(payload === undefined ? {} : {'Content-Type': 'application/json'}),
    },
    body: payload,
  });
}
async function main() {
  console.log('G2_REAL_HTTP_BEGIN');
  auth();
  await failsStatus(listBooks(), 401, 'anonymous listing');

  auth(viewer, viewerPassword);
  const anonymousRead = await listBooks({limit: 2, offset: 0});
  assert.equal(anonymousRead.limit, 2);
  await failsStatus(createBook({isbn:'g2-denied',title:'Denied',stock:1}),403,'viewer POST');

  auth(owner,ownerPassword);
  const qc = new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  const page1 = {limit: 1, offset: 0};
  const page2 = {limit: 2, offset: 0};
  const cached1 = await qc.fetchQuery(getListBooksQueryOptions(page1));
  const cached2 = await qc.fetchQuery(getListBooksQueryOptions(page2));
  const baseline = cached2.total;
  assert.equal(cached1.limit, 1);
  assert.equal(cached2.limit, 2);
  assert.equal(qc.getQueryState(getListBooksQueryKey(page1))?.isInvalidated,false);
  assert.equal(qc.getQueryState(getListBooksQueryKey(page2))?.isInvalidated,false);
  assert.equal(getListBooksQueryKey().length, 1,'prefix key must cover all pages');

  const created = await createBookAndRefresh(qc,{isbn:'g2-client-reality-01',title:'Typed client real HTTP',stock:2});
  assert.equal(created.isbn,'g2-client-reality-01');
  assert.equal(qc.getQueryState(getListBooksQueryKey(page1))?.isInvalidated,true);
  assert.equal(qc.getQueryState(getListBooksQueryKey(page2))?.isInvalidated,true);
  const refreshed = await qc.fetchQuery(getListBooksQueryOptions(page2));
  assert.equal(refreshed.total,baseline+1,'invalidate multiple pages and reload actual backend');
  assert.equal(qc.getQueryState(getListBooksQueryKey(page2))?.isInvalidated,false);

  const detailOptions = getGetBookQueryOptions(created.isbn);
  const detail = await qc.fetchQuery(detailOptions);
  assert.equal(detail.stock,2);
  const changed = await adjustStockAndRefresh(qc,created.isbn,{quantity:7});
  assert.equal(changed.stock,9);
  assert.equal(qc.getQueryState(getGetBookQueryKey(created.isbn))?.isInvalidated,true);
  const freshDetail = await qc.fetchQuery(detailOptions);
  assert.equal(freshDetail.stock,9);

  // Failure paths and invariants: rejected writes never mutate domain state.
  await failsStatus(createBookAndRefresh(qc,{isbn:created.isbn,title:'Duplicate',stock:100}),409,'duplicate ISBN');
  assert.equal((await getBook(created.isbn)).title,'Typed client real HTTP');
  await failsStatus(getBook('g2-nonexistent-isbn'),404,'missing ISBN');
  await failsStatus(adjustStock(created.isbn,{quantity:0}),400,'invalid quantity');
  await failsStatus(listBooks({limit:0,offset:0}),400,'invalid limit');
  assert.equal((await direct('POST','/api/books','{broken')).status,400);
  assert.equal((await direct('POST','/api/books','{"isbn":"g2-extra","title":"Unknown","stock":0,"unexpected":true}')).status,400);
  assert.equal((await direct('POST','/api/books','{"isbn":"g2-client-201","title":"Created","stock":1}')).status,201);

  const huge = await createBook({isbn:'g2-client-max-stock',title:'Overflow',stock:2147483647});
  await failsStatus(adjustStock(huge.isbn,{quantity:1}),409,'overflow');
  assert.equal((await getBook(huge.isbn)).stock,2147483647);

  const parallel = await createBook({isbn:'g2-client-parallel',title:'Concurrent',stock:0});
  const batches = await Promise.all(Array.from({length:8},()=>adjustStock(parallel.isbn,{quantity:3})));
  assert.equal(batches.length,8);
  assert.equal((await getBook(parallel.isbn)).stock,24,'8 true parallel restocks with no lost updates');

  // Failures are surfaced as a predictable typed HttpError with real status.
  console.log('G2_REAL_HTTP_PASS_401_403_404_409_400_201_PAGINATION_CACHE_PARALLEL');
  qc.clear();
}
main().catch(err => { console.error(err);process.exitCode=1; });
