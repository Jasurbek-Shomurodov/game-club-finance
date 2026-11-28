import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Who is writing to the owner bot, through the service-role functions of
 * migrations 190 and 191. Every call is keyed by the sender's Telegram id;
 * the clubs come from the linked user's owner memberships, never from the
 * message.
 */

/** The statuses owner_bot_redeem_link_code (190) and its throttled wrapper (191) answer. */
export const LINK_STATUSES = ['linked', 'invalid', 'used', 'expired', 'not_owner', 'telegram_in_use', 'rate_limited'] as const;
export type OwnerBotLinkStatus = (typeof LINK_STATUSES)[number];

export function isOwnerBotLinkStatus(value: unknown): value is OwnerBotLinkStatus {
  return typeof value === 'string' && (LINK_STATUSES as readonly string[]).includes(value);
}

export interface OwnerBotClub {
  id: string;
  name: string;
}

/** Whether this Telegram account is linked to an app user (owner_telegram_links, read by the service role). */
export async function isOwnerBotTelegramLinked(supabase: SupabaseClient, telegramUserId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('owner_telegram_links')
    .select('user_id')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Redeems a /link code, at most 5 wrong codes per Telegram account in 15
 * minutes (191). There is deliberately no fallback to the unthrottled 190
 * function: without 191 the link fails instead of allowing endless guesses.
 */
export async function redeemOwnerBotLinkCode(
  supabase: SupabaseClient,
  { code, telegramUserId, username }: { code: string; telegramUserId: number; username: string | null },
): Promise<OwnerBotLinkStatus> {
  const { data, error } = await supabase.rpc('owner_bot_redeem_link_code_limited', {
    p_code: code,
    p_telegram_user_id: telegramUserId,
    p_username: username,
  });
  if (error) throw error;
  if (!isOwnerBotLinkStatus(data)) throw new Error('owner_bot_redeem_link_code_limited returned an unknown status');
  return data;
}

/** The active clubs the user linked to this Telegram account owns, by name. */
export async function fetchOwnerBotClubs(supabase: SupabaseClient, telegramUserId: number): Promise<OwnerBotClub[]> {
  const { data, error } = await supabase.rpc('owner_bot_owner_clubs', { p_telegram_user_id: telegramUserId });
  if (error) throw error;
  return ((data ?? []) as Array<{ id: unknown; name: unknown }>)
    .filter((row) => typeof row.id === 'string')
    .map((row) => ({ id: row.id as string, name: typeof row.name === 'string' && row.name ? row.name : '—' }));
}
