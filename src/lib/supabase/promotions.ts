import type { SupabaseClient } from '@supabase/supabase-js';
import type { Promotion } from '@/types';

/** Databases before migration 078 have no promotions table; treat that as no promotions. */
export function isMissingPromotionsTable(error: { message?: string; code?: string | null } | null): boolean {
  return error?.code === '42P01' || (error?.message?.includes('promotions') ?? false);
}

/** Every promotion of one club, newest first. Reads are club-scoped and RLS-filtered. */
export async function fetchPromotions(supabase: SupabaseClient, clubId: string) {
  const result = await supabase
    .from('promotions')
    .select('*')
    .eq('club_id', clubId)
    .order('created_at', { ascending: false })
    .returns<Promotion[]>();
  if (result.error && isMissingPromotionsTable(result.error)) return { data: [] as Promotion[], error: null };
  return result;
}
