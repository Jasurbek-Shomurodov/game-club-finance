import type { ShowcaseGame } from '@/types';

/** A game anyone on the team has added to any of their clubs' public pages. */
export interface LibraryGame {
  key: string;
  title: string;
  genre: string | null;
  image_url: string | null;
  /** How many clubs list this game. */
  clubCount: number;
}

type GameSource = Pick<ShowcaseGame, 'club_id' | 'title' | 'genre' | 'image_url'>;

/** Titles match regardless of case, spacing and dash style: "CS 2" and "cs  2" are one game. */
export function gameKey(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * Every distinct game across the given clubs, alphabetical. When clubs list
 * the same title, the copy with a cover (then a genre) wins.
 */
export function buildGameLibrary(games: GameSource[]): LibraryGame[] {
  const byKey = new Map<string, LibraryGame & { clubs: Set<string> }>();
  for (const game of games) {
    const title = game.title.trim();
    if (!title) continue;
    const key = gameKey(title);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { key, title, genre: game.genre, image_url: game.image_url, clubCount: 0, clubs: new Set([game.club_id]) });
      continue;
    }
    current.clubs.add(game.club_id);
    if (!current.image_url && game.image_url) current.image_url = game.image_url;
    if (!current.genre && game.genre) current.genre = game.genre;
  }
  return [...byKey.values()]
    .map(({ clubs, ...game }) => ({ ...game, clubCount: clubs.size }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
}

/** Genres in the library, most common first, for filter chips. */
export function libraryGenres(library: LibraryGame[]): string[] {
  const counts = new Map<string, number>();
  for (const game of library) if (game.genre) counts.set(game.genre, (counts.get(game.genre) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([genre]) => genre);
}

export function filterLibrary(library: LibraryGame[], search: string, genre: string | null): LibraryGame[] {
  const query = gameKey(search);
  return library.filter((game) => (!genre || game.genre === genre) && (!query || game.key.includes(query)));
}

/**
 * What saving the selection changes for one club: library games to copy in
 * (after the club's last game, in library order) and the club's games to remove.
 */
export function diffGameSelection(
  clubGames: Array<Pick<ShowcaseGame, 'id' | 'title' | 'sort_order'>>,
  selectedKeys: ReadonlySet<string>,
  library: LibraryGame[],
) {
  const clubKeys = new Set(clubGames.map((game) => gameKey(game.title)));
  let sortOrder = clubGames.reduce((max, game) => Math.max(max, game.sort_order), 0);
  const toAdd = library
    .filter((game) => selectedKeys.has(game.key) && !clubKeys.has(game.key))
    .map((game) => {
      sortOrder += 10;
      return { title: game.title, genre: game.genre, image_url: game.image_url, sort_order: sortOrder };
    });
  const toRemove = clubGames.filter((game) => !selectedKeys.has(gameKey(game.title))).map((game) => game.id);
  return { toAdd, toRemove };
}
