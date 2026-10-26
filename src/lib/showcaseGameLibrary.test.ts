import { describe, expect, it } from 'vitest';
import { buildGameLibrary, diffGameSelection, filterLibrary, gameKey, libraryGenres } from './showcaseGameLibrary';

const games = [
  { club_id: 'pixel', title: 'Counter-Strike 2', genre: 'Shooter', image_url: null },
  { club_id: 'algoritm', title: ' counter-strike  2 ', genre: null, image_url: 'https://cdn/cs2.jpg' },
  { club_id: 'pixel', title: 'Dota 2', genre: 'MOBA', image_url: 'https://cdn/dota.jpg' },
  { club_id: 'pixel', title: 'Command & Conquer: Generals – Zero Hour', genre: 'Strategy', image_url: null },
  { club_id: 'pixel', title: 'Call of Duty 4', genre: 'Shooter', image_url: null },
  { club_id: 'pixel', title: '   ', genre: null, image_url: null },
];

describe('game library', () => {
  it('merges the same title across clubs and keeps a cover and genre', () => {
    const library = buildGameLibrary(games);
    expect(library.map((game) => game.title)).toEqual(['Call of Duty 4', 'Command & Conquer: Generals – Zero Hour', 'Counter-Strike 2', 'Dota 2']);
    expect(library.find((game) => game.key === gameKey('Counter-Strike 2'))).toMatchObject({ genre: 'Shooter', image_url: 'https://cdn/cs2.jpg', clubCount: 2 });
  });

  it('lists genres by use and filters by search and genre', () => {
    const library = buildGameLibrary(games);
    expect(libraryGenres(library)).toEqual(['Shooter', 'MOBA', 'Strategy']);
    expect(filterLibrary(library, 'zero  hour', null).map((game) => game.title)).toEqual(['Command & Conquer: Generals – Zero Hour']);
    expect(filterLibrary(library, '', 'Shooter')).toHaveLength(2);
  });

  it('adds newly selected games after the club list and removes unselected ones', () => {
    const library = buildGameLibrary(games);
    const clubGames = [{ id: 'g1', title: 'Dota 2', sort_order: 30 }, { id: 'g2', title: 'Old game', sort_order: 40 }];
    const selected = new Set([gameKey('Dota 2'), gameKey('Counter-Strike 2'), gameKey('Call of Duty 4')]);
    expect(diffGameSelection(clubGames, selected, library)).toEqual({
      toAdd: [
        { title: 'Call of Duty 4', genre: 'Shooter', image_url: null, sort_order: 50 },
        { title: 'Counter-Strike 2', genre: 'Shooter', image_url: 'https://cdn/cs2.jpg', sort_order: 60 },
      ],
      toRemove: ['g2'],
    });
  });
});
