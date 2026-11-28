import { describe, expect, it } from 'vitest';
import { CALLBACK_DATA_MAX_BYTES, parseOwnerBotCallbackData } from './callbackData';
import type { OwnerBotDayView } from './dayView';
import {
  AMOUNT_PROMPT_MARKUP,
  amountMenuKeyboard,
  barMenuKeyboard,
  confirmKeyboard,
  dayKeyboard,
  methodMenuKeyboard,
  type OwnerBotKeyboard,
} from './keyboard';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const view = (overrides: Partial<OwnerBotDayView> = {}): OwnerBotDayView => ({
  clubName: 'Square',
  businessDate: '2026-11-27',
  lines: [
    { method: 'cash', status: 'open', amount: 1_200_000, dayNet: 1_200_000, buttonId: id(1) },
    { method: 'terminal', status: 'open', amount: 800_000, dayNet: 800_000, buttonId: id(2) },
    { method: 'card', status: 'collected', amount: 300_000, dayNet: 300_000, buttonId: null },
    { method: 'playstation', status: 'open', amount: 150_000, dayNet: 150_000, buttonId: id(4) },
  ],
  bar: { status: 'empty', sales: 0, amount: 0, buttonId: null },
  allButtonId: null,
  tillTotal: 2_150_000,
  undo: null,
  ...overrides,
});

const labels = (keyboard: OwnerBotKeyboard | null) => keyboard?.inline_keyboard.map((row) => row.map((button) => button.text));
const presses = (keyboard: OwnerBotKeyboard | null) => keyboard?.inline_keyboard.flat().map((button) => parseOwnerBotCallbackData(button.callback_data));

function expectShortData(keyboard: OwnerBotKeyboard | null) {
  for (const button of keyboard?.inline_keyboard.flat() ?? []) {
    expect(new TextEncoder().encode(button.callback_data).length).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
  }
}

describe('owner bot keyboards', () => {
  it('gives every unmarked line with money a button, two per row', () => {
    const keyboard = dayKeyboard(view());
    expect(labels(keyboard)).toEqual([['💵 Наличные', '💳 Терминал'], ['🎮 PlayStation']]);
    expect(presses(keyboard)).toEqual([
      { action: 'menu', id: id(1) }, { action: 'menu', id: id(2) }, { action: 'menu', id: id(4) },
    ]);
    expectShortData(keyboard);
  });

  it('adds the bar, "Всё…" and the undo in that order', () => {
    const keyboard = dayKeyboard(view({
      bar: { status: 'open', sales: 450_000, amount: 450_000, buttonId: id(7) },
      allButtonId: id(7),
      undo: { handoverId: id(9), side: 'game_club', method: null, action: 'collected', group: true },
    }));
    expect(labels(keyboard)).toEqual([
      ['💵 Наличные', '💳 Терминал'], ['🎮 PlayStation'], ['🍺 Бар'], ['✅ Всё забрал', '🏦 Всё в резерв'], ['↩️ Отменить: всё забрал'],
    ]);
    expect(presses(keyboard)?.slice(3)).toEqual([
      { action: 'menu', id: id(7) }, { action: 'allcollect', id: id(7) }, { action: 'allreserve', id: id(7) }, { action: 'undo', id: id(9) },
    ]);
    expectShortData(keyboard);
  });

  it('adds the undo of the owner\'s last mark, and has no keyboard when nothing is left to press', () => {
    const undo = { handoverId: id(9), side: 'game_club', method: 'card', action: 'collected', group: false } as const;
    const keyboard = dayKeyboard(view({ undo }));
    expect(labels(keyboard)?.at(-1)).toEqual(['↩️ Отменить: забрал карту']);
    expect(presses(keyboard)?.at(-1)).toEqual({ action: 'undo', id: id(9) });
    expect(dayKeyboard(view({ lines: view().lines.map((line) => ({ ...line, status: 'empty', buttonId: null })) }))).toBeNull();
    expect(labels(dayKeyboard(view({ lines: [], undo })))).toEqual([['↩️ Отменить: забрал карту']]);
  });

  it('offers collect, reserve, another amount and back for a line, and yes or no for a choice', () => {
    const menu = methodMenuKeyboard(id(1));
    expect(labels(menu)).toEqual([['✅ Забрал', '🏦 В резерв'], ['✏️ Другая сумма', '⬅️ Назад']]);
    expect(presses(menu)).toEqual([
      { action: 'collect', id: id(1) }, { action: 'reserve', id: id(1) }, { action: 'amount', id: id(1) }, { action: 'back', id: id(1) },
    ]);
    const amount = amountMenuKeyboard(id(1));
    expect(labels(amount)).toEqual([['✅ Забрал', '🏦 В резерв'], ['⬅️ Назад']]);
    expect(presses(amount)).toEqual([{ action: 'askcollect', id: id(1) }, { action: 'askreserve', id: id(1) }, { action: 'menu', id: id(1) }]);
    const confirm = confirmKeyboard(id(5));
    expect(labels(confirm)).toEqual([['✅ Да', '✖️ Нет']]);
    expect(presses(confirm)).toEqual([{ action: 'yes', id: id(5) }, { action: 'no', id: id(5) }]);
    [menu, amount, confirm].forEach(expectShortData);
  });

  it('offers the bar no collect, only the reserve, "left in the bar" and another amount for the reserve', () => {
    const bar = barMenuKeyboard(id(7));
    expect(labels(bar)).toEqual([['🏦 В резерв', '👌 Оставил в баре'], ['✏️ Другая сумма', '⬅️ Назад']]);
    expect(presses(bar)).toEqual([
      { action: 'reserve', id: id(7) }, { action: 'left', id: id(7) }, { action: 'askreserve', id: id(7) }, { action: 'back', id: id(7) },
    ]);
    expectShortData(bar);
  });

  it('asks for the amount with a reply prompt whose placeholder fits Telegram\'s 64 characters', () => {
    expect(AMOUNT_PROMPT_MARKUP.force_reply).toBe(true);
    expect(AMOUNT_PROMPT_MARKUP.input_field_placeholder.length).toBeLessThanOrEqual(64);
  });
});
