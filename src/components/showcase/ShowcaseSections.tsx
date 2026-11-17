import { getLocale, getTranslations } from 'next-intl/server';
import { formatCurrency } from '@/lib/formatters';
import type { PublicShowcaseGame, PublicShowcaseOffer, PublicShowcaseZone } from '@/lib/showcase';

export interface SectionTile {
  href: string;
  label: string;
  image: string | null;
}

/** Yandex-style tile row: one square tile per section of the page, with a cover image. */
export async function SectionTiles({ tiles, label }: { tiles: SectionTile[]; label: string }) {
  if (tiles.length === 0) return null;
  return (
    <nav aria-label={label} className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <ul className="flex snap-x gap-3 overflow-x-auto pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-4 sm:overflow-visible">
        {tiles.map((tile) => (
          <li key={tile.href} className="snap-start">
            <a href={tile.href} className="group block w-28 sm:w-full">
              <span className="relative block aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                {tile.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tile.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : null}
                <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" aria-hidden="true" />
              </span>
              <span className="mt-2 block truncate text-center text-sm font-semibold text-white/90">{tile.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** "Goods and services": every zone with its hourly rate, plus the club's offers. */
export async function PriceList({ zones, offers }: { zones: PublicShowcaseZone[]; offers: PublicShowcaseOffer[] }) {
  const t = await getTranslations('publicShowcase');
  const tc = await getTranslations('common');
  const locale = await getLocale();
  const priced = zones.filter((zone) => zone.price_per_hour !== null);
  if (priced.length === 0 && offers.length === 0) return null;

  return (
    <section id="prices" className="relative scroll-mt-16 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
      <div className="relative mx-auto max-w-3xl">
        <h2 className="sc-display text-3xl font-black text-white sm:text-4xl">{t('pricesTitle')}</h2>
        <p className="mt-2 text-sm text-white/60">{t('pricesDescription')}</p>

        {priced.length > 0 && (
          <ul className="sc-glass mt-8 divide-y divide-white/10 overflow-hidden rounded-3xl">
            {priced.map((zone) => (
              <li key={zone.id} className="flex items-center gap-4 px-5 py-4">
                {zone.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={zone.image_url} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="h-14 w-14 shrink-0 rounded-xl bg-white/10" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{zone.name}</p>
                  <p className="truncate text-xs text-white/50">
                    {zone.kind === 'playstation' ? t('priceConsoles', { count: zone.pc_count }) : t('pricePcs', { count: zone.pc_count })}
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="block font-bold text-white">{formatCurrency(zone.price_per_hour ?? 0, locale)} {tc('currency')}</span>
                  <span className="block text-xs text-white/50">{t('rateHourly')}</span>
                </p>
              </li>
            ))}
          </ul>
        )}

        {offers.length > 0 && (
          <ul className="mt-6 space-y-3">
            {offers.map((offer) => (
              <li key={offer.id} className="sc-glass flex items-start justify-between gap-4 rounded-2xl px-5 py-4">
                <div className="min-w-0">
                  <p className="font-semibold text-white">{offer.title}</p>
                  {offer.time_window && <p className="text-xs text-white/50">{offer.time_window}</p>}
                </div>
                {offer.price !== null && (
                  <p className="shrink-0 font-bold text-lime-400">{formatCurrency(offer.price, locale)} {tc('currency')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Cover image for a tile: the first game or zone image that exists. */
export function firstImage(games: PublicShowcaseGame[], zones: PublicShowcaseZone[]): string | null {
  return games.find((game) => game.image_url)?.image_url ?? zones.find((zone) => zone.image_url)?.image_url ?? null;
}
