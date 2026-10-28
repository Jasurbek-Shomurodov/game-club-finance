import type { AuditedTable, EntryAuditLog } from '@/types';

/** Ledgers in the order the history filter lists them. */
export const AUDITED_TABLES: readonly AuditedTable[] = [
  'daily_cash_entries',
  'expenses',
  'money_exchanges',
  'stock_purchases',
  'owner_withdrawals',
  'owner_profit_carryovers',
  'new_debts',
  'debt_payments',
  'daily_cash_collections',
];

/** Keys, links and bookkeeping that say nothing to an owner reading the history. */
const HIDDEN_FIELDS = new Set([
  'id',
  'club_id',
  'created_by',
  'created_at',
  'updated_at',
  'telegram_chat_id',
  'telegram_message_id',
  'paid_amount',
  'remaining_amount',
  'status',
  'collected_by',
  'collected_at',
  'debt_id',
  'preset_id',
  'salary_entry_id',
  'promotion_id',
]);

export type AuditFieldKind = 'money' | 'quantity' | 'date' | 'month' | 'method' | 'source' | 'category' | 'product' | 'text';

const FIELD_KINDS: Record<string, AuditFieldKind> = {
  cash_income: 'money',
  terminal_income: 'money',
  card_income: 'money',
  playstation_income: 'money',
  amount: 'money',
  from_amount: 'money',
  to_amount: 'money',
  cost_price: 'money',
  sale_price: 'money',
  rate: 'money',
  quantity: 'quantity',
  date: 'date',
  period_month: 'month',
  from_month: 'month',
  to_month: 'month',
  payment_method: 'method',
  from_method: 'method',
  to_method: 'method',
  payment_source: 'source',
  source: 'source',
  category: 'category',
  product_id: 'product',
};

export function auditFieldKind(field: string): AuditFieldKind {
  return FIELD_KINDS[field] ?? 'text';
}

export interface AuditFieldChange {
  field: string;
  before: unknown;
  /** The value after an edit; undefined for a delete. */
  after: unknown;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What an owner needs to see of one history entry: the fields an edit changed,
 * or every meaningful field of a deleted row. Field order follows the row.
 */
export function auditFieldChanges(log: Pick<EntryAuditLog, 'action' | 'old_row' | 'new_row'>): AuditFieldChange[] {
  const fields = Object.keys(log.old_row).filter((field) => !HIDDEN_FIELDS.has(field));
  if (log.action === 'delete' || !log.new_row) {
    return fields
      .filter((field) => log.old_row[field] !== null && log.old_row[field] !== '')
      .map((field) => ({ field, before: log.old_row[field], after: undefined }));
  }
  const after = log.new_row;
  return fields
    .filter((field) => !sameValue(log.old_row[field], after[field]))
    .map((field) => ({ field, before: log.old_row[field], after: after[field] }));
}

/** The business date the entry belongs to (not when it was changed). */
export function auditEntryDate(row: Record<string, unknown>): string | null {
  for (const field of ['date', 'period_month', 'from_month']) {
    const value = row[field];
    if (typeof value === 'string' && value) return value.slice(0, 10);
  }
  return null;
}

export interface AuditLogFilter {
  table: AuditedTable | 'all';
  action: EntryAuditLog['action'] | 'all';
}

export function filterAuditLogs<T extends Pick<EntryAuditLog, 'table_name' | 'action'>>(logs: readonly T[], filter: AuditLogFilter): T[] {
  return logs.filter((log) =>
    (filter.table === 'all' || log.table_name === filter.table)
    && (filter.action === 'all' || log.action === filter.action));
}
