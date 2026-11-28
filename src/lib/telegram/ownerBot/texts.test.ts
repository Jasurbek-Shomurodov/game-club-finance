import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from './accounts';
import type { OwnerBotRefusal } from './actions';
import type { OwnerBotDayView } from './dayView';
import {
  clubsText,
  confirmText,
  dayText,
  dayUnavailableText,
  errorText,
  helpText,
  linkResultText,
  linkUsageText,
  methodMenuText,
  noClubsText,
  notLinkedText,
  pressFailedText,
  refusalText,
  resultToastText,
  startText,
  undoButtonText,
} from './texts';

/** Every non-empty line starts with an emoji (a pictographic or symbol character, not a letter or digit). */
function expectEmojiLines(text: string) {
  for (const line of text.split('\n')) {
    expect(line, line).toMatch(/^\p{Extended_Pictographic}|^[ℹ⌛⏳↩]/u);
  }
}

describe('owner bot texts', () => {
  const view = (overrides: Partial<OwnerBotDayView> = {}): OwnerBotDayView => ({
    clubName: 'Square',
    businessDate: '2026-11-27',
    lines: [
      { method: 'cash', status: 'open', amount: 1_200_000, dayNet: 1_200_000, buttonId: 'a' },
      { method: 'terminal', status: 'open', amount: 700_000, dayNet: 800_000, buttonId: 'b' },
      { method: 'card', status: 'collected', amount: 300_000, dayNet: 300_000, buttonId: null },
      { method: 'playstation', status: 'reserve', amount: 150_000, dayNet: 150_000, buttonId: null },
    ],
    barSales: 450_000,
    tillTotal: 1_900_000,
    undo: null,
    ...overrides,
  });

  it('lists each method\'s money and state, the bar and what the admin still holds', () => {
    const text = dayText(view());
    expect(text).toBe([
      '🏢 Square · 27 ноября 2026',
      '💵 Наличные: 1 200 000 сум · ⏳ не отмечено',
      '💳 Терминал: 700 000 сум (за день 800 000 сум) · ⏳ не отмечено',
      '🏧 Карта: 300 000 сум · ✅ забрал',
      '🎮 PlayStation: 150 000 сум · 🏦 в резерве',
      '🍺 Бар (продажи): 450 000 сум',
      '👛 Осталось у администратора: 1 900 000 сум',
    ].join('\n'));
    expectEmojiLines(text);
  });

  it('says so when no method moved money that day, and when the till holds none of a method', () => {
    const empty = dayText(view({ lines: [], barSales: 0, tillTotal: 0 }));
    expect(empty).toContain('📭 В клубе за этот день оплат нет.');
    expect(empty).toContain('🍺 Бар (продажи): 0 сум');
    expectEmojiLines(empty);
    expect(dayText(view({ lines: [{ method: 'cash', status: 'empty', amount: 0, dayNet: 500_000, buttonId: null }] })))
      .toContain('💵 Наличные: 0 сум (за день 500 000 сум) · 👌 в кассе ничего нет');
  });

  it('asks what happened to a method\'s money, then confirms the amount fixed at that moment', () => {
    const day = view();
    const menu = methodMenuText(day, day.lines[1]);
    expect(menu.startsWith(dayText(day))).toBe(true);
    expect(menu.split('\n').at(-1)).toBe('👉 💳 Терминал: 700 000 сум. Что сделали с этими деньгами?');
    expect(confirmText(day, { method: 'cash', action: 'reserve', amount: 1_200_000 }).split('\n').at(-1))
      .toBe('🏦 Переместить в резерв 1 200 000 сум · 💵 Наличные · Square?');
    expect(confirmText(day, { method: 'cash', action: 'collected', amount: 1_200_000 }).split('\n').at(-1))
      .toBe('✅ Отметить, что вы забрали 1 200 000 сум · 💵 Наличные · Square?');
  });

  it('names the undo and the result of a press', () => {
    expect(undoButtonText({ method: 'cash', action: 'reserve' })).toBe('↩️ Отменить: наличные в резерв');
    expect(undoButtonText({ method: 'terminal', action: 'collected' })).toBe('↩️ Отменить: забрал терминал');
    const result = { handoverId: 'h', method: 'cash', action: 'reserve', amount: 1_200_000 } as const;
    expect(resultToastText({ ...result, status: 'saved' })).toBe('🏦 В резерве: Наличные 1 200 000 сум');
    expect(resultToastText({ ...result, status: 'already_saved', action: 'collected' })).toBe('✅ Забрал: Наличные 1 200 000 сум');
    expect(resultToastText({ ...result, status: 'undone' })).toBe('↩️ Отменено: Наличные 1 200 000 сум');
    expect(resultToastText({ ...result, status: 'already_undone' })).toBe('↩️ Уже отменено: Наличные 1 200 000 сум');
  });

  it('answers every refusal with its own short alert', () => {
    const refusals: OwnerBotRefusal[] = [
      'forbidden', 'expired', 'already_marked', 'nothing_in_till', 'undo_expired', 'cannot_undo',
      'till_short', 'reserve_exceeds_available', 'day_closed', 'already_spent',
    ];
    const texts = refusals.map(refusalText);
    expect(new Set(texts).size).toBe(refusals.length);
    for (const text of [...texts, pressFailedText()]) {
      expect(text.length).toBeLessThanOrEqual(200);
      expectEmojiLines(text);
    }
    expect(refusalText('forbidden')).toMatch(/нет доступа/i);
    expect(refusalText('undo_expired')).toBe('⌛ Отменить можно только в течение 10 минут. Исправьте в приложении.');
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
