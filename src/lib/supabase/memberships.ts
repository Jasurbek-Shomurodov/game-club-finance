import type { SupabaseClient } from '@supabase/supabase-js';
import type { Club, ClubMembership } from '@/types';
import { isMissingDatabaseColumn } from './errors';

/** Cookie the server reads to pick the club for server-rendered pages. */
export const SELECTED_CLUB_COOKIE = 'game-club-finance-selected-club-id';

/** PostgREST returns a to-one relation as an object, or an array from some clients. */
export function relatedClub(relation: ClubMembership['clubs']): Club | null {
  if (!relation) return null;
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

// Newer columns, newest first: older databases may not have them yet.
const OPTIONAL_MEMBERSHIP_COLUMNS = ['feature_access'] as const;
const OPTIONAL_CLUB_COLUMNS = ['logo_url', 'enabled_payment_methods'] as const;
type OptionalColumn = (typeof OPTIONAL_MEMBERSHIP_COLUMNS)[number] | (typeof OPTIONAL_CLUB_COLUMNS)[number];
const OPTIONAL_COLUMNS: OptionalColumn[] = [...OPTIONAL_MEMBERSHIP_COLUMNS, ...OPTIONAL_CLUB_COLUMNS];

function membershipColumns(omit: ReadonlySet<OptionalColumn>) {
  const membership = ['club_id', 'user_id', 'role', ...OPTIONAL_MEMBERSHIP_COLUMNS.filter((column) => !omit.has(column)), 'created_at', 'updated_at'];
  const club = ['id', 'name', 'address', 'business_day_start_hour', ...OPTIONAL_CLUB_COLUMNS.filter((column) => !omit.has(column)), 'is_active', 'created_at', 'updated_at'];
  return `${membership.join(',')},clubs(${club.join(',')})`;
}

interface MembershipQueryError {
  code?: string;
  message?: string;
}

export class MembershipLoadError extends Error {
  constructor(readonly details: MembershipQueryError) {
    super(details.message || 'Could not load club memberships.');
    this.name = 'MembershipLoadError';
  }
}

/**
 * The signed-in user's memberships with their club configuration. Columns
 * added by later migrations are dropped one at a time when the database does
 * not have them yet (migrations 033 and 040). Any other error is thrown: a
 * failed read must never look like "no memberships", which would show an
 * existing member the pending-approval screen.
 */
export async function loadUserMemberships(supabase: SupabaseClient, userId: string): Promise<ClubMembership[]> {
  const omit = new Set<OptionalColumn>();

  for (;;) {
    const { data, error } = await supabase
      .from('club_memberships')
      .select(membershipColumns(omit))
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (!error) return (data as unknown as ClubMembership[] | null) ?? [];

    const missing = OPTIONAL_COLUMNS.find((column) => !omit.has(column) && isMissingDatabaseColumn(error, column));
    if (!missing) throw new MembershipLoadError(error);
    omit.add(missing);
  }
}
