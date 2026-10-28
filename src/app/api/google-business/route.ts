import { GoogleApiError, listLocations, revokeToken } from '@/lib/googleBusiness/api';
import {
  authorizeClub,
  connectedAccessToken,
  errorResponse,
  googleConfig,
  googleErrorResponse,
  isClubId,
  loadConnection,
} from '@/lib/googleBusiness/server';
import type { GoogleLocationOption } from '@/lib/googleBusiness/posts';
import { decryptToken } from '@/lib/googleBusiness/tokenCrypto';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * The club's Google connection without its token. While no listing is chosen
 * it also lists the account's listings to pick from; until Google approves
 * API access that listing fails and `locationsError` says why.
 */
export async function GET(request: Request) {
  const clubId = new URL(request.url).searchParams.get('clubId');
  if (!isClubId(clubId)) return errorResponse('INVALID_REQUEST');
  const access = await authorizeClub(clubId, 'showcase');
  if (access instanceof Response) return access;
  const config = googleConfig();
  if (!config) return Response.json({ configured: false, connection: null });

  try {
    const connection = await loadConnection(clubId);
    if (!connection) return Response.json({ configured: true, connection: null });
    const summary = {
      googleEmail: connection.google_email,
      locationName: connection.location_name,
      locationTitle: connection.location_title,
      connectedAt: connection.connected_at,
    };
    if (connection.location_name) return Response.json({ configured: true, connection: summary });

    let locations: GoogleLocationOption[] = [];
    let locationsError: string | null = null;
    try {
      locations = await listLocations((await connectedAccessToken(config, connection)).accessToken);
    } catch (error) {
      if (!(error instanceof GoogleApiError)) throw error;
      locationsError = error.code;
    }
    return Response.json({ configured: true, connection: summary, locations, locationsError });
  } catch (error) {
    return googleErrorResponse(error, { clubId, action: 'status' });
  }
}

/** Chooses which listing the club posts to (owners only); it must belong to the connected account. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { clubId?: unknown; locationName?: unknown } | null;
  if (!body || !isClubId(body.clubId) || typeof body.locationName !== 'string') return errorResponse('INVALID_REQUEST');
  const clubId = body.clubId;
  const config = googleConfig();
  if (!config) return errorResponse('NOT_CONFIGURED');
  const access = await authorizeClub(clubId, 'owner');
  if (access instanceof Response) return access;

  try {
    const connection = await loadConnection(clubId);
    if (!connection) return errorResponse('NOT_CONNECTED');
    const locations = await listLocations((await connectedAccessToken(config, connection)).accessToken);
    const chosen = locations.find((location) => location.locationName === body.locationName);
    if (!chosen) return errorResponse('INVALID_REQUEST');
    const { error } = await createServiceClient()
      .from('google_business_connections')
      .update({
        account_name: chosen.accountName,
        location_name: chosen.locationName,
        location_title: chosen.title,
        updated_at: new Date().toISOString(),
      })
      .eq('club_id', clubId);
    if (error) throw error;
    return Response.json({ locationName: chosen.locationName, locationTitle: chosen.title });
  } catch (error) {
    return googleErrorResponse(error, { clubId, action: 'choose_location' });
  }
}

/** Disconnects (owners only): revokes the token at Google, best effort, and deletes the row. */
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null) as { clubId?: unknown } | null;
  if (!body || !isClubId(body.clubId)) return errorResponse('INVALID_REQUEST');
  const clubId = body.clubId;
  const access = await authorizeClub(clubId, 'owner');
  if (access instanceof Response) return access;

  try {
    const connection = await loadConnection(clubId);
    const config = googleConfig();
    if (connection && config) {
      const refreshToken = decryptToken(connection.refresh_token_encrypted, config.tokenSecret);
      if (refreshToken) await revokeToken(refreshToken);
    }
    const { error } = await createServiceClient().from('google_business_connections').delete().eq('club_id', clubId);
    if (error) throw error;
    return Response.json({ connected: false });
  } catch (error) {
    return googleErrorResponse(error, { clubId, action: 'disconnect' });
  }
}
