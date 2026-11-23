import type { PublicShowcaseGame, PublicShowcaseZone } from '@/lib/showcase';

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

/** Cover image for a tile: the first game or zone image that exists. */
export function firstImage(games: PublicShowcaseGame[], zones: PublicShowcaseZone[]): string | null {
  return games.find((game) => game.image_url)?.image_url ?? zones.find((zone) => zone.image_url)?.image_url ?? null;
}
