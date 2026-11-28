import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from './accounts';
import {
  clubsText,
  dayText,
  dayUnavailableText,
  errorText,
  helpText,
  linkResultText,
  linkUsageText,
  noClubsText,
  notLinkedText,
  startText,
} from './texts';

/** Every non-empty line starts with an emoji (a pictographic or symbol character, not a letter or digit). */
function expectEmojiLines(text: string) {
  for (const line of text.split('\n')) {
    expect(line, line).toMatch(/^\p{Extended_Pictographic}|^[ℹ⌛⏳]/u);
  }
}

describe('owner bot texts', () => {
  it('lists the day\'s money per method and the bar with space thousands separators', () => {
    const text = dayText({
      clubName: 'Square',
      businessDate: '2026-11-27',
      methods: [
        { method: 'cash', moneyIn: 1_200_000, moneyOut: 0, net: 1_200_000 },
        { method: 'terminal', moneyIn: 900_000, moneyOut: 100_000, net: 800_000 },
        { method: 'card', moneyIn: 300_000, moneyOut: 0, net: 300_000 },
        { method: 'playstation', moneyIn: 150_000, moneyOut: 0, net: 150_000 },
      ],
      barSales: 450_000,
    });
    expect(text).toBe([
      '🏢 Square · 27 ноября 2026',
      '💵 Наличные: 1 200 000 сум',
      '💳 Терминал: 800 000 сум (приход 900 000 сум, расход 100 000 сум)',
      '🏧 Карта: 300 000 сум',
      '🎮 PlayStation: 150 000 сум',
      '🍺 Бар (продажи): 450 000 сум',
    ].join('\n'));
    expectEmojiLines(text);
  });

  it('says so when no method moved money that day', () => {
    const text = dayText({ clubName: 'Bunker', businessDate: '2026-11-27', methods: [], barSales: 0 });
    expect(text).toContain('📭 В клубе за этот день оплат нет.');
    expect(text).toContain('🍺 Бар (продажи): 0 сум');
    expectEmojiLines(text);
  });

  it('answers every link status with its own text', () => {
    const texts = LINK_STATUSES.map(linkResultText);
    expect(new Set(texts).size).toBe(LINK_STATUSES.length);
    texts.forEach(expectEmojiLines);
    expect(linkResultText('linked')).toContain('/today');
    expect(linkResultText('expired')).toContain('15 минут');
    expect(linkResultText('rate_limited')).toContain('15 минут');
  });

  it('lists the owner\'s clubs, or says there are none', () => {
    expect(clubsText([{ id: 'a', name: 'Square' }, { id: 'b', name: 'Algoritm' }]))
      .toBe('📋 Ваши клубы (2):\n🏢 Square\n🏢 Algoritm');
    expect(clubsText([])).toBe(noClubsText());
  });

  it('tells an unlinked person how to link from Settings', () => {
    for (const text of [notLinkedText(), startText(false), helpText(false)]) {
      expect(text).toContain('Настройки → Telegram');
      expect(text).toContain('/link КОД');
      expectEmojiLines(text);
    }
    expect(startText(true)).toContain('/clubs');
    expect(helpText(true)).toContain('/today');
  });

  it('starts every other reply with an emoji', () => {
    [linkUsageText(), noClubsText(), dayUnavailableText('Square'), errorText(), startText(true), helpText(true)].forEach(expectEmojiLines);
  });
});
