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

  it('leads a USD-account expense with its dollars and names the account, never a rate or its sums', () => {
    const message = buildExpenseNotification({
      addedBy: 'A', amount: 1_082_003, category: 'equipment', comment: null, date: '2026-11-24',
      paymentMethod: 'usd', paymentSource: 'game_club', dollars: { amount: 90 },
    });
    // Dollars are the reserve's own money (143); their sums are what they cost (184), not news to the group.
    expect(message.split('\n')).toEqual([
      '🏦 Расход из резерва: $90',
      'Долларовый счёт · Оборудование · 24 ноября',
      'A',
    ]);
    expect(message).not.toContain('по курсу');
    expect(message).not.toContain('сум');
  });

  it('keeps a dollar amount\'s cents', () => {
    const message = buildExpenseNotification({
      addedBy: 'A', amount: 125_000, category: 'repair', comment: null, date: '2026-09-01',
      paymentMethod: 'usd', paymentSource: 'game_club', dollars: { amount: 10.5 },
    });
    expect(message.split('\n')[0]).toBe('🏦 Расход из резерва: $10,5');
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
    expect(expenseDollars({ payment_method: 'usd', usd_amount: '100' })).toEqual({ amount: 100 });
    expect(expenseDollars({ payment_method: 'cash', usd_amount: 100 })).toBeNull();
    expect(expenseDollars({ payment_method: 'usd', usd_amount: null })).toBeNull();
  });
});

describe('an expense paid from collected money (169)', () => {
  it('says so after the side', () => {
    const text = buildExpenseNotification({
      addedBy: 'Mother', amount: 3_000_000, category: 'repairs', comment: 'server bill', date: '2026-11-03',
      paymentMethod: 'cash', paymentSource: 'game_club', fromCollected: true,
    });
    expect(text.split('\n')[1]).toContain('Игровой клуб · из собранных денег');
  });
});
