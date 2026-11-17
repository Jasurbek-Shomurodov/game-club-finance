import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));

const { GET } = await import('./route');

const SECRET = 'test-cron-secret-123456';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/cron/google-review-replies', () => {
  it('refuses a request without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const response = await GET(new Request('http://localhost/api/cron/google-review-replies'));
    expect(response.status).toBe(401);
  });

  it('reports a missing cron secret as a configuration error', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const response = await GET(new Request('http://localhost/api/cron/google-review-replies'));
    expect(response.status).toBe(500);
  });

  it('does nothing when Google is not configured', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '');
    const response = await GET(new Request('http://localhost/api/cron/google-review-replies', { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(response.status).toBe(503);
  });
});
