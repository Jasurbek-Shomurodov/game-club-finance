import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchPublicShowcasePayload: vi.fn() }));
vi.mock('@/lib/supabase/publicShowcase', () => ({ fetchPublicShowcasePayload: mocks.fetchPublicShowcasePayload }));

import { yandexPriceCards } from '@/lib/yandexMaps/priceCard';
import { isPriceCardImageUrl } from '@/lib/yandexMaps/priceCardAssets';
import { buildYandexPriceItems, yandexItemId, yandexPriceClubFromShowcase } from '@/lib/yandexMaps/priceList';
import { GET } from './route';

const SUPABASE = 'https://project.supabase.co';
const OFFER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ZONE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PAYLOAD = {
  slug: 'pixel-game-club',
  club_name: 'Pixel Gaming',
  logo_url: null,
  zones: [{ id: ZONE, name: 'VIP', kind: 'pc', price_per_hour: 25000, image_url: 'https://elsewhere.example.org/vip.jpg' }],
  offers: [{ id: OFFER, title: 'VIP · 2+1 часа', price: 60000, time_window: null }],
  games: [{ id: 'g1', title: 'Dota 2', image_url: `${SUPABASE}/storage/v1/object/public/showcase/club/dota.jpg` }],
};

const request = (slug: string, itemId: string, query = '') => GET(new Request(`https://pixelgaming.uz/api/showcase/price-card/${slug}/${itemId}${query}`), {
  params: Promise.resolve({ slug, itemId }),
});

/** The card's current version, as `plan` puts it in the picture address. */
function versionOf(itemId: string) {
  const { club } = yandexPriceClubFromShowcase(PAYLOAD)!;
  const cards = yandexPriceCards(club, buildYandexPriceItems(club).items, (url) => isPriceCardImageUrl(url, SUPABASE));
  return cards.find((card) => card.itemId === itemId)!.version;
}

const OFFER_CARD = yandexItemId('offer', OFFER);

describe('GET /api/showcase/price-card/[slug]/[itemId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    mocks.fetchPublicShowcasePayload.mockResolvedValue(PAYLOAD);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('draws the item of a published page as a cacheable PNG', async () => {
    const fetchMock = vi.fn(async () => new Response(await sharp({ create: { width: 40, height: 20, channels: 3, background: '#335' } }).jpeg().toBuffer(), {
      headers: { 'content-type': 'image/jpeg' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await request('pixel-game-club', `${OFFER_CARD}.png`, `?v=${versionOf(OFFER_CARD)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400, s-maxage=31536000, immutable');
    expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({ width: 1080, height: 1080 });
    expect(mocks.fetchPublicShowcasePayload).toHaveBeenCalledWith('pixel-game-club');
    // Only the game cover in the showcase bucket is fetched, never the zone photo on another host.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(PAYLOAD.games[0].image_url, expect.anything());
  });

  it('serves the zone hour too, and draws on the gradient when the cover fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const zoneCard = yandexItemId('zone', ZONE);
    const response = await request('pixel-game-club', zoneCard, `?v=${versionOf(zoneCard)}`);
    expect(response.status).toBe(200);
  });

  it('sends a missing or stale version to the current address without drawing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const current = `https://pixelgaming.uz/api/showcase/price-card/pixel-game-club/${OFFER_CARD}.png?v=${versionOf(OFFER_CARD)}`;
    for (const query of ['', '?v=deadbeef', '?v=random-123']) {
      const response = await request('pixel-game-club', `${OFFER_CARD}.png`, query);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(current);
      expect(response.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 503, never cached, when the page cannot be read or the card cannot be drawn', async () => {
    mocks.fetchPublicShowcasePayload.mockRejectedValue(new Error('get_public_showcase failed'));
    const failed = await request('pixel-game-club', `${OFFER_CARD}.png`, '?v=x');
    expect(failed.status).toBe(503);
    expect(failed.headers.get('cache-control')).toBe('no-store');

    mocks.fetchPublicShowcasePayload.mockResolvedValue(PAYLOAD);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const render = vi.spyOn(await import('@/lib/yandexMaps/priceCardImage'), 'renderPriceCardPng').mockRejectedValueOnce(new Error('vips'));
    const broken = await request('pixel-game-club', `${OFFER_CARD}.png`, `?v=${versionOf(OFFER_CARD)}`);
    expect(broken.status).toBe(503);
    expect(broken.headers.get('cache-control')).toBe('no-store');
    render.mockRestore();
  });

  it('is a 404 for an unknown or unpublished page, an unknown item, or a malformed address', async () => {
    const unknown = await request('pixel-game-club', 'o0000000000000000000.png');
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect((await request('Pixel Game Club', `${yandexItemId('offer', OFFER)}.png`)).status).toBe(404);
    expect((await request('pixel-game-club', '../../etc.png')).status).toBe(404);
    mocks.fetchPublicShowcasePayload.mockResolvedValue(null);
    expect((await request('hidden-club', `${yandexItemId('offer', OFFER)}.png`)).status).toBe(404);
  });
});
