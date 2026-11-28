import { createBrowserClient } from '@supabase/ssr';
import { createSupabaseReadFetch } from './readCache';

type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>;

let browserClient: BrowserSupabaseClient | undefined;
let cachedFetch: ReturnType<typeof createSupabaseReadFetch> | undefined;

export function createClient() {
  if (!browserClient) {
    cachedFetch ??= createSupabaseReadFetch(
      window.fetch.bind(window),
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
    );
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { fetch: cachedFetch } },
    );
  }

  return browserClient;
}

/** API routes write outside the browser Supabase client; invalidate on both
 * sides of the request, including failures with an uncertain commit outcome. */
export async function mutateFinanceRequest(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  cachedFetch?.invalidate();
  try {
    return await window.fetch(input, init);
  } finally {
    cachedFetch?.invalidate();
  }
}

/** Drops every cached read, for data written outside the app (the owner
 * Telegram bot), so the next read asks the database again. */
export function invalidateReadCache(): void {
  cachedFetch?.invalidate();
}
