import { describe, expect, it } from 'vitest';
import type { PublicShowcase } from '@/lib/showcase';
import { clubFaqFacts } from './showcaseFaq';

const zone = (kind: 'pc' | 'playstation', name: string, count: number, price: number | null) =>
  ({ id: name, kind, name, pc_count: count, price_per_hour: price }) as PublicShowcase['zones'][number];

const club = {
  club_name: 'Pixel Gaming',
  slug: 'pixel',
  opening_hours: '24/7',
  telegram_url: 'https://t.me/pixel',
  phone: '+998 90 000 00 00',
  address: 'Zargarlik 30A',
  zones: [zone('pc', 'Standard', 82, 10000), zone('pc', 'VIP', 15, 13000), zone('playstation', 'PlayStation 5', 2, 40000)],
  games: Array.from({ length: 8 }, (_, index) => ({ id: String(index), title: `Game ${index + 1}`, genre: null, image_url: null })),
} as unknown as PublicShowcase;

describe('clubFaqFacts', () => {
  it('reads prices, consoles, hours, booking, address and games from the club', () => {
    expect(clubFaqFacts(club)).toEqual([
      { kind: 'price', from: 10000, zones: [{ name: 'Standard', price: 10000 }, { name: 'VIP', price: 13000 }] },
      { kind: 'consoles', count: 2, names: ['PlayStation 5'], from: 40000 },
      { kind: 'hours', roundTheClock: true, text: '24/7' },
      { kind: 'booking', telegram: true, phone: '+998 90 000 00 00' },
      { kind: 'address', address: 'Zargarlik 30A' },
      { kind: 'games', count: 8, sample: ['Game 1', 'Game 2', 'Game 3', 'Game 4', 'Game 5', 'Game 6'] },
    ]);
  });

  it('leaves out questions the club has no answer for', () => {
    const bare = { ...club, opening_hours: '10:00 – 02:00', telegram_url: null, phone: null, address: '  ', games: [], zones: [zone('pc', 'Standard', 10, null)] } as unknown as PublicShowcase;
    expect(clubFaqFacts(bare)).toEqual([{ kind: 'hours', roundTheClock: false, text: '10:00 – 02:00' }]);
  });
});
