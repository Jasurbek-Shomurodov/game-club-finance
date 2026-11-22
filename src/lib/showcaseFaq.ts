/**
 * The facts behind a club page's "Questions and answers" section, read from
 * the club's own published data, so the answers change when the owner edits
 * prices, hours or contacts. A question with nothing behind it is left out.
 * The page turns these into translated text (ShowcaseFaq).
 */
import { isRoundTheClock, lowestHourlyPrice, type PublicBrand, type PublicShowcase } from '@/lib/showcase';

/** Game titles named in the answer; the rest are "and others". */
const GAME_SAMPLE_SIZE = 6;

export type ClubFaqFact =
  | { kind: 'price'; from: number; zones: Array<{ name: string; price: number }> }
  | { kind: 'consoles'; count: number; names: string[]; from: number | null }
  | { kind: 'hours'; roundTheClock: boolean; text: string }
  | { kind: 'booking'; telegram: boolean; phone: string | null }
  | { kind: 'address'; address: string }
  | { kind: 'games'; count: number; sample: string[] }
  | { kind: 'clubPrices'; from: number; clubs: Array<{ name: string; from: number }> }
  | { kind: 'locations'; clubs: Array<{ name: string; address: string }> }
  | { kind: 'clubBooking' };

export function clubFaqFacts(club: PublicShowcase): ClubFaqFact[] {
  const facts: ClubFaqFact[] = [];
  const pcZones = club.zones.filter((zone) => zone.kind === 'pc');
  const consoleZones = club.zones.filter((zone) => zone.kind === 'playstation');

  const pricedPcZones = pcZones.flatMap((zone) => (zone.price_per_hour !== null ? [{ name: zone.name, price: zone.price_per_hour }] : []));
  const pcFrom = lowestHourlyPrice(pcZones);
  if (pcFrom !== null) facts.push({ kind: 'price', from: pcFrom, zones: pricedPcZones });

  const consoleCount = consoleZones.reduce((sum, zone) => sum + zone.pc_count, 0);
  if (consoleCount > 0) {
    facts.push({ kind: 'consoles', count: consoleCount, names: [...new Set(consoleZones.map((zone) => zone.name))], from: lowestHourlyPrice(consoleZones) });
  }

  const hours = club.opening_hours?.trim();
  if (hours) facts.push({ kind: 'hours', roundTheClock: isRoundTheClock(hours), text: hours });

  if (club.telegram_url || club.phone) facts.push({ kind: 'booking', telegram: Boolean(club.telegram_url), phone: club.phone });

  const address = club.address?.trim();
  if (address) facts.push({ kind: 'address', address });

  if (club.games.length > 0) {
    facts.push({ kind: 'games', count: club.games.length, sample: club.games.slice(0, GAME_SAMPLE_SIZE).map((game) => game.title) });
  }
  return facts;
}

/**
 * The brand page's questions: prices and addresses per club, consoles across
 * clubs, shared hours (only when every club keeps the same ones), booking and
 * the game library.
 */
export function brandFaqFacts(brand: Pick<PublicBrand, 'clubs'>): ClubFaqFact[] {
  const facts: ClubFaqFact[] = [];
  const clubs = brand.clubs;
  const pcFrom = clubs.flatMap((club) => {
    const from = lowestHourlyPrice(club.zones.filter((zone) => zone.kind === 'pc'));
    return from !== null ? [{ name: club.club_name, from }] : [];
  });
  if (pcFrom.length > 0) facts.push({ kind: 'clubPrices', from: Math.min(...pcFrom.map((club) => club.from)), clubs: pcFrom });

  const consoleZones = clubs.flatMap((club) => club.zones.filter((zone) => zone.kind === 'playstation'));
  const consoleCount = consoleZones.reduce((sum, zone) => sum + zone.pc_count, 0);
  if (consoleCount > 0) {
    facts.push({ kind: 'consoles', count: consoleCount, names: [...new Set(consoleZones.map((zone) => zone.name))], from: lowestHourlyPrice(consoleZones) });
  }

  const hours = [...new Set(clubs.map((club) => club.opening_hours?.trim() ?? ''))];
  if (hours.length === 1 && hours[0]) facts.push({ kind: 'hours', roundTheClock: isRoundTheClock(hours[0]), text: hours[0] });

  const located = clubs.flatMap((club) => (club.address?.trim() ? [{ name: club.club_name, address: club.address.trim() }] : []));
  if (located.length > 0) facts.push({ kind: 'locations', clubs: located });

  if (clubs.some((club) => club.telegram_url)) facts.push({ kind: 'clubBooking' });

  const library = [...clubs].sort((a, b) => b.games.length - a.games.length)[0];
  if (library && library.games.length > 0) {
    facts.push({ kind: 'games', count: library.games.length, sample: library.games.slice(0, GAME_SAMPLE_SIZE).map((game) => game.title) });
  }
  return facts;
}
