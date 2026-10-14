import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Name shown as "added by" in club Telegram notifications: profile name, then
 * the auth metadata name, then email, then the user id. A failed profile read
 * falls back silently because notifications are best-effort.
 */
export async function actorName(supabase: SupabaseClient, user: User): Promise<string> {
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const profileName = typeof profile?.full_name === 'string' ? profile.full_name.trim() : '';
  const metadataName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '';
  return profileName || metadataName || user.email || user.id;
}
