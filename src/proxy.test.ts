import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), createClient: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createClient }));

import { proxy } from './proxy';

function request(path: string, authenticated = false) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: authenticated ? { cookie: 'sb-project-auth-token=session-placeholder' } : {},
  });
}

describe('auth routing latency', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
  });

  it('redirects an anonymous protected request without a network round trip', async () => {
    const response = await proxy(request('/daily-cash'));
    expect(response.headers.get('location')).toBe('http://localhost:3000/login?next=%2Fdaily-cash');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('renders anonymous login without calling Auth', async () => {
    const response = await proxy(request('/login'));
    expect(response.headers.get('location')).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('leaves cookie-bearing protected requests for authoritative layout validation', async () => {
    const response = await proxy(request('/daily-cash', true));
    expect(response.headers.get('location')).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('still validates a cookie on login before redirecting to the dashboard', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await proxy(request('/login', true));
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });

  it('does not redirect auth callbacks away before exchanging their code', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await proxy(request('/auth/callback?code=test'));
    expect(response.headers.get('location')).toBeNull();
  });

  it('keeps the full path and query of a deep link in next', async () => {
    const response = await proxy(request('/reports?month=2026-09&tab=owner'));
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/reports?month=2026-09&tab=owner');
  });

  it('serves the landing page at the root without login or an Auth call', async () => {
    const response = await proxy(request('/'));
    expect(response.headers.get('location')).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('does not add next for the dashboard itself', async () => {
    const response = await proxy(request('/dashboard'));
    expect(response.headers.get('location')).toBe('http://localhost:3000/login');
  });

  it('never turns a protocol-relative path into an external next', async () => {
    const response = await proxy(request('//evil.example/path'));
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe('http://localhost:3000');
    expect(location.pathname).toBe('/login');
    const next = location.searchParams.get('next');
    expect(next === null || (next.startsWith('/') && !next.startsWith('//'))).toBe(true);
  });

  it('sends a signed-in user on login to a safe next path', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await proxy(request('/login?next=%2Fdebts%3Ftab%3D1', true));
    expect(response.headers.get('location')).toBe('http://localhost:3000/debts?tab=1');
  });

  it('ignores an external next for a signed-in user on login', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await proxy(request('/login?next=https%3A%2F%2Fevil.example', true));
    expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });

  it('rejects a protocol-relative next for a signed-in user on login', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await proxy(request('/login?next=%2F%2Fevil.example', true));
    expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });
});
