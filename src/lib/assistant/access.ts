import { z } from 'zod';
import { AssistantError } from 'hoggish-assistant/server';
import { createClient } from '@/lib/supabase/server';
import { relatedClub } from '@/lib/supabase/memberships';
import { canAccessFeature } from '@/lib/permissions';
import type { Club, ClubMembership } from '@/types';
import { ASSISTANT_LOCALES, type AssistantLocale } from './locales';

const contextSchema = z.object({
  clubId: z.string().uuid(),
  locale: z.enum(ASSISTANT_LOCALES),
});

export interface AssistantAccess {
  /** The member's own server client: RLS authorizes every read. */
  supabase: Awaited<ReturnType<typeof createClient>>;
  clubId: string;
  locale: AssistantLocale;
  membership: Pick<ClubMembership, 'role' | 'feature_access'>;
  club: Club | null;
}

/**
 * Authenticates the caller (auth.getUser) and requires the assistant feature
 * in the requested club. `context` is the browser's unvalidated request
 * context. Returns null for UNAUTHORIZED and throws AssistantError otherwise.
 */
export async function authorizeAssistant(context: unknown): Promise<AssistantAccess | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const parsed = contextSchema.safeParse(context);
  if (!parsed.success) throw new AssistantError('INVALID_REQUEST');
  const { clubId, locale } = parsed.data;

  const { data: membership, error } = await supabase
    .from('club_memberships')
    .select('role,feature_access,clubs(name,business_day_start_hour)')
    .eq('club_id', clubId)
    .eq('user_id', user.id)
    .maybeSingle<Pick<ClubMembership, 'role' | 'feature_access' | 'clubs'>>();
  if (error) {
    console.error('[assistant] membership lookup failed', { clubId, message: error.message });
    throw new AssistantError('SERVER_ERROR');
  }
  if (!membership || !canAccessFeature(membership.role, membership.feature_access, 'assistant')) {
    throw new AssistantError('FORBIDDEN');
  }
  return {
    supabase,
    clubId,
    locale,
    membership: { role: membership.role, feature_access: membership.feature_access },
    club: relatedClub(membership.clubs ?? null),
  };
}
