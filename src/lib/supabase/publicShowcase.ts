import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import { parsePublicBrand, parsePublicShowcase, type PublicBrand, type PublicShowcase } from '@/lib/showcase';

/** Tag on every cached public page read; saving a showcase or brand clears it. */
export const PUBLIC_SHOWCASE_TAG = 'public-showcase';

/** Seconds a public page read is reused when nothing clears it sooner. */
const PUBLIC_SHOWCASE_TTL = 60;

/**
 * Anonymous client for the public pages. Uses the anon key without cookies, so
 * a visitor's session never changes what the page shows.
 */
function anonymousClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * The raw payload of a public RPC, shared by every visitor and language for a
 * minute. The database round trip is most of a public page's server time.
 * A failed call throws so it is not cached; the caller reads it as "not found".
 */
const readPublicRpc = unstable_cache(
  async (rpc: 'get_public_showcase' | 'get_public_brand', slug: string): Promise<unknown> => {
    const supabase = anonymousClient();
    if (!supabase) return null;
    const { data, error } = await supabase.rpc(rpc, { p_slug: slug });
    if (error) throw new Error(`${rpc} failed: ${error.message}`);
    return data;
  },
  ['public-showcase-rpc'],
  { revalidate: PUBLIC_SHOWCASE_TTL, tags: [PUBLIC_SHOWCASE_TAG] },
);

export async function fetchPublicShowcase(slug: string, locale: string): Promise<PublicShowcase | null> {
  const data = await readPublicRpc('get_public_showcase', slug).catch(() => null);
  return parsePublicShowcase(data, locale);
}

export async function fetchPublicBrand(slug: string, locale: string): Promise<PublicBrand | null> {
  const data = await readPublicRpc('get_public_brand', slug).catch(() => null);
  return parsePublicBrand(data, locale);
}
