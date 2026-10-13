import { QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  increaseQuantity,
  createTool,
  renameTool,
  getGetToolQueryKey,
  getListToolsQueryKey,
  useIncreaseQuantity,
  useCreateTool,
  useRenameTool,
} from '../generated/orval/tools';
import type { ToolRequest, QuantityAdjustment, ToolNameChange } from '../generated/orval/models';

/** Schema-owned write effects imply invalidation; the cache policy below is
 * explicit and user-reviewed, not inferred from HTTP method or URL heuristics.
 * getListToolsQueryKey() is a prefix of EVERY paginated Tools listing key.
 */
export async function invalidateToolCache(client: QueryClient, code: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: getListToolsQueryKey() }),
    client.invalidateQueries({ queryKey: getGetToolQueryKey(code) }),
  ]);
}

/** Non-React counterparts make the real HTTP/cache integration testable
 * outside a component. Failed writes never invalidate a valid cache entry.
 */
export async function createToolAndRefresh(client: QueryClient, request: ToolRequest) {
  const tool = await createTool(request);
  await invalidateToolCache(client, tool.code);
  return tool;
}
export async function increaseQuantityAndRefresh(client: QueryClient, code: string, request: QuantityAdjustment) {
  const tool = await increaseQuantity(code, request);
  await invalidateToolCache(client, code);
  return tool;
}

/** G3 React UI can consume generated hooks with explicit success invalidation. */
export function useCreateToolAndRefresh() {
  const client = useQueryClient();
  return useCreateTool({ mutation: { onSuccess: (tool) => {
    void invalidateToolCache(client, tool.code);
  } } });
}
export function useIncreaseQuantityAndRefresh() {
  const client = useQueryClient();
  return useIncreaseQuantity({ mutation: { onSuccess: (tool) => {
    void invalidateToolCache(client, tool.code);
  } } });
}

/** Explicit write invalidation for contract-declared title mutation. */
export async function renameToolAndRefresh(client: QueryClient, code: string, request: ToolNameChange) {
  const tool = await renameTool(code, request);
  await invalidateToolCache(client, code);
  return tool;
}
export function useRenameToolAndRefresh() {
  const client = useQueryClient();
  return useRenameTool({ mutation: { onSuccess: (tool) => {
    void invalidateToolCache(client, tool.code);
  } } });
}
