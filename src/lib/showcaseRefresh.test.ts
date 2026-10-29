import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshPublicShowcase } from './showcaseRefresh';

describe('refreshPublicShowcase', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the server to clear the public page cache', () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetch);
    refreshPublicShowcase();
    expect(fetch).toHaveBeenCalledWith('/api/showcase/refresh', { method: 'POST' });
  });

  it('swallows a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(() => refreshPublicShowcase()).not.toThrow();
    await Promise.resolve();
  });
});
