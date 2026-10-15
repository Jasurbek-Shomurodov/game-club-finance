import { createClient } from '@/lib/supabase/server';
import { relatedClub } from '@/lib/supabase/memberships';
import { canAccessFeature } from '@/lib/permissions';
import type { Club, ClubMembership } from '@/types';
import type { AssistantErrorCode } from './events';

const ERROR_STATUS: Record<AssistantErrorCode, number> = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_CONFIGURED: 503,
  BUSY: 429,
  REFUSED: 200,
  TOO_LONG: 200,
  SERVER_ERROR: 500,
};

export function assistantErrorResponse(code: AssistantErrorCode) {
  return Response.json({ error: code }, { status: ERROR_STATUS[code] });
}

export type AssistantAccess =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      membership: Pick<ClubMembership, 'role' | 'feature_access'>;
      club: Club | null;
    }
  | { ok: false; response: Response };

/**
 * Authenticates the caller (auth.getUser) and requires the assistant feature
 * in the requested club. `clubId` must already be validated as a UUID.
 */
export async function authorizeAssistant(clubId: string | null): Promise<AssistantAccess> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: assistantErrorResponse('UNAUTHORIZED') };
  if (!clubId) return { ok: false, response: assistantErrorResponse('INVALID_REQUEST') };

  const { data: membership, error } = await supabase
    .from('club_memberships')
    .select('role,feature_access,clubs(name,business_day_start_hour)')
    .eq('club_id', clubId)
    .eq('user_id', user.id)
    .maybeSingle<Pick<ClubMembership, 'role' | 'feature_access' | 'clubs'>>();
  if (error) {
    console.error('[assistant] membership lookup failed', { clubId, message: error.message });
    return { ok: false, response: assistantErrorResponse('SERVER_ERROR') };
  }
  if (!membership || !canAccessFeature(membership.role, membership.feature_access, 'assistant')) {
    return { ok: false, response: assistantErrorResponse('FORBIDDEN') };
  }
  return { ok: true, supabase, membership, club: relatedClub(membership.clubs ?? null) };
}
