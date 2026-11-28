import { describe, expect, it } from 'vitest';
import { CALLBACK_DATA_MAX_BYTES, parseOwnerBotCallbackData } from './callbackData';
import type { OwnerBotDayView } from './dayView';
import { confirmKeyboard, dayKeyboard, methodMenuKeyboard, type OwnerBotKeyboard } from './keyboard';

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
  barSales: 0,
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

  it('adds the undo of the owner\'s last mark, and has no keyboard when nothing is left to press', () => {
    const undo = { handoverId: id(9), method: 'card', action: 'collected' } as const;
    const keyboard = dayKeyboard(view({ undo }));
    expect(labels(keyboard)?.at(-1)).toEqual(['↩️ Отменить: забрал карту']);
    expect(presses(keyboard)?.at(-1)).toEqual({ action: 'undo', id: id(9) });
    expect(dayKeyboard(view({ lines: view().lines.map((line) => ({ ...line, status: 'empty', buttonId: null })) }))).toBeNull();
    expect(labels(dayKeyboard(view({ lines: [], undo })))).toEqual([['↩️ Отменить: забрал карту']]);
  });

  it('offers collect, reserve and back for a line, and yes or no for a choice', () => {
    const menu = methodMenuKeyboard(id(1));
    expect(labels(menu)).toEqual([['✅ Забрал', '🏦 В резерв'], ['⬅️ Назад']]);
    expect(presses(menu)).toEqual([{ action: 'collect', id: id(1) }, { action: 'reserve', id: id(1) }, { action: 'back', id: id(1) }]);
    const confirm = confirmKeyboard(id(5));
    expect(labels(confirm)).toEqual([['✅ Да', '✖️ Нет']]);
    expect(presses(confirm)).toEqual([{ action: 'yes', id: id(5) }, { action: 'no', id: id(5) }]);
    expectShortData(menu);
    expectShortData(confirm);
  });
});
