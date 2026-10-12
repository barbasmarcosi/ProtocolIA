/** ProtocolIA user-owned HTTP transport. Orval never rewrites this module. */
export class ApiHttpError<T = unknown> extends Error {
  constructor(
    public readonly status: number,
    public readonly data: T,
    public readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'ApiHttpError';
  }
}

/** Allows Orval to type thrown errors in every generated Query/mutation. */
export type ErrorType<T> = ApiHttpError<T>;

export interface TransportConfig {
  baseUrl: string;
  /** Headers supplied by application auth state, not by generated code. */
  getHeaders?: () => Record<string, string>;
}

let config: TransportConfig | undefined;
export function configureTransport(next: TransportConfig): void {
  const base = new URL(next.baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Unsupported API protocol');
  config = { ...next };
}
export function clearTransport(): void { config = undefined; }

export async function httpClient<T>(
  url: string,
  request: RequestInit = {},
): Promise<T> {
  if (!config) throw new Error('ProtocolIA transport is not configured');
  const endpoint = new URL(url, config.baseUrl).toString();
  const headers = new Headers(request.headers);
  headers.set('Accept', 'application/json');
  for (const [name, value] of Object.entries(config.getHeaders?.() ?? {})) headers.set(name, value);
  const response = await fetch(endpoint, { ...request, headers });
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('json')
    ? await response.json().catch(() => null)
    : await response.text();
  if (!response.ok) throw new ApiHttpError(response.status, payload, endpoint);
  return payload as T;
}
