import { QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  adjustStock,
  createBook,
  getGetBookQueryKey,
  getListBooksQueryKey,
  useAdjustStock,
  useCreateBook,
} from '../generated/orval/books';
import type { BookRequest, StockAdjustment } from '../generated/orval/models';

/** Schema-owned write effects imply invalidation; the cache policy below is
 * explicit and user-reviewed, not inferred from HTTP method or URL heuristics.
 * getListBooksQueryKey() is a prefix of EVERY paginated Books listing key.
 */
export async function invalidateBookCache(client: QueryClient, isbn: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: getListBooksQueryKey() }),
    client.invalidateQueries({ queryKey: getGetBookQueryKey(isbn) }),
  ]);
}

/** Non-React counterparts make the real HTTP/cache integration testable
 * outside a component. Failed writes never invalidate a valid cache entry.
 */
export async function createBookAndRefresh(client: QueryClient, request: BookRequest) {
  const book = await createBook(request);
  await invalidateBookCache(client, book.isbn);
  return book;
}
export async function adjustStockAndRefresh(client: QueryClient, isbn: string, request: StockAdjustment) {
  const book = await adjustStock(isbn, request);
  await invalidateBookCache(client, isbn);
  return book;
}

/** G3 React UI can consume generated hooks with explicit success invalidation. */
export function useCreateBookAndRefresh() {
  const client = useQueryClient();
  return useCreateBook({ mutation: { onSuccess: (book) => {
    void invalidateBookCache(client, book.isbn);
  } } });
}
export function useAdjustStockAndRefresh() {
  const client = useQueryClient();
  return useAdjustStock({ mutation: { onSuccess: (book) => {
    void invalidateBookCache(client, book.isbn);
  } } });
}
