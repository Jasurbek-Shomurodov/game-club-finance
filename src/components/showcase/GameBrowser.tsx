'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Gamepad2, Search } from 'lucide-react';
import type { PublicShowcaseGame } from '@/lib/showcase';
import { ShimmerImage } from './ShimmerImage';

/** Covers shown before "Show all": two rows on a wide screen. */
const FIRST_PAGE = 12;

/**
 * The club's game library, answerable in one glance: type a title to see
 * whether it is installed, or narrow by genre. Shows two rows until asked for
 * the rest, so a long library does not push the map and contacts away.
 */
export function GameBrowser({ games }: { games: PublicShowcaseGame[] }) {
  const t = useTranslations('publicShowcase');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const genres = useMemo(() => [...new Set(games.flatMap((game) => (game.genre ? [game.genre] : [])))], [games]);
  const needle = query.trim().toLocaleLowerCase();
  const matching = games.filter((game) => (!genre || game.genre === genre) && (!needle || game.title.toLocaleLowerCase().includes(needle)));
  const filtering = Boolean(needle) || genre !== null;
  const shown = expanded || filtering ? matching : matching.slice(0, FIRST_PAGE);
  const chip = 'sc-chip inline-flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-xs font-semibold uppercase tracking-wider';

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative block lg:w-80">
          <span className="sr-only">{t('gamesSearch')}</span>
          <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/60" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('gamesSearch')}
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.05] pl-11 pr-4 text-base text-white placeholder:text-white/50 focus-visible:border-violet-300/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50"
          />
        </label>
        {genres.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={t('gamesGenres')}>
            <button type="button" aria-pressed={genre === null} onClick={() => setGenre(null)} className={chip}>{t('gamesAll')}</button>
            {genres.map((name) => (
              <button key={name} type="button" aria-pressed={genre === name} onClick={() => setGenre(genre === name ? null : name)} className={chip}>{name}</button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 text-sm text-white/70" role="status">
        {matching.length === 0 ? t('gamesNoMatch') : filtering ? t('gamesFound', { count: matching.length }) : t('gamesInstalled', { count: games.length })}
      </p>

      {shown.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 lg:grid-cols-6">
          {shown.map((game) => (
            <li key={game.id} className="sc-game relative aspect-[3/4] overflow-hidden rounded-xl bg-[#0d0d18] ring-1 ring-white/10 sm:rounded-2xl">
              <span className="sc-game-media absolute inset-0 block">
                {game.image_url ? (
                  <ShimmerImage src={game.image_url} alt="" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-violet-600/30 to-violet-400/10">
                    <Gamepad2 size={32} className="text-white/60" aria-hidden="true" />
                  </span>
                )}
              </span>
              <span className="absolute inset-x-0 bottom-0 z-[1] block bg-gradient-to-t from-black/95 via-black/65 to-transparent p-2.5 pt-10 sm:p-3 sm:pt-12">
                <span className="block text-xs font-semibold leading-tight text-white sm:text-sm">{game.title}</span>
                {game.genre && <span className="mt-0.5 hidden text-[0.7rem] font-medium uppercase tracking-wider text-white/65 sm:block">{game.genre}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!filtering && matching.length > FIRST_PAGE && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="sc-chip inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold"
          >
            {expanded ? t('gamesShowLess') : t('gamesShowAll', { count: games.length })}
          </button>
        </div>
      )}
    </div>
  );
}
