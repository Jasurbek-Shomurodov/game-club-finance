import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ClubShowcase, ShowcaseBrand, ShowcaseGame, ShowcasePcZone } from '@/types';
import { parsePublicBrand, parsePublicShowcase, showcaseImagePath, type PublicBrand, type PublicShowcase } from '@/lib/showcase';
import { isMissingDatabaseTable } from './errors';

export const SHOWCASE_BUCKET = 'showcase';

export interface ShowcaseAdminData {
  showcase: ClubShowcase | null;
  games: ShowcaseGame[];
  zones: ShowcasePcZone[];
}

const missing = (error: { message?: string; code?: string | null } | null, table: string) =>
  isMissingDatabaseTable(error ? { code: error.code ?? undefined, message: error.message } : null, table);

/**
 * The owner's editable showcase of one club. Databases before migration 098
 * have no showcase tables; that reads as an empty showcase with `missing` set.
 */
export async function fetchShowcaseAdminData(
  supabase: SupabaseClient,
  clubId: string,
): Promise<ShowcaseAdminData & { missing: boolean }> {
  const [showcaseRes, gamesRes, zonesRes] = await Promise.all([
    supabase.from('club_showcases').select('*').eq('club_id', clubId).maybeSingle<ClubShowcase>(),
    supabase.from('showcase_games').select('*').eq('club_id', clubId)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).returns<ShowcaseGame[]>(),
    supabase.from('showcase_pc_zones').select('*').eq('club_id', clubId)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).returns<ShowcasePcZone[]>(),
  ]);
  if (missing(showcaseRes.error, 'club_showcases')) return { showcase: null, games: [], zones: [], missing: true };
  if (showcaseRes.error || gamesRes.error || zonesRes.error) throw new Error('Showcase load failed');
  return { showcase: showcaseRes.data ?? null, games: gamesRes.data ?? [], zones: zonesRes.data ?? [], missing: false };
}

/** Uploads an image into the club's folder of the public bucket and returns its public URL. */
export async function uploadShowcaseImage(
  supabase: SupabaseClient,
  clubId: string,
  kind: 'game' | 'zone' | 'hero',
  file: File,
): Promise<string> {
  const path = showcaseImagePath(clubId, kind, file.name, crypto.randomUUID());
  const { error } = await supabase.storage.from(SHOWCASE_BUCKET).upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from(SHOWCASE_BUCKET).getPublicUrl(path).data.publicUrl;
}

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

export async function fetchPublicShowcase(slug: string): Promise<PublicShowcase | null> {
  const supabase = anonymousClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_public_showcase', { p_slug: slug });
  return error ? null : parsePublicShowcase(data);
}

export async function fetchPublicBrand(slug: string): Promise<PublicBrand | null> {
  const supabase = anonymousClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_public_brand', { p_slug: slug });
  return error ? null : parsePublicBrand(data);
}

/**
 * The signed-in user's own brand page settings. Databases before migration
 * 099 have no brand table; that reads as no brand with `missing` set.
 */
export async function fetchOwnShowcaseBrand(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from('showcase_brands').select('*').eq('owner_id', userId).maybeSingle<ShowcaseBrand>();
  if (missing(error, 'showcase_brands')) return { brand: null, missing: true };
  if (error) throw new Error('Brand load failed');
  return { brand: data ?? null, missing: false };
}
