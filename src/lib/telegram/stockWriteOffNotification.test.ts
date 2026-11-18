import { describe, expect, it } from 'vitest';
import { buildStockWriteOffNotice } from './stockWriteOffNotification';

describe('buildStockWriteOffNotice', () => {
  it('names the loss, the product, the reason, the units and the day', () => {
    expect(buildStockWriteOffNotice({
      date: '2026-11-17', productName: 'Coca cola 0,5', kind: 'shortage', quantity: 3, cost: 17_502, note: 'не нашли на складе', by: 'Jasurbek',
    }).split('\n')).toEqual([
      '🗑 Списание бара: 17 502 сум',
      'Coca cola 0,5 · Недостача · 3 шт. · 17 ноября',
      'Себестоимость списана с прибыли бара',
      'Jasurbek: не нашли на складе',
    ]);
  });

  it('says the stock is back when the write-off was removed', () => {
    const text = buildStockWriteOffNotice({
      date: '2026-11-17', productName: 'Pepsi 0,5', kind: null, quantity: 0, cost: 0, note: '', by: 'A',
    });
    expect(text.split('\n')[0]).toBe('↩️ Списание или корректировка бара отменены: Pepsi 0,5');
    expect(text).toContain('остаток пересчитан');
  });

  it('reports a correction as extra units that leave bar profit alone', () => {
    expect(buildStockWriteOffNotice({
      date: '2026-11-17', productName: 'Snickers', kind: 'correction', quantity: 2, cost: 8_000, note: 'нашли в коробке', by: 'A',
    }).split('\n')).toEqual([
      '➕ Корректировка остатка бара: +2 шт.',
      'Snickers · больше ожидаемого · 17 ноября',
      'По себестоимости 8 000 сум; прибыль бара не меняется',
      'A: нашли в коробке',
    ]);
  });
});
