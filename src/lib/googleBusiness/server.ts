import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { GoogleApiError, refreshAccessToken, v4LocationPath } from './api';
import { readGoogleOAuthConfig, type GoogleOAuthConfig } from './oauth';
import { decryptToken } from './tokenCrypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isClubId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

const STATUS = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_CONFIGURED: 503,
  NOT_CONNECTED: 409,
  NO_LOCATION: 409,
  GOOGLE_RECONNECT: 409,
  GOOGLE_QUOTA: 429,
  GOOGLE_FORBIDDEN: 502,
  GOOGLE_INVALID: 422,
  GOOGLE_FAILED: 502,
  SERVER_ERROR: 500,
} as const;
export type GoogleRouteError = keyof typeof STATUS;

export function errorResponse(code: GoogleRouteError) {
  return Response.json({ code }, { status: STATUS[code] });
}

export function googleConfig(): GoogleOAuthConfig | null {
  return readGoogleOAuthConfig(process.env);
}

export type ClubAccess = 'owner' | 'showcase';

/**
 * Validates the user with auth.getUser() and asks the database, as that user,
 * whether they may act for the club: the owner role to connect or disconnect,
 * the showcase feature (owners and grantees, migration 103) to post.
 */
export async function authorizeClub(clubId: string, need: ClubAccess): Promise<{ userId: string } | Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse('UNAUTHORIZED');
  const { data, error } = need === 'owner'
    ? await supabase.rpc('current_user_club_role', { p_club_id: clubId })
    : await supabase.rpc('current_user_can_access_club_feature', { p_club_id: clubId, p_feature_key: 'showcase' });
  if (error) {
    console.error('[google-business] access check failed', { clubId, need, code: error.code, error: error.message });
    return errorResponse('SERVER_ERROR');
  }
  const allowed = need === 'owner' ? data === 'owner' : data === true;
  return allowed ? { userId: user.id } : errorResponse('FORBIDDEN');
}

export interface GoogleConnectionRow {
  club_id: string;
  google_email: string | null;
  refresh_token_encrypted: string;
  account_name: string | null;
  location_name: string | null;
  location_title: string | null;
  connected_at: string;
}

export async function loadConnection(clubId: string): Promise<GoogleConnectionRow | null> {
  const { data, error } = await createServiceClient()
    .from('google_business_connections')
    .select('club_id, google_email, refresh_token_encrypted, account_name, location_name, location_title, connected_at')
    .eq('club_id', clubId)
    .maybeSingle();
  if (error) throw error;
  return data as GoogleConnectionRow | null;
}

/** A fresh access token for the club's saved connection. */
export async function connectedAccessToken(config: GoogleOAuthConfig, connection: GoogleConnectionRow) {
  const refreshToken = decryptToken(connection.refresh_token_encrypted, config.tokenSecret);
  // A rotated GOOGLE_TOKEN_ENCRYPTION_KEY makes the saved token unreadable.
  if (!refreshToken) throw new GoogleApiError('RECONNECT', 'Stored Google token cannot be decrypted');
  return { refreshToken, accessToken: await refreshAccessToken(config, refreshToken) };
}

export function locationPath(connection: GoogleConnectionRow): string | null {
  return connection.account_name && connection.location_name
    ? v4LocationPath(connection.account_name, connection.location_name)
    : null;
}

export function googleErrorResponse(error: unknown, context: Record<string, unknown>) {
  if (error instanceof GoogleApiError) {
    if (error.code !== 'INVALID') console.warn('[google-business] google call failed', { ...context, code: error.code, status: error.status, error: error.message });
    const map: Record<GoogleApiError['code'], GoogleRouteError> = {
      RECONNECT: 'GOOGLE_RECONNECT',
      QUOTA: 'GOOGLE_QUOTA',
      FORBIDDEN: 'GOOGLE_FORBIDDEN',
      NOT_FOUND: 'GOOGLE_FORBIDDEN',
      INVALID: 'GOOGLE_INVALID',
      FAILED: 'GOOGLE_FAILED',
    };
    return errorResponse(map[error.code]);
  }
  console.error('[google-business] request failed', { ...context, error: error instanceof Error ? error.message : String(error) });
  return errorResponse('SERVER_ERROR');
}

/**
 * Shared prelude of the post and photo routes: a configured app, a user with
 * the showcase feature, and a connection with a chosen listing.
 */
export async function connectedLocation(clubId: unknown) {
  if (!isClubId(clubId)) return errorResponse('INVALID_REQUEST');
  const config = googleConfig();
  if (!config) return errorResponse('NOT_CONFIGURED');
  const access = await authorizeClub(clubId, 'showcase');
  if (access instanceof Response) return access;
  const connection = await loadConnection(clubId);
  if (!connection) return errorResponse('NOT_CONNECTED');
  const path = locationPath(connection);
  if (!path) return errorResponse('NO_LOCATION');
  const { accessToken } = await connectedAccessToken(config, connection);
  return { clubId, accessToken, path };
}
