import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), cacheOptions: [] as unknown[] }));
vi.mock('server-only', () => ({}));
// Run the cached function directly and record how it was cached.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown, _keys: unknown, options: unknown) => {
    mocks.cacheOptions.push(options);
    return fn;
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { PUBLIC_SHOWCASE_TAG, fetchPublicBrand, fetchPublicShowcase } = await import('./publicShowcase');

describe('public showcase reads', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('caches for a minute under the tag the refresh route clears', () => {
    expect(mocks.cacheOptions).toEqual([{ revalidate: 60, tags: [PUBLIC_SHOWCASE_TAG] }]);
  });

  it('reads the brand and club through their RPCs', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchPublicBrand('pixel-gaming', 'en')).resolves.toBeNull();
    await expect(fetchPublicShowcase('pixel', 'en')).resolves.toBeNull();
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'get_public_brand', { p_slug: 'pixel-gaming' });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'get_public_showcase', { p_slug: 'pixel' });
  });

  it('reads a failed call as not found', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchPublicBrand('pixel-gaming', 'en')).resolves.toBeNull();
  });
});
