import { describe, expect, it } from 'vitest';
import { auditEntryDate, auditFieldChanges, auditFieldKind, filterAuditLogs } from './entryHistory';

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

describe('auditFieldKind', () => {
  it('knows money, dates, methods and falls back to text', () => {
    expect(auditFieldKind('cash_income')).toBe('money');
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
