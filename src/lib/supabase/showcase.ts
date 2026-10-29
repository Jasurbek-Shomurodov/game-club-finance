import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClubShowcase, ShowcaseBrand, ShowcaseGame, ShowcaseOffer, ShowcasePcZone } from '@/types';
import { showcaseImagePath, type ShowcaseImageKind } from '@/lib/showcase';
import { isMissingDatabaseTable } from './errors';
import { fetchAllRows } from './pagination';

export const SHOWCASE_BUCKET = 'showcase';

export interface ShowcaseAdminData {
  showcase: ClubShowcase | null;
  games: ShowcaseGame[];
  zones: ShowcasePcZone[];
  offers: ShowcaseOffer[];
  /** Migration 102 has not reached this database; offers cannot be edited yet. */
  offersMissing: boolean;
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
  const [showcaseRes, gamesRes, zonesRes, offersRes] = await Promise.all([
    supabase.from('club_showcases').select('*').eq('club_id', clubId).maybeSingle<ClubShowcase>(),
    supabase.from('showcase_games').select('*').eq('club_id', clubId)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).returns<ShowcaseGame[]>(),
    supabase.from('showcase_pc_zones').select('*').eq('club_id', clubId)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).returns<ShowcasePcZone[]>(),
    supabase.from('showcase_offers').select('*').eq('club_id', clubId)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).returns<ShowcaseOffer[]>(),
  ]);
  if (missing(showcaseRes.error, 'club_showcases')) {
    return { showcase: null, games: [], zones: [], offers: [], offersMissing: true, missing: true };
  }
  const offersMissing = missing(offersRes.error, 'showcase_offers');
  if (showcaseRes.error || gamesRes.error || zonesRes.error || (offersRes.error && !offersMissing)) throw new Error('Showcase load failed');
  return {
    showcase: showcaseRes.data ?? null,
    games: gamesRes.data ?? [],
    zones: zonesRes.data ?? [],
    offers: offersMissing ? [] : offersRes.data ?? [],
    offersMissing,
    missing: false,
  };
}

/** Uploads an image into the club's folder of the public bucket and returns its public URL. */
export async function uploadShowcaseImage(
  supabase: SupabaseClient,
  clubId: string,
  kind: ShowcaseImageKind,
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
 * The signed-in user's own brand page settings. Databases before migration
 * 099 have no brand table; that reads as no brand with `missing` set.
 */
export async function fetchOwnShowcaseBrand(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from('showcase_brands').select('*').eq('owner_id', userId).maybeSingle<ShowcaseBrand>();
  if (missing(error, 'showcase_brands')) return { brand: null, missing: true };
  if (error) throw new Error('Brand load failed');
  return { brand: data ?? null, missing: false };
}

/**
 * Every showcase game of the given clubs, for the game library. RLS returns
 * only clubs the user may edit; callers pass those clubs' ids anyway.
 */
export async function fetchShowcaseGamesForClubs(supabase: SupabaseClient, clubIds: string[]) {
  if (clubIds.length === 0) return { data: [] as ShowcaseGame[], error: null };
  return fetchAllRows<ShowcaseGame>(() => supabase
    .from('showcase_games')
    .select('*')
    .in('club_id', clubIds)
    .order('club_id', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true }));
}
