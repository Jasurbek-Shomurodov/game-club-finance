// Route: GET /api/showcase/price-card/<slug>/<itemId>.png?v=<version> — public, no sign-in.
// The branded price card of one Yandex Maps price-list item (the YML offer id
// from `npm run yandex:sync -- plan`), linked as that item's picture. Built
// only from the club's published page (get_public_showcase), so nothing
// unpublished can be drawn; pictures load only from the showcase storage
// bucket or the site's console images.
//
// Each card address carries the card's version, so a 200 is cached for good
// at the edge. A request with no `v`, or a `v` that is not the card's current
// version, is redirected to the current address: made-up values cannot make
// the function draw the card again and again.

import { NextResponse } from 'next/server';
import { SHOWCASE_SLUG_PATTERN } from '@/lib/showcase';
import { fetchPublicShowcasePayload } from '@/lib/supabase/publicShowcase';
import { yandexPriceCards } from '@/lib/yandexMaps/priceCard';
import { isPriceCardImageUrl, loadPriceCardImage } from '@/lib/yandexMaps/priceCardAssets';
import { renderPriceCardPng } from '@/lib/yandexMaps/priceCardImage';
import { buildYandexPriceItems, yandexPriceClubFromShowcase } from '@/lib/yandexMaps/priceList';

const ITEM_ID = /^[zo][0-9a-f]{1,19}$/;

/** Short-lived, so a card added or published a moment later appears soon. */
const SHORT_CACHE = 'public, max-age=60, s-maxage=300';

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': SHORT_CACHE } });
const unavailable = () => new NextResponse('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; itemId: string }> }) {
  const { slug, itemId: rawItemId } = await params;
  const itemId = rawItemId.toLowerCase().replace(/\.png$/, '');
  if (!SHOWCASE_SLUG_PATTERN.test(slug) || !ITEM_ID.test(itemId)) return notFound();

  let payload: unknown;
  try {
    payload = await fetchPublicShowcasePayload(slug);
  } catch {
    // The database read failed: not the same as a page that does not exist, and not to be cached.
    return unavailable();
  }
  const showcase = yandexPriceClubFromShowcase(payload);
  if (!showcase) return notFound();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isCardImage = (url: string) => isPriceCardImageUrl(url, supabaseUrl);
  const { items } = buildYandexPriceItems(showcase.club);
  const card = yandexPriceCards(showcase.club, items, isCardImage).find((candidate) => candidate.itemId === itemId);
  if (!card) return notFound();

  const url = new URL(request.url);
  if (url.searchParams.get('v') !== card.version) {
    const current = new URL(`/api/showcase/price-card/${encodeURIComponent(slug)}/${card.itemId}.png`, url);
    current.searchParams.set('v', card.version);
    const redirect = NextResponse.redirect(current, 307);
    redirect.headers.set('Cache-Control', SHORT_CACHE);
    return redirect;
  }

  try {
    const [background, logo] = await Promise.all([
      loadPriceCardImage(card.background, { supabaseUrl }),
      loadPriceCardImage(card.logoUrl, { supabaseUrl }),
    ]);
    const png = await renderPriceCardPng(card, { background, logo });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        // The address names this exact card: a change gives the card a new `v`.
        'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return unavailable();
  }
}
