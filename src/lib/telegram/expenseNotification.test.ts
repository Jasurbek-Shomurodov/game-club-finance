import { describe, expect, it } from 'vitest';
import { buildExpenseNotification, expenseDollars } from './expenseNotification';

describe('buildExpenseNotification', () => {
  it('puts the amount first, then the details with the date, then who added it with the comment', () => {
    expect(buildExpenseNotification({
      addedBy: 'Izzatilla Ismatov',
      amount: 90000,
      category: 'food_drinks',
      comment: 'Кетчуп Майонез сосика салаты огурцы помидоры',
      date: '2026-11-14',
      paymentMethod: 'cash',
      paymentSource: 'bar',
    })).toBe([
      '💸 Расход: 90 000 сум',
      'Бар · Еда / Напитки · Наличные · 14 ноября',
      'Izzatilla Ismatov: Кетчуп Майонез сосика салаты огурцы помидоры',
    ].join('\n'));
  });

  it('ends with just the name when there is no comment', () => {
    const message = buildExpenseNotification({
      addedBy: 'Алишер', amount: 125000, category: 'repair', comment: null,
      date: '2026-09-01', paymentMethod: 'card', paymentSource: 'game_club',
    });
    expect(message.split('\n')).toEqual(['💸 Расход: 125 000 сум', 'Игровой клуб · Ремонт · Карта · 1 сентября', 'Алишер']);
  });

  it('shows the dollars and rate in place of the method on a dollar expense', () => {
    const message = buildExpenseNotification({
      addedBy: 'A', amount: 1_285_000, category: 'repair', comment: null, date: '2026-09-01',
      paymentMethod: 'usd', paymentSource: 'game_club', dollars: { amount: 100, rate: 12850 },
    });
    // Dollars are the reserve's own money (143), so it says the reserve paid.
    expect(message).toContain('Резерв · Ремонт · $100 по курсу 12 850 · 1 сентября');
    expect(message.split('\n')[0]).toBe('🏦 Расход из резерва: 1 285 000 сум');
  });

  it('says the reserve paid in sums, never the cash the row is stored in', () => {
    const message = buildExpenseNotification({
      addedBy: 'Owner', amount: 3_000_000, category: 'equipment', comment: 'Два новых игровых компьютера', date: '2026-11-18',
      paymentMethod: 'cash', paymentSource: 'game_club', fromReserve: true,
    });
    expect(message.split('\n')).toEqual([
      '🏦 Расход из резерва: 3 000 000 сум',
      'Резерв · Оборудование · Сумы · 18 ноября',
      'Owner: Два новых игровых компьютера',
    ]);
  });
});

describe('expenseDollars', () => {
  it('reads dollars only from a dollar expense', () => {
    expect(expenseDollars({ payment_method: 'usd', usd_amount: '100', usd_rate: '12850' })).toEqual({ amount: 100, rate: 12850 });
    expect(expenseDollars({ payment_method: 'cash', usd_amount: 100, usd_rate: 12850 })).toBeNull();
    expect(expenseDollars({ payment_method: 'usd', usd_amount: null, usd_rate: 12850 })).toBeNull();
  });
});
