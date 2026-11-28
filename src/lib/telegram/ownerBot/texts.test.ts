import { describe, expect, it } from 'vitest';
import { LINK_STATUSES } from './accounts';
import type { OwnerBotRefusal } from './actions';
import type { OwnerBotDayView } from './dayView';
import {
  amountMenuText,
  amountPromptExpiredText,
  amountPromptText,
  amountPromptToastText,
  barMenuText,
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
    bar: { status: 'open', sales: 450_000, amount: 450_000, buttonId: 'd' },
    allButtonId: 'd',
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
      '🍺 Бар (продажи): 450 000 сум · ⏳ не отмечено',
      '👛 Осталось у администратора: 1 900 000 сум',
    ].join('\n'));
    expectEmojiLines(text);
  });

  it('shows the bar\'s mark, with what it moved when that differs from the sales', () => {
    const bar = (status: OwnerBotDayView['bar']['status'], amount: number) => dayText(view({ bar: { status, sales: 450_000, amount, buttonId: null } })).split('\n').at(-2);
    expect(bar('reserve', 450_000)).toBe('🍺 Бар (продажи): 450 000 сум · 🏦 в резерве');
    expect(bar('reserve', 300_000)).toBe('🍺 Бар (продажи): 450 000 сум · 🏦 в резерве 300 000 сум');
    expect(bar('left', 450_000)).toBe('🍺 Бар (продажи): 450 000 сум · 👌 оставил в баре');
  });

  it('says so when no method moved money that day, and when the till holds none of a method', () => {
    const empty = dayText(view({ lines: [], bar: { status: 'empty', sales: 0, amount: 0, buttonId: null }, tillTotal: 0 }));
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
    expect(confirmText(day, { kind: 'method', method: 'cash', action: 'reserve', amount: 1_200_000 }).split('\n').at(-1))
      .toBe('🏦 Переместить в резерв 1 200 000 сум · 💵 Наличные · Square?');
    expect(confirmText(day, { kind: 'method', method: 'cash', action: 'collected', amount: 1_200_000 }).split('\n').at(-1))
      .toBe('✅ Отметить, что вы забрали 1 200 000 сум · 💵 Наличные · Square?');
    expect(amountMenuText(day, day.lines[0]).split('\n').at(-1)).toBe('✏️ 💵 Наличные: часть от 1 200 000 сум. Что сделали с этой частью?');
  });

  it('asks about the bar, and confirms its reserve (saying when it was capped) or that it stayed there', () => {
    const day = view();
    expect(barMenuText(day).split('\n').at(-1)).toBe('👉 🍺 Бар: 450 000 сум. Что сделали с этими деньгами?');
    expect(confirmText(day, { kind: 'bar', action: 'reserve', amount: 450_000, capped: false }).split('\n').at(-1))
      .toBe('🏦 Переместить в резерв 450 000 сум · 🍺 Бар · Square?');
    const capped = confirmText(day, { kind: 'bar', action: 'reserve', amount: 300_000, capped: true }).split('\n').slice(-2);
    expect(capped).toEqual([
      '🏦 Переместить в резерв 300 000 сум · 🍺 Бар · Square?',
      'ℹ️ Не больше прибыли бара за месяц, поэтому меньше продаж дня (450 000 сум).',
    ]);
    expect(confirmText(day, { kind: 'bar', action: 'left', amount: 450_000, capped: false }).split('\n').at(-1))
      .toBe('👌 Отметить, что 450 000 сум · 🍺 Бар · Square остались в баре?');
    expectEmojiLines(confirmText(day, { kind: 'bar', action: 'reserve', amount: 300_000, capped: true }).replace('\n\n', '\n'));
  });

  it('lists every method and the total before "Всё…" is saved', () => {
    const text = confirmText(view(), {
      kind: 'all',
      action: 'reserve',
      items: [{ method: 'cash', amount: 1_200_000 }, { method: 'terminal', amount: 700_000 }],
    });
    expect(text.split('\n\n').at(-1)).toBe([
      '🏦 Переместить всё в резерв · Square?',
      '💵 Наличные: 1 200 000 сум',
      '💳 Терминал: 700 000 сум',
      '💰 Всего: 1 900 000 сум',
    ].join('\n'));
    expect(confirmText(view(), { kind: 'all', action: 'collected', items: [{ method: 'card', amount: 5 }] }))
      .toContain('✅ Отметить, что вы забрали всё · Square?');
  });

  it('asks how much with the most it may be, and again with the reason', () => {
    const question = { clubName: 'Square', side: 'game_club', method: 'cash', action: 'collected', maxAmount: 1_200_000 } as const;
    expect(amountPromptText(question)).toBe('✏️ Square · 💵 Наличные: сколько забрали?\n👇 Ответьте на это сообщение суммой до 1 200 000 сум.');
    expect(amountPromptText({ ...question, side: 'bar', method: null, action: 'reserve', maxAmount: 300_000 }).split('\n')[0])
      .toBe('✏️ Square · 🍺 Бар: сколько переместить в резерв?');
    expect(amountPromptText(question, 'invalid').split('\n')[0]).toBe('❌ Не понял сумму. Напишите целое число сум, например 500 000.');
    expect(amountPromptText(question, 'too_large').split('\n')[0]).toBe('⚠️ Это больше, чем можно.');
    [amountPromptText(question, 'invalid'), amountPromptText(question, 'too_large'), amountPromptToastText(), amountPromptExpiredText()].forEach(expectEmojiLines);
    expect(amountPromptToastText().length).toBeLessThanOrEqual(200);
  });

  it('names the undo and the result of a press', () => {
    const one = { side: 'game_club', group: false } as const;
    expect(undoButtonText({ ...one, method: 'cash', action: 'reserve' })).toBe('↩️ Отменить: наличные в резерв');
    expect(undoButtonText({ ...one, method: 'terminal', action: 'collected' })).toBe('↩️ Отменить: забрал терминал');
    expect(undoButtonText({ side: 'bar', method: null, action: 'reserve', group: false })).toBe('↩️ Отменить: бар в резерв');
    expect(undoButtonText({ side: 'bar', method: null, action: 'left', group: false })).toBe('↩️ Отменить: оставил в баре');
    expect(undoButtonText({ side: 'game_club', method: null, action: 'reserve', group: true })).toBe('↩️ Отменить: всё в резерв');
    expect(undoButtonText({ side: 'game_club', method: null, action: 'collected', group: true })).toBe('↩️ Отменить: всё забрал');

    const result = { ...one, handoverId: 'h', method: 'cash', action: 'reserve', amount: 1_200_000 } as const;
    expect(resultToastText({ ...result, status: 'saved' })).toBe('🏦 В резерве: Наличные 1 200 000 сум');
    expect(resultToastText({ ...result, status: 'already_saved', action: 'collected' })).toBe('✅ Забрал: Наличные 1 200 000 сум');
    expect(resultToastText({ ...result, status: 'undone' })).toBe('↩️ Отменено: Наличные 1 200 000 сум');
    expect(resultToastText({ ...result, status: 'already_undone' })).toBe('↩️ Уже отменено: Наличные 1 200 000 сум');
    const bar = { ...result, side: 'bar', method: null, amount: 300_000 } as const;
    expect(resultToastText({ ...bar, status: 'saved' })).toBe('🏦 В резерве: Бар 300 000 сум');
    expect(resultToastText({ ...bar, status: 'saved', action: 'left' })).toBe('👌 Оставил в баре: 300 000 сум');
    expect(resultToastText({ ...bar, status: 'undone', action: 'left' })).toBe('↩️ Отменено: Бар 300 000 сум');
    const all = { ...result, method: null, group: true, amount: 1_900_000 } as const;
    expect(resultToastText({ ...all, status: 'saved' })).toBe('🏦 Всё в резерве: 1 900 000 сум');
    expect(resultToastText({ ...all, status: 'saved', action: 'collected' })).toBe('✅ Забрал всё: 1 900 000 сум');
    expect(resultToastText({ ...all, status: 'undone' })).toBe('↩️ Отменено: всё 1 900 000 сум');
  });

  it('answers every refusal with its own short alert', () => {
    const refusals: OwnerBotRefusal[] = [
      'forbidden', 'expired', 'already_marked', 'nothing_in_till', 'nothing_in_bar', 'bar_reserve_unavailable', 'undo_expired', 'cannot_undo',
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
