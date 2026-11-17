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
    expect(text.split('\n')[0]).toBe('↩️ Списание бара отменено: Pepsi 0,5');
    expect(text).toContain('товар вернулся в остаток');
  });
});
