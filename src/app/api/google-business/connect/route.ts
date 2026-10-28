import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { OAUTH_STATE_COOKIE, buildAuthUrl, buildState, callbackUrl, returnUrl } from '@/lib/googleBusiness/oauth';
import { authorizeClub, googleConfig, isClubId } from '@/lib/googleBusiness/server';

/**
 * Starts the Google sign-in for a club's listing (owners only). The nonce in
 * the state is also set as an httpOnly cookie, so the callback accepts only a
 * consent this browser started.
 */
export async function GET(request: Request) {
  const clubId = new URL(request.url).searchParams.get('clubId');
  if (!isClubId(clubId)) return NextResponse.redirect(returnUrl(request.url, 'failed'));
  const config = googleConfig();
  if (!config) return NextResponse.redirect(returnUrl(request.url, 'not_configured'));
  const access = await authorizeClub(clubId, 'owner');
  if (access instanceof Response) return NextResponse.redirect(returnUrl(request.url, 'forbidden'));

  const nonce = randomBytes(24).toString('base64url');
  const response = NextResponse.redirect(buildAuthUrl(config, callbackUrl(request.url), buildState(clubId, nonce)));
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/google-business',
    maxAge: 600,
  });
  return response;
}
