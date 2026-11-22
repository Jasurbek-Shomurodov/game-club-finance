/**
 * The facts behind a club page's "Questions and answers" section, read from
 * the club's own published data, so the answers change when the owner edits
 * prices, hours or contacts. A question with nothing behind it is left out.
 * The page turns these into translated text (ShowcaseFaq).
 */
import { isRoundTheClock, lowestHourlyPrice, type PublicShowcase } from '@/lib/showcase';

/** Game titles named in the answer; the rest are "and others". */
const GAME_SAMPLE_SIZE = 6;

export type ClubFaqFact =
  | { kind: 'price'; from: number; zones: Array<{ name: string; price: number }> }
  | { kind: 'consoles'; count: number; names: string[]; from: number | null }
  | { kind: 'hours'; roundTheClock: boolean; text: string }
  | { kind: 'booking'; telegram: boolean; phone: string | null }
  | { kind: 'address'; address: string }
  | { kind: 'games'; count: number; sample: string[] };

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
