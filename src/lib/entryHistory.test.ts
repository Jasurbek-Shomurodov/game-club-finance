import { describe, expect, it } from 'vitest';
import { auditEntryDate, auditRecordHref, auditFieldChanges, auditFieldKind, filterAuditLogs } from './entryHistory';

describe('auditFieldChanges', () => {
  it('lists only the visible fields an edit changed', () => {
    expect(auditFieldChanges({
      action: 'update',
      old_row: { id: 'e1', club_id: 'c', amount: 100, comment: 'rent', date: '2026-10-01', updated_at: 'a', telegram_message_id: 1 },
      new_row: { id: 'e1', club_id: 'c', amount: 150, comment: 'rent', date: '2026-10-02', updated_at: 'b', telegram_message_id: 2 },
    })).toEqual([
      { field: 'amount', before: 100, after: 150 },
      { field: 'date', before: '2026-10-01', after: '2026-10-02' },
    ]);
  });

  it('treats a missing and a null value as the same', () => {
    expect(auditFieldChanges({ action: 'update', old_row: { comment: null }, new_row: {} })).toEqual([]);
  });

  it('shows every filled visible field of a deleted row', () => {
    expect(auditFieldChanges({
      action: 'delete',
      old_row: { id: 'x', amount: 5, comment: '', category: 'rent', salary_entry_id: null, created_by: 'u' },
      new_row: null,
    })).toEqual([
      { field: 'amount', before: 5, after: undefined },
      { field: 'category', before: 'rent', after: undefined },
    ]);
  });
});

describe('auditEntryDate', () => {
  it('prefers the entry date, then the withdrawal or carryover month', () => {
    expect(auditEntryDate({ date: '2026-10-03', period_month: '2026-09-01' })).toBe('2026-10-03');
    expect(auditEntryDate({ period_month: '2026-09-01' })).toBe('2026-09-01');
    expect(auditEntryDate({ from_month: '2026-08-01T00:00:00' })).toBe('2026-08-01');
    expect(auditEntryDate({})).toBeNull();
  });
});

describe('auditFieldKind for reserve and dollar fields', () => {
  it('knows how to show every field the reserve and dollar expenses log', () => {
    expect(auditFieldKind('kind')).toBe('entryKind');
    expect(auditFieldKind('collection_date')).toBe('date');
    expect(auditFieldKind('usd_amount')).toBe('unitMoney');
    expect(auditFieldKind('usd_rate')).toBe('unitMoney');
    expect(auditFieldKind('paid_from_reserve')).toBe('yesNo');
  });
});

describe('auditFieldKind', () => {
  it('knows money, dates, methods and falls back to text', () => {
    expect(auditFieldKind('cash_income')).toBe('money');
    expect(auditFieldKind('from_amount')).toBe('unitMoney');
    expect(auditFieldKind('to_amount')).toBe('unitMoney');
    expect(auditFieldKind('rate')).toBe('unitMoney');
    expect(auditFieldKind('period_month')).toBe('month');
    expect(auditFieldKind('to_method')).toBe('method');
    expect(auditFieldKind('product_id')).toBe('product');
    expect(auditFieldKind('person_name')).toBe('text');
  });
});

describe('filterAuditLogs', () => {
  const logs = [
    { table_name: 'expenses', action: 'delete' },
    { table_name: 'expenses', action: 'update' },
    { table_name: 'daily_cash_entries', action: 'update' },
  ] as const;

  it('narrows by ledger and by action', () => {
    expect(filterAuditLogs(logs, { table: 'all', action: 'all' })).toHaveLength(3);
    expect(filterAuditLogs(logs, { table: 'expenses', action: 'all' })).toHaveLength(2);
    expect(filterAuditLogs(logs, { table: 'all', action: 'update' })).toHaveLength(2);
    expect(filterAuditLogs(logs, { table: 'expenses', action: 'delete' })).toEqual([logs[0]]);
  });
});

describe('auditRecordHref', () => {
  it('opens a day-based record on its day', () => {
    expect(auditRecordHref('expenses', '2026-11-05')).toBe('/reports?from=2026-11-05&to=2026-11-05&category=expense');
    expect(auditRecordHref('daily_cash_entries', '2026-11-05')).toBe('/reports?from=2026-11-05&to=2026-11-05');
    expect(auditRecordHref('debt_payments', null)).toBe('/reports?category=debt_payment');
    expect(auditRecordHref('stock_purchases', '2026-11-05')).toBe('/closing-stock?date=2026-11-05');
    expect(auditRecordHref('stock_purchases', null)).toBe('/stock-purchase');
  });

  it('opens owner money, debts and the reserve on their pages', () => {
    expect(auditRecordHref('owner_withdrawals', '2026-11-01')).toBe('/money-taken');
    expect(auditRecordHref('new_debts', '2026-11-01')).toBe('/debts');
    expect(auditRecordHref('owner_reserve_entries', null)).toBe('/reserve?view=history');
  });

  it('has nowhere to go for an unknown table', () => {
    expect(auditRecordHref('mystery', '2026-11-01')).toBeNull();
  });
});
