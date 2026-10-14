const DEFAULT_READ_CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 100;

const READ_ONLY_RPCS = new Set([
  'get_dashboard_snapshot',
  'get_latest_stock_closings',
  'get_stock_opening_balances',
  'get_owner_profit_snapshot',
  'get_owner_profit_snapshot_with_methods',
  'get_salary_profit_snapshot',
  'get_money_report_snapshot',
  'get_finance_report_snapshot',
]);

interface CachedResponse {
  body: Uint8Array;
  expiresAt: number;
  headers: Array<[string, string]>;
  status: number;
  statusText: string;
}

interface SupabaseReadCacheOptions {
  now?: () => number;
  ttlMs?: number;
}

function responseFromCache(entry: CachedResponse): Response {
  return new Response(entry.body.slice(), {
    headers: entry.headers,
    status: entry.status,
    statusText: entry.statusText,
  });
}

function rpcName(url: URL): string | null {
  const marker = '/rest/v1/rpc/';
  const index = url.pathname.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.pathname.slice(index + marker.length));
}

function isCacheableRead(request: Request, supabaseOrigin: string): boolean {
  const url = new URL(request.url);
  if (url.origin !== supabaseOrigin || !url.pathname.includes('/rest/v1/')) return false;

  if (request.method === 'GET' || request.method === 'HEAD') return true;
  if (request.method !== 'POST') return false;

  const name = rpcName(url);
  return Boolean(name && READ_ONLY_RPCS.has(name));
}

function requestVaries(request: Request): string {
  const headers = request.headers;
  return [
    headers.get('authorization') ?? '',
    headers.get('accept-profile') ?? '',
    headers.get('content-profile') ?? '',
    headers.get('range') ?? '',
    headers.get('prefer') ?? '',
  ].join('\n');
}

/**
 * Supabase deliberately returns dynamic REST responses without browser caching.
 * Keep a very short, memory-only cache so returning to a page does not repeat
 * the same cross-region reads, and coalesce identical reads already in flight.
 * Every Supabase mutation clears the cache before and after it is sent so reads
 * made during a write cannot supply stale data to the post-save refresh.
 */
export function createSupabaseReadFetch(
  nativeFetch: typeof fetch,
  supabaseUrl: string,
  {
    now = Date.now,
    ttlMs = DEFAULT_READ_CACHE_TTL_MS,
  }: SupabaseReadCacheOptions = {},
): typeof fetch & { invalidate: () => void } {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  const cache = new Map<string, CachedResponse>();
  const inFlight = new Map<string, Promise<CachedResponse>>();
  let generation = 0;

  function clearExpired(timestamp: number) {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= timestamp) cache.delete(key);
    }
  }

  function clearAll() {
    generation += 1;
    cache.clear();
  }

  const cachedFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const cacheable = isCacheableRead(request, supabaseOrigin);

    if (url.origin === supabaseOrigin && !cacheable && request.method !== 'GET' && request.method !== 'HEAD') {
      clearAll();
      try {
        return await nativeFetch(request);
      } finally {
        // Also advance the generation: pending reads from before the write
        // completed must neither be reused nor repopulate the current cache.
        clearAll();
      }
    }

    if (!cacheable || ttlMs <= 0) return nativeFetch(request);

    const body = request.method === 'POST' ? await request.clone().text() : '';
    const requestGeneration = generation;
    const key = `${requestGeneration}\n${request.method}\n${request.url}\n${requestVaries(request)}\n${body}`;
    const timestamp = now();
    clearExpired(timestamp);

    const cached = cache.get(key);
    if (cached && cached.expiresAt > timestamp) return responseFromCache(cached);

    let pending = inFlight.get(key);
    if (!pending) {
      pending = (async () => {
        const response = await nativeFetch(request);
        const entry: CachedResponse = {
          body: new Uint8Array(await response.arrayBuffer()),
          expiresAt: now() + ttlMs,
          headers: Array.from(response.headers.entries()),
          status: response.status,
          statusText: response.statusText,
        };

        if (
          requestGeneration === generation
          && response.ok
          && (response.status === 200 || response.status === 206)
        ) {
          cache.set(key, entry);
          while (cache.size > MAX_CACHE_ENTRIES) {
            const oldestKey = cache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            cache.delete(oldestKey);
          }
        }

        return entry;
      })().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, pending);
    }

    const entry = await pending;
    return responseFromCache(entry);
  };
  return Object.assign(cachedFetch, { invalidate: clearAll });
}
