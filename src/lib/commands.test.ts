import { describe, expect, it } from 'vitest';
import { commandPages, filterCommands, quickActions } from './commands';
import { consumeQuickAction, requestQuickAction } from './quickActions';

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('quickActions', () => {
  it('offers an owner every action, the most frequent first', () => {
    expect(ids(quickActions('owner', null))).toEqual(['addExpense', 'enterCash', 'countStock', 'recordPurchase', 'addDebt']);
  });

  it('offers only what the member may do', () => {
    expect(ids(quickActions('admin', ['daily_cash']))).toEqual(['enterCash']);
    expect(ids(quickActions('admin', ['expenses', 'debts']))).toEqual(['addExpense', 'addDebt']);
    // A viewer reads debts and purchases but records neither.
    expect(ids(quickActions('viewer', ['debts', 'stock_purchase']))).toEqual([]);
  });

  it('names the form the destination opens', () => {
    const byId = Object.fromEntries(quickActions('owner', null).map((item) => [item.id, item]));
    expect(byId.addExpense).toMatchObject({ href: '/reports', pending: 'expense' });
    expect(byId.addDebt).toMatchObject({ href: '/debts', pending: 'debt' });
    expect(byId.enterCash.pending).toBeUndefined();
  });
});

describe('commandPages', () => {
  const hrefs = (items: { href: string }[]) => items.map((item) => item.href);

  it('lists every screen for an owner, section tabs included', () => {
    expect(hrefs(commandPages('owner', null))).toEqual([
      '/dashboard', '/financial-analysis', '/assistant', '/daily-cash', '/closing-stock', '/stock-purchase', '/products',
      '/promotions', '/reports', '/daily-report', '/monthly-report', '/money-taken', '/reserve', '/debts', '/salaries',
      '/showcase', '/team', '/history', '/settings',
    ]);
  });

  it('follows feature access and keeps owner-only screens from others', () => {
    const pages = hrefs(commandPages('admin', ['daily_cash', 'expenses']));
    expect(pages).toEqual(['/daily-cash', '/reports', '/salaries']);
    expect(hrefs(commandPages('admin', ['team', 'owner_profit']))).not.toContain('/team');
    expect(hrefs(commandPages('admin', ['team', 'owner_profit']))).not.toContain('/reserve');
  });
});

describe('filterCommands', () => {
  const items = [
    { label: 'Add an expense', keywords: 'expense spend' },
    { label: 'Reports', keywords: 'reports expenses closeout' },
    { label: 'Debts', keywords: 'debts owe' },
    { label: 'Daily Report', keywords: 'dailyReport daily-report day profit' },
    { label: "O'tgan oy", keywords: '' },
  ];
  const labels = (query: string) => filterCommands(items, query).map((item) => item.label);

  it('returns everything for an empty query', () => {
    expect(labels('  ')).toHaveLength(items.length);
  });

  it('matches labels and keywords, ignoring case', () => {
    expect(labels('DEBT')).toEqual(['Debts']);
    expect(labels('owe')).toEqual(['Debts']);
    expect(labels('zzz')).toEqual([]);
  });

  it('puts a label that starts with the query first', () => {
    expect(labels('rep')).toEqual(['Reports', 'Daily Report']);
    expect(labels('expense')).toEqual(['Add an expense', 'Reports']);
  });

  it('needs every typed word and ignores apostrophes', () => {
    expect(labels('daily profit')).toEqual(['Daily Report']);
    expect(labels('daily debts')).toEqual([]);
    expect(labels('otgan')).toEqual(["O'tgan oy"]);
  });
});

describe('quick action requests', () => {
  it('are consumed once, by the form they were meant for', () => {
    requestQuickAction('expense', 1_000);
    expect(consumeQuickAction('debt', 1_500)).toBe(false);
    expect(consumeQuickAction('expense', 2_000)).toBe(true);
    expect(consumeQuickAction('expense', 2_100)).toBe(false);
  });

  it('expire when the page never opened', () => {
    requestQuickAction('debt', 1_000);
    expect(consumeQuickAction('debt', 20_000)).toBe(false);
    // The stale request is gone, not waiting for a later visit.
    expect(consumeQuickAction('debt', 20_001)).toBe(false);
  });
});
