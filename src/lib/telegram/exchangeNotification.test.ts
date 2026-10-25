import { describe, expect, it } from 'vitest';
import { buildExchangeNotification } from './exchangeNotification';

describe('buildExchangeNotification', () => {
  it('describes a dollar purchase with its rate', () => {
    const text = buildExchangeNotification({
      addedBy: 'Alisher', date: '2026-10-24', from: 'cash', to: 'usd', fromAmount: 1_265_000, toAmount: 100, rate: 12_650, comment: 'для сейфа',
    });
    expect(text).toContain('🔄 Обмен денег');
    expect(text).toContain('Из: Наличные — 1 265 000 сум');
    expect(text).toContain('В: Доллары — $100');
    expect(text).toContain('Курс: 1 $ = 12 650 сум');
    expect(text).toContain('Добавил(а): Alisher');
    expect(text).toContain('Комментарий: для сейфа');
  });

  it('has no rate line between UZS methods', () => {
    const text = buildExchangeNotification({
      addedBy: 'A', date: '2026-10-24', from: 'terminal', to: 'card', fromAmount: 50_000, toAmount: 50_000, rate: null, comment: null,
    });
    expect(text).not.toContain('Курс');
    expect(text).toContain('В: Карта — 50 000 сум');
  });
});
