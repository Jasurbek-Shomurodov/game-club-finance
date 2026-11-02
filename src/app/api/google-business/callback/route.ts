import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCode, fetchGoogleEmail, listLocations, revokeToken, type GoogleApiError } from '@/lib/googleBusiness/api';
import { OAUTH_STATE_COOKIE, callbackUrl, returnUrl, verifyState, type ConnectOutcome } from '@/lib/googleBusiness/oauth';
import { authorizeClub, googleConfig, loadConnection } from '@/lib/googleBusiness/server';
import { decryptToken, encryptToken } from '@/lib/googleBusiness/tokenCrypto';
import { createServiceClient } from '@/lib/supabase/service';

function finish(request: NextRequest, outcome: ConnectOutcome) {
  const response = NextResponse.redirect(returnUrl(request.url, outcome));
  response.cookies.set(OAUTH_STATE_COOKIE, '', { path: '/api/google-business', maxAge: 0 });
  return response;
}

/**
 * Google returns here after consent. Saves the encrypted refresh token for the
 * club and, when the account manages exactly one listing, selects it. Listing
 * the locations fails until Google approves Business Profile API access; the
 * connection is still saved and the page offers the choice later. Reconnecting
 * the same account keeps the chosen listing when that lookup fails; moving to
 * another account revokes the old account's token.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const clubId = verifyState(params.get('state'), request.cookies.get(OAUTH_STATE_COOKIE)?.value);
  if (!clubId) return finish(request, 'failed');
  if (params.get('error')) return finish(request, 'denied');
  const code = params.get('code');
  if (!code) return finish(request, 'failed');

  const config = googleConfig();
  if (!config) return finish(request, 'not_configured');
  const access = await authorizeClub(clubId, 'owner');
  if (access instanceof Response) return finish(request, 'forbidden');

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(config, code, callbackUrl(request.url));
  } catch (error) {
    console.warn('[google-business] code exchange failed', { clubId, error: (error as GoogleApiError).message });
    return finish(request, 'failed');
  }
  if (!tokens.refresh_token) {
    await revokeToken(tokens.access_token);
    return finish(request, 'no_refresh_token');
  }

  const previous = await loadConnection(clubId).catch((error: Error) => {
    console.warn('[google-business] reading the old connection failed', { clubId, error: error.message });
    return null;
  });
  const email = await fetchGoogleEmail(tokens.access_token);
  const locations = await listLocations(tokens.access_token).catch((error: GoogleApiError) => {
    console.warn('[google-business] listing locations failed', { clubId, code: error.code, error: error.message });
    return null;
  });
  // Only a known different address counts: an unknown one must not cost the
  // club its listing or its token.
  const accountChanged = Boolean(email && previous?.google_email)
    && email?.toLowerCase() !== previous?.google_email?.toLowerCase();
  const only = locations?.length === 1 ? locations[0] : null;
  // A failed lookup says nothing about the listing, so a reconnect keeps it.
  const kept = locations === null && !accountChanged ? previous : null;

  const { error } = await createServiceClient().from('google_business_connections').upsert({
    club_id: clubId,
    google_email: email,
    refresh_token_encrypted: encryptToken(tokens.refresh_token, config.tokenSecret),
    account_name: only?.accountName ?? kept?.account_name ?? null,
    location_name: only?.locationName ?? kept?.location_name ?? null,
    location_title: only?.title ?? kept?.location_title ?? null,
    connected_by: access.userId,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'club_id' });
  if (error) {
    console.error('[google-business] saving connection failed', { clubId, code: error.code, error: error.message });
    await revokeToken(tokens.refresh_token);
    return finish(request, 'failed');
  }
  // Never for the same account: Google would revoke the whole grant, new token included.
  if (accountChanged && previous) {
    const oldToken = decryptToken(previous.refresh_token_encrypted, config.tokenSecret);
    if (oldToken) await revokeToken(oldToken);
  }
  return finish(request, 'connected');
}
