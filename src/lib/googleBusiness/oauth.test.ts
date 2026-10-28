import { describe, expect, it } from 'vitest';
import { buildAuthUrl, buildState, callbackUrl, readGoogleOAuthConfig, returnUrl, verifyState } from './oauth';
import { decryptToken, encryptToken } from './tokenCrypto';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const NONCE = 'abcdefghijklmnopqrstuvwx';
const SECRET = 'a-long-random-secret-of-more-than-32-characters';

describe('readGoogleOAuthConfig', () => {
  it('needs all three variables and a long encryption key', () => {
    const env = { GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_ENCRYPTION_KEY: SECRET };
    expect(readGoogleOAuthConfig(env)).toEqual({ clientId: 'id', clientSecret: 'secret', tokenSecret: SECRET });
    expect(readGoogleOAuthConfig({ ...env, GOOGLE_OAUTH_CLIENT_SECRET: ' ' })).toBeNull();
    expect(readGoogleOAuthConfig({ ...env, GOOGLE_TOKEN_ENCRYPTION_KEY: 'short' })).toBeNull();
  });
});

describe('OAuth URLs and state', () => {
  it('asks for offline Business Profile access with the callback on the same host', () => {
    const redirect = callbackUrl('https://admin.pixelgaming.uz/api/google-business/connect?clubId=x');
    expect(redirect).toBe('https://admin.pixelgaming.uz/api/google-business/callback');
    const url = new URL(buildAuthUrl({ clientId: 'id', clientSecret: 's', tokenSecret: SECRET }, redirect, 'state-1'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'id',
      redirect_uri: redirect,
      scope: 'openid email https://www.googleapis.com/auth/business.manage',
      access_type: 'offline',
      prompt: 'consent',
      state: 'state-1',
    });
  });

  it('accepts a state only with the matching cookie nonce', () => {
    const state = buildState(CLUB, NONCE);
    expect(verifyState(state, NONCE)).toBe(CLUB);
    expect(verifyState(state, 'abcdefghijklmnopqrstuvwy')).toBeNull();
    expect(verifyState(state, undefined)).toBeNull();
    expect(verifyState(null, NONCE)).toBeNull();
    expect(verifyState(`not-a-club.${NONCE}`, NONCE)).toBeNull();
    expect(verifyState(`${state}.extra`, NONCE)).toBeNull();
  });

  it('returns to the Google tab with the outcome', () => {
    expect(returnUrl('https://admin.pixelgaming.uz/api/google-business/callback?code=x', 'connected'))
      .toBe('https://admin.pixelgaming.uz/showcase/google?google=connected');
  });
});

describe('token encryption', () => {
  it('round-trips and refuses another key or a tampered value', () => {
    const stored = encryptToken('1//refresh-token', SECRET);
    expect(stored).not.toContain('refresh-token');
    expect(stored).not.toBe(encryptToken('1//refresh-token', SECRET));
    expect(decryptToken(stored, SECRET)).toBe('1//refresh-token');
    expect(decryptToken(stored, `${SECRET}x`)).toBeNull();
    const [version, iv, tag, data] = stored.split('.');
    const tamperedTag = `${tag[0] === 'A' ? 'B' : 'A'}${tag.slice(1)}`;
    expect(decryptToken([version, iv, tamperedTag, data].join('.'), SECRET)).toBeNull();
    expect(decryptToken('plain-token', SECRET)).toBeNull();
  });
});
