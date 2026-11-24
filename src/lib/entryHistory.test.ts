import { describe, expect, it } from 'vitest';
import {
  AUDITED_TABLES,
  auditEntryDate,
  auditRecordHref,
  auditRecordSubject,
  auditReferencedIds,
  auditFieldChanges,
  auditFieldKind,
  auditMoneyUnit,
  auditTableGroup,
  auditTablesOfGroup,
  filterAuditLogs,
} from './entryHistory';

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
    expect(auditEntryDate(null)).toBeNull();
    expect(auditEntryDate({ entry_date: '2026-10-04', period_month: '2026-10-01' })).toBe('2026-10-04');
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

describe('auditMoneyUnit', () => {
  it('shows ledger amounts and rates in sums', () => {
    expect(auditMoneyUnit('amount', { payment_method: 'cash' })).toBe('uzs');
    expect(auditMoneyUnit('cash_income', {})).toBe('uzs');
    expect(auditMoneyUnit('cost_price', {})).toBe('uzs');
    expect(auditMoneyUnit('rate', { from_method: 'cash', to_method: 'usd' })).toBe('uzs');
    expect(auditMoneyUnit('usd_rate', {})).toBe('uzs');
    // A reserve entry is always recorded in sums, whatever its method says.
    expect(auditMoneyUnit('amount', { kind: 'deposit', payment_method: 'usd' })).toBe('uzs');
  });

  it('shows the dollar side of an exchange and a dollar expense in dollars', () => {
    const bought = { from_method: 'cash', to_method: 'usd' };
    expect(auditMoneyUnit('from_amount', bought)).toBe('uzs');
    expect(auditMoneyUnit('to_amount', bought)).toBe('usd');
    const sold = { from_method: 'usd', to_method: 'card' };
    expect(auditMoneyUnit('from_amount', sold)).toBe('usd');
    expect(auditMoneyUnit('to_amount', sold)).toBe('uzs');
    expect(auditMoneyUnit('usd_amount', {})).toBe('usd');
  });

  it('has no unit for fields that are not money', () => {
    expect(auditMoneyUnit('quantity', {})).toBeNull();
    expect(auditMoneyUnit('comment', {})).toBeNull();
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
    expect(filterAuditLogs(logs, { group: 'all', table: 'all', action: 'all' })).toHaveLength(3);
    expect(filterAuditLogs(logs, { group: 'all', table: 'expenses', action: 'all' })).toHaveLength(2);
    expect(filterAuditLogs(logs, { group: 'all', table: 'all', action: 'update' })).toHaveLength(2);
    expect(filterAuditLogs(logs, { group: 'all', table: 'expenses', action: 'delete' })).toEqual([logs[0]]);
  });

  it('narrows by area', () => {
    const mixed = [
      { table_name: 'expenses', action: 'update' },
      { table_name: 'products', action: 'insert' },
      { table_name: 'stock_purchases', action: 'delete' },
      { table_name: 'club_memberships', action: 'update' },
      { table_name: 'clubs', action: 'update' },
    ] as const;
    expect(filterAuditLogs(mixed, { group: 'bar', table: 'all', action: 'all' })).toEqual([mixed[1], mixed[2]]);
    expect(filterAuditLogs(mixed, { group: 'people', table: 'all', action: 'all' })).toEqual([mixed[3]]);
    expect(filterAuditLogs(mixed, { group: 'club', table: 'all', action: 'all' })).toEqual([mixed[4]]);
    expect(filterAuditLogs(mixed, { group: 'money', table: 'all', action: 'all' })).toEqual([mixed[0]]);
    expect(filterAuditLogs(mixed, { group: 'all', table: 'all', action: 'insert' })).toEqual([mixed[1]]);
  });
});

describe('audit groups', () => {
  it('puts every record type in exactly one area', () => {
    expect(new Set(AUDITED_TABLES).size).toBe(AUDITED_TABLES.length);
    for (const table of AUDITED_TABLES) expect(auditTableGroup(table)).not.toBeNull();
    expect(auditTableGroup('money_collections')).toBe('money');
    expect(auditTableGroup('daily_stock_counts')).toBe('bar');
    expect(auditTableGroup('salary_employees')).toBe('people');
    expect(auditTableGroup('expense_presets')).toBe('club');
    expect(auditTableGroup('mystery')).toBeNull();
    expect(auditTablesOfGroup('all')).toBe(AUDITED_TABLES);
    expect(auditTablesOfGroup('people')).toEqual(['club_memberships', 'salary_employees']);
  });
});

