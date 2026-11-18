import { describe, expect, it } from 'vitest';
import { buildExchangeNotification } from './exchangeNotification';

describe('buildExchangeNotification', () => {
  it('describes a dollar purchase with its rate, date and comment', () => {
    expect(buildExchangeNotification({
      addedBy: 'Alisher', date: '2026-10-24', from: 'cash', to: 'usd', fromAmount: 1_265_000, toAmount: 100, rate: 12_650, comment: 'для сейфа',
    }).split('\n')).toEqual([
      '🏦 Обмен: 1 265 000 сум → $100',
      'Наличные → Доллары · доллары в резерв · курс 12 650 · 24 октября',
      'Alisher: для сейфа',
    ]);
  });

  it('says selling dollars takes them out of the reserve', () => {
    expect(buildExchangeNotification({
      addedBy: 'A', date: '2026-10-24', from: 'usd', to: 'cash', fromAmount: 10, toAmount: 126_000, rate: 12_600, comment: null,
    }).split('\n')[1]).toBe('Доллары → Наличные · доллары из резерва · курс 12 600 · 24 октября');
  });

  it('has no rate between UZS methods', () => {
    expect(buildExchangeNotification({
      addedBy: 'A', date: '2026-10-24', from: 'terminal', to: 'card', fromAmount: 50_000, toAmount: 50_000, rate: null, comment: null,
    }).split('\n')).toEqual([
      '🔄 Обмен: 50 000 сум → 50 000 сум',
      'Терминал → Карта · 24 октября',
      'A',
    ]);
  });
});
