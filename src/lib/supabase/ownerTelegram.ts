import type { SupabaseClient } from '@supabase/supabase-js';
import type { OwnerTelegramLink } from '@/types';
import { isMissingDatabaseTable } from './errors';

export interface OwnTelegramLinkResult {
  link: OwnerTelegramLink | null;
  /** False before migration 190 is applied: the Settings card is hidden, not an error. */
  available: boolean;
}

export interface OwnerTelegramLinkCode {
  code: string;
  expiresAt: string;
}

/** The signed-in user's own owner-bot link (RLS lets each user read only their own row). */
export async function fetchOwnTelegramLink(supabase: SupabaseClient, userId: string): Promise<OwnTelegramLinkResult> {
  const { data, error } = await supabase
    .from('owner_telegram_links')
    .select('user_id,telegram_user_id,telegram_username,linked_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isMissingDatabaseTable(error, 'owner_telegram_links')) return { link: null, available: false };
    throw error;
  }
  const row = data as (Omit<OwnerTelegramLink, 'telegram_user_id'> & { telegram_user_id: unknown }) | null;
  return {
    link: row ? { ...row, telegram_user_id: Number(row.telegram_user_id), telegram_username: row.telegram_username ?? null } : null,
    available: true,
  };
}

/** A new one-time code for /link in the owner bot; the caller's earlier unused codes stop working. */
export async function createOwnerTelegramLinkCode(supabase: SupabaseClient): Promise<OwnerTelegramLinkCode> {
  const { data, error } = await supabase.rpc('create_owner_telegram_link_code');
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { code?: unknown; expires_at?: unknown } | null;
  if (!row || typeof row.code !== 'string' || typeof row.expires_at !== 'string') {
    throw new Error('create_owner_telegram_link_code returned no code');
  }
  return { code: row.code, expiresAt: row.expires_at };
}

/** Removes the signed-in user's own link; false when there was none left to remove. */
export async function unlinkOwnTelegram(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('owner_telegram_links')
    .delete()
    .eq('user_id', userId)
    .select('user_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}