describe('auditFieldChanges for the records 183 logs', () => {
  it('lists the watched fields of a new product, leaving stock and an unset archive flag out', () => {
    expect(auditFieldChanges({
      table_name: 'products',
      action: 'insert',
      old_row: null,
      new_row: { id: 'p', club_id: 'c', name: 'Cola', category: 'drinks', sale_price: 8000, cost_price: 4500.5, low_stock_threshold: null, is_active: true, is_deleted: false, current_stock: 50, sort_order: 3, updated_at: 'x' },
    })).toEqual([
      { field: 'name', before: undefined, after: 'Cola' },
      { field: 'category', before: undefined, after: 'drinks' },
      { field: 'sale_price', before: undefined, after: 8000 },
      { field: 'cost_price', before: undefined, after: 4500.5 },
      { field: 'is_active', before: undefined, after: true },
    ]);
  });

  it('shows only watched columns of an edit, not the stock it moved', () => {
    expect(auditFieldChanges({
      table_name: 'products',
      action: 'update',
      old_row: { name: 'Cola', sale_price: 8000, current_stock: 50, updated_at: 'a' },
      new_row: { name: 'Cola', sale_price: 9000, current_stock: 40, updated_at: 'b' },
    })).toEqual([{ field: 'sale_price', before: 8000, after: 9000 }]);
  });

  it('reads a stock count as its closing stock and one adjustment', () => {
    expect(auditFieldChanges({
      table_name: 'daily_stock_counts',
      action: 'update',
      old_row: { closing_stock: 62, adjustment_quantity: 0, adjustment_reason: null, sold_quantity: 12, bar_income: 1 },
      new_row: { closing_stock: 59, adjustment_quantity: -3, adjustment_reason: 'expired: sour', sold_quantity: 12, bar_income: 1 },
    })).toEqual([
      { field: 'closing_stock', before: 62, after: 59 },
      { field: 'adjustment', before: null, after: { quantity: 3, sign: -1, kind: 'expired', note: 'sour' } },
    ]);
  });

  it('tells a member\'s new role and the pages it opened and closed', () => {
    expect(auditFieldChanges({
      table_name: 'club_memberships',
      action: 'update',
      old_row: { user_id: 'u', role: 'admin', feature_access: ['dashboard', 'reports', 'debts'] },
      new_row: { user_id: 'u', role: 'admin', feature_access: ['dashboard', 'reports', 'salaries'] },
    })).toEqual([
      { field: 'pages_opened', before: undefined, after: ['salaries'] },
      { field: 'pages_closed', before: undefined, after: ['debts'] },
    ]);
    // A viewer made an admin with no list of their own gets the admin's default pages.
    const promoted = auditFieldChanges({
      table_name: 'club_memberships',
      action: 'update',
      old_row: { role: 'viewer', feature_access: null },
      new_row: { role: 'admin', feature_access: null },
    });
    expect(promoted[0]).toEqual({ field: 'role', before: 'viewer', after: 'admin' });
    expect(promoted[1]).toMatchObject({ field: 'pages_opened', after: expect.arrayContaining(['daily_cash', 'expenses']) });
    expect(promoted).toHaveLength(2);
  });

  it('lists the pages of granted access as the role and list open them', () => {
    const [role, pages] = auditFieldChanges({ table_name: 'club_memberships', action: 'insert', old_row: null, new_row: { role: 'viewer', feature_access: ['reports'] } });
    expect(role).toEqual({ field: 'role', before: undefined, after: 'viewer' });
    expect(pages).toEqual({ field: 'pages', before: undefined, after: ['reports'] });
  });

  it('keeps a club\'s cleared payment method list as a change', () => {
    expect(auditFieldChanges({
      table_name: 'clubs',
      action: 'update',
      old_row: { name: 'Pixel', enabled_payment_methods: null, business_day_start_hour: 0, updated_at: 'a' },
      new_row: { name: 'Pixel', enabled_payment_methods: ['cash', 'card'], business_day_start_hour: 6, updated_at: 'b' },
    })).toEqual([
      { field: 'business_day_start_hour', before: 0, after: 6 },
      { field: 'enabled_payment_methods', before: null, after: ['cash', 'card'] },
    ]);
  });
});

describe('auditFieldKind by table', () => {
  it('reads the new settings, people and bar fields', () => {
    expect(auditFieldKind('sale_price')).toBe('unitMoney');
    expect(auditFieldKind('monthly_amount')).toBe('money');
    expect(auditFieldKind('role')).toBe('role');
    expect(auditFieldKind('pages_opened')).toBe('pages');
    expect(auditFieldKind('business_day_start_hour')).toBe('hour');
    expect(auditFieldKind('enabled_payment_methods')).toBe('methods');
    expect(auditFieldKind('internet_payment_day')).toBe('dayOfMonth');
    expect(auditFieldKind('adjustment')).toBe('stockAdjustment');
    expect(auditFieldKind('archived_at')).toBe('dateTime');
    // A product's category is the club's own text, a planned expense's is an expense category.
    expect(auditFieldKind('category', 'products')).toBe('text');
    expect(auditFieldKind('category', 'expense_presets')).toBe('category');
    expect(auditFieldKind('reason', 'cash_shortages')).toBe('shortageReason');
  });
});

describe('auditRecordSubject and auditReferencedIds', () => {
  const base = { changed_by: 'owner', row_id: null, old_row: null, new_row: null };
  it('names what an entry is about', () => {
    expect(auditRecordSubject({ ...base, table_name: 'products', action: 'insert', new_row: { name: ' Cola ' } } as never)).toEqual({ kind: 'text', value: 'Cola' });
    expect(auditRecordSubject({ ...base, table_name: 'daily_stock_counts', old_row: { product_id: 'p1' }, new_row: { product_id: 'p1' } } as never)).toEqual({ kind: 'product', id: 'p1' });
    expect(auditRecordSubject({ ...base, table_name: 'club_memberships', row_id: 'u2', old_row: { role: 'admin' } } as never)).toEqual({ kind: 'person', id: 'u2' });
    expect(auditRecordSubject({ ...base, table_name: 'salary_entries', new_row: { employee_id: 'e1' } } as never)).toEqual({ kind: 'employee', id: 'e1' });
    expect(auditRecordSubject({ ...base, table_name: 'expenses', new_row: { name: 'x' } } as never)).toBeNull();
  });

  it('collects the ids to resolve, once each', () => {
    expect(auditReferencedIds([
      { ...base, table_name: 'promotions', old_row: { product_id: 'p1', created_by: 'admin' }, new_row: { product_id: 'p2', created_by: 'admin' } },
      { ...base, table_name: 'club_memberships', row_id: 'u2', old_row: { role: 'admin' } },
      { ...base, table_name: 'salary_entries', new_row: { employee_id: 'e1' } },
    ] as never)).toEqual({ users: ['owner', 'admin', 'u2'], products: ['p1', 'p2'], employees: ['e1'] });
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

  it('opens bar, team and settings records on the page that owns them', () => {
    expect(auditRecordHref('products', null)).toBe('/products');
    expect(auditRecordHref('daily_stock_counts', '2026-11-05')).toBe('/closing-stock?date=2026-11-05');
    expect(auditRecordHref('promotions', null)).toBe('/promotions');
    expect(auditRecordHref('club_memberships', null)).toBe('/team');
    expect(auditRecordHref('clubs', null)).toBe('/settings');
    expect(auditRecordHref('expense_presets', null)).toBe('/settings');
    expect(auditRecordHref('salary_employees', null, { id: 'e1' })).toBe('/salaries/employees/e1');
    expect(auditRecordHref('salary_entries', '2026-11-05', { employee_id: 'e1' })).toBe('/salaries/employees/e1');
    expect(auditRecordHref('money_collections', '2026-11-05')).toBe('/reports?from=2026-11-05&to=2026-11-05');
  });

  it('has nowhere to go for an unknown table', () => {
    expect(auditRecordHref('mystery', '2026-11-01')).toBeNull();
  });
});
