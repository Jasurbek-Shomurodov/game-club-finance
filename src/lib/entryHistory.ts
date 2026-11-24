import type { AuditedTable, EntryAuditLog, UserRole } from '@/types';
import { closingStockHref, debtsHref, employeeSalaryHref, productsHref, reserveHistoryHref } from '@/lib/detailLinks';
import { featureAccessForMembership, type FeatureKey } from '@/lib/permissions';
import { rowStockAdjustment } from '@/lib/stockWriteOffs';

type Row = Record<string, unknown>;

/** The areas the history filter groups its record types into. */
export const AUDIT_GROUPS = ['money', 'bar', 'people', 'club'] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];

/** Every record type /history shows, by area, in the order the filter lists them. */
export const AUDIT_TABLE_GROUPS: Readonly<Record<AuditGroup, readonly AuditedTable[]>> = {
  money: [
    'daily_cash_entries',
    'expenses',
    'money_exchanges',
    'owner_withdrawals',
    'owner_profit_carryovers',
    'new_debts',
    'debt_payments',
    'daily_cash_collections',
    'money_collections',
    'cash_shortages',
    'owner_reserve_entries',
    'salary_entries',
  ],
  bar: ['products', 'daily_stock_counts', 'stock_purchases', 'promotions'],
  people: ['club_memberships', 'salary_employees'],
  club: ['clubs', 'expense_presets'],
};

/** Every record type /history shows; anything else the log holds stays out. */
export const AUDITED_TABLES: readonly AuditedTable[] = AUDIT_GROUPS.flatMap((group) => AUDIT_TABLE_GROUPS[group]);

/**
 * The record types whose creation /history shows: a new product, promotion,
 * team access or planned expense. Money entries appear only once they are
 * edited or deleted (the owner's decision, docs/plans/activity-history.md),
 * so the creations migration 183 logs for the activity notices of withdrawals,
 * carryovers, purchases, debts, debt payments, collected money moved into the
 * reserve and shortage recoveries are not shown.
 */
export const AUDIT_CREATION_TABLES: readonly AuditedTable[] = ['products', 'promotions', 'club_memberships', 'expense_presets'];

export function auditTableGroup(table: string): AuditGroup | null {
  return AUDIT_GROUPS.find((group) => AUDIT_TABLE_GROUPS[group].includes(table as AuditedTable)) ?? null;
}

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
  'cash_shortage_id',
  'employee_id',
  'promotion_id',
  'request_id',
  'paired_exchange_id',
  'current_stock',
  'sort_order',
]);

/**
 * The columns migration 183 watches, in the order an entry lists them. Only
 * these show for these tables: the rest of the row is stock the counts derive,
 * ordering and bookkeeping.
 */
const WATCHED_FIELDS: Partial<Record<AuditedTable, readonly string[]>> = {
  products: ['name', 'category', 'sale_price', 'cost_price', 'low_stock_threshold', 'is_active', 'is_deleted'],
  daily_stock_counts: ['closing_stock', 'adjustment_quantity', 'adjustment_reason'],
  promotions: ['name', 'product_id', 'free_quantity', 'min_spend', 'starts_on', 'ends_on', 'is_active'],
  club_memberships: ['role', 'feature_access'],
  clubs: ['name', 'address', 'business_day_start_hour', 'enabled_payment_methods', 'internet_payment_day'],
  expense_presets: ['name', 'category', 'payment_source', 'payment_method', 'monthly_amount', 'archived_at'],
  salary_employees: ['name', 'job_title'],
  salary_entries: ['payment_method', 'payment_source'],
};

/** Off by default, so a new record says nothing by leaving them off. */
const UNSET_WHEN_FALSE = new Set(['is_deleted']);

export type AuditFieldKind =
  | 'money' | 'unitMoney' | 'quantity' | 'date' | 'dateTime' | 'month' | 'method' | 'methods' | 'source' | 'category'
  | 'product' | 'entryKind' | 'yesNo' | 'role' | 'pages' | 'hour' | 'dayOfMonth' | 'stockAdjustment' | 'shortageReason' | 'text';

const FIELD_KINDS: Record<string, AuditFieldKind> = {
  cash_income: 'money',
  terminal_income: 'money',
  card_income: 'money',
  playstation_income: 'money',
  amount: 'money',
  monthly_amount: 'money',
  min_spend: 'money',
  // Dollars keep cents and a rate can be fractional; whole sums still show whole.
  from_amount: 'unitMoney',
  to_amount: 'unitMoney',
  rate: 'unitMoney',
  // Unit prices: a product's average cost keeps its fraction.
  cost_price: 'unitMoney',
  sale_price: 'unitMoney',
  quantity: 'quantity',
  free_quantity: 'quantity',
  low_stock_threshold: 'quantity',
  closing_stock: 'quantity',
  date: 'date',
  entry_date: 'date',
  starts_on: 'date',
  ends_on: 'date',
  archived_at: 'dateTime',
  period_month: 'month',
  from_month: 'month',
  to_month: 'month',
  payment_method: 'method',
  from_method: 'method',
  to_method: 'method',
  enabled_payment_methods: 'methods',
  payment_source: 'source',
  source: 'source',
  category: 'category',
  product_id: 'product',
  // Owner reserve entries (136, 137) and dollar or reserve-paid expenses (124, 136).
  kind: 'entryKind',
  collection_date: 'date',
  usd_amount: 'unitMoney',
  usd_rate: 'unitMoney',
  paid_from_reserve: 'yesNo',
  paid_from_collected: 'yesNo',
  from_collected: 'yesNo',
  is_active: 'yesNo',
  is_deleted: 'yesNo',
  role: 'role',
  pages: 'pages',
  pages_opened: 'pages',
  pages_closed: 'pages',
  business_day_start_hour: 'hour',
  internet_payment_day: 'dayOfMonth',
  adjustment: 'stockAdjustment',
};

/** A field that reads differently in one table: a product's category is the club's own free text. */
const TABLE_FIELD_KINDS: Partial<Record<AuditedTable, Record<string, AuditFieldKind>>> = {
  products: { category: 'text' },
  cash_shortages: { reason: 'shortageReason' },
};

export function auditFieldKind(field: string, table?: string): AuditFieldKind {
  return TABLE_FIELD_KINDS[table as AuditedTable]?.[field] ?? FIELD_KINDS[field] ?? 'text';
}

export type AuditMoneyUnit = 'uzs' | 'usd';

/**
 * The currency a money field of an audited row is in, or null when the field
 * is not money. Everything is in sums except the dollar side of an exchange
 * (the amount whose method is `usd`) and an expense's `usd_amount`; rates are
 * sums per one dollar. `row` is the row the value was read from.
 */
export function auditMoneyUnit(field: string, row: Record<string, unknown>): AuditMoneyUnit | null {
  const kind = auditFieldKind(field);
  if (kind !== 'money' && kind !== 'unitMoney') return null;
  if (field === 'usd_amount') return 'usd';
  if (field === 'from_amount') return row.from_method === 'usd' ? 'usd' : 'uzs';
  if (field === 'to_amount') return row.to_method === 'usd' ? 'usd' : 'uzs';
  return 'uzs';
}

export interface AuditFieldChange {
  field: string;
  /** The value before an edit or of a deleted row; undefined for a creation or a list of opened pages. */
  before: unknown;
  /** The value after an edit or of a created row; undefined for a delete. */
  after: unknown;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

const memberRole = (row: Row): UserRole => (row.role === 'owner' || row.role === 'admin' ? row.role : 'viewer');

/** What a team member may open, role defaults included, in the Team page's order. */
export function membershipPages(row: Row): FeatureKey[] {
  return featureAccessForMembership(memberRole(row), row.feature_access);
}

/**
 * The fields of one row as the history shows them. A table 183 watches shows
 * only its watched columns; a stock count's adjustment reads as one value, and
 * a membership's page access as the pages its role and list open.
 */
function displayRow(table: string | undefined, row: Row | null): Row | null {
  if (!row) return null;
  const watched = WATCHED_FIELDS[table as AuditedTable];
  if (!watched) return Object.fromEntries(Object.entries(row).filter(([field]) => !HIDDEN_FIELDS.has(field)));
  if (table === 'daily_stock_counts') {
    return {
      closing_stock: row.closing_stock ?? null,
      adjustment: rowStockAdjustment({ adjustmentQuantity: text(row.adjustment_quantity) || '0', adjustmentReason: text(row.adjustment_reason) }),
    };
  }
  if (table === 'club_memberships') return { role: row.role ?? null, pages: membershipPages(row) };
  return Object.fromEntries(watched.map((field) => [field, row[field] ?? null]));
}

const isFilled = (field: string, value: unknown) => value !== null && value !== undefined && value !== ''
  && !(value === false && UNSET_WHEN_FALSE.has(field));

/**
 * What an owner needs to see of one history entry: the fields an edit changed,
 * or every meaningful field of a created or deleted row. Field order follows
 * the row. A change of a member's pages lists the pages opened and closed.
 */
export function auditFieldChanges(
  log: Pick<EntryAuditLog, 'action' | 'old_row' | 'new_row'> & { table_name?: string },
): AuditFieldChange[] {
  const before = displayRow(log.table_name, log.old_row);
  const after = displayRow(log.table_name, log.new_row);
  if (log.action === 'insert' || !before) {
    return Object.entries(after ?? {})
      .filter(([field, value]) => isFilled(field, value))
      .map(([field, value]) => ({ field, before: undefined, after: value }));
  }
  if (log.action === 'delete' || !after) {
    return Object.entries(before)
      .filter(([field, value]) => isFilled(field, value))
      .map(([field, value]) => ({ field, before: value, after: undefined }));
  }
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields
    .filter((field) => !sameValue(before[field], after[field]))
    .flatMap((field): AuditFieldChange[] => {
      if (log.table_name === 'club_memberships' && field === 'pages') {
        const had = before.pages as FeatureKey[];
        const has = after.pages as FeatureKey[];
        const opened = has.filter((key) => !had.includes(key));
        const closed = had.filter((key) => !has.includes(key));
        return [
          ...(opened.length ? [{ field: 'pages_opened', before: undefined, after: opened }] : []),
          ...(closed.length ? [{ field: 'pages_closed', before: undefined, after: closed }] : []),
        ];
      }
      return [{ field, before: before[field] ?? null, after: after[field] ?? null }];
    });
}

/** The row an entry is about as it is now: after the change, or as it was when deleted. */
export function auditCurrentRow(log: Pick<EntryAuditLog, 'old_row' | 'new_row'>): Row {
  return log.new_row ?? log.old_row ?? {};
}

/** The business date the entry belongs to (not when it was changed). */
export function auditEntryDate(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  for (const field of ['date', 'entry_date', 'period_month', 'from_month']) {
    const value = row[field];
    if (typeof value === 'string' && value) return value.slice(0, 10);
  }
  return null;
}

/** Who or what an entry is about, for its heading; the page resolves ids to names. */
export type AuditSubject =
  | { kind: 'text'; value: string }
  | { kind: 'product' | 'person' | 'employee'; id: string };

export function auditRecordSubject(log: Pick<EntryAuditLog, 'table_name' | 'row_id' | 'old_row' | 'new_row'>): AuditSubject | null {
  const row = auditCurrentRow(log);
  const id = (value: unknown) => text(value).trim();
  switch (log.table_name) {
    case 'products':
    case 'promotions':
    case 'expense_presets':
    case 'salary_employees': {
      const name = id(row.name);
      return name ? { kind: 'text', value: name } : null;
    }
    case 'daily_stock_counts':
      return id(row.product_id) ? { kind: 'product', id: id(row.product_id) } : null;
    case 'club_memberships': {
      const user = id(row.user_id) || id(log.row_id);
      return user ? { kind: 'person', id: user } : null;
    }
    case 'salary_entries':
      return id(row.employee_id) ? { kind: 'employee', id: id(row.employee_id) } : null;
    default:
      return null;
  }
}

/** The people, products and employees a set of entries mentions, for one name lookup each. */
export function auditReferencedIds(logs: readonly Pick<EntryAuditLog, 'table_name' | 'row_id' | 'old_row' | 'new_row' | 'changed_by'>[]) {
  const users = new Set<string>();
  const products = new Set<string>();
  const employees = new Set<string>();
  const add = (into: Set<string>, value: unknown) => {
    if (typeof value === 'string' && value) into.add(value);
  };
  for (const log of logs) {
    add(users, log.changed_by);
    add(users, auditCurrentRow(log).created_by);
    for (const row of [log.old_row, log.new_row]) add(products, row?.product_id);
    const subject = auditRecordSubject(log);
    if (subject?.kind === 'person') add(users, subject.id);
    if (subject?.kind === 'employee') add(employees, subject.id);
  }
  return { users: [...users], products: [...products], employees: [...employees] };
}

/**
 * The page where an audited record lives now, for its day where the page takes one;
 * null when there is no page to open. `row` is the record as it is now.
 */
export function auditRecordHref(table: string, date: string | null, row: Row = {}): string | null {
  const day = date ? `?${new URLSearchParams({ from: date, to: date }).toString()}` : '';
  switch (table) {
    case 'daily_cash_entries':
    case 'daily_cash_collections':
    case 'money_collections':
      return `/reports${day}`;
    case 'expenses':
      return `/reports${day}${day ? '&' : '?'}category=expense`;
    case 'money_exchanges':
      return `/reports${day}${day ? '&' : '?'}category=exchange`;
    case 'debt_payments':
      return `/reports${day}${day ? '&' : '?'}category=debt_payment`;
    case 'stock_purchases':
      return date ? closingStockHref(date) : '/stock-purchase';
    case 'daily_stock_counts':
      return date ? closingStockHref(date) : '/closing-stock';
    case 'owner_withdrawals':
    case 'owner_profit_carryovers':
    case 'cash_shortages':
      return '/money-taken';
    case 'new_debts':
      return debtsHref();
    case 'owner_reserve_entries':
      return reserveHistoryHref();
    case 'products':
      return productsHref();
    case 'promotions':
      return '/promotions';
    case 'club_memberships':
      return '/team';
    case 'clubs':
    case 'expense_presets':
      return '/settings';
    case 'salary_employees':
      return text(row.id) ? employeeSalaryHref(text(row.id)) : '/salaries';
    case 'salary_entries':
      return text(row.employee_id) ? employeeSalaryHref(text(row.employee_id)) : '/salaries';
    default:
      return null;
  }
}

export interface AuditLogFilter {
  group: AuditGroup | 'all';
  table: AuditedTable | 'all';
  action: EntryAuditLog['action'] | 'all';
}

export function filterAuditLogs<T extends Pick<EntryAuditLog, 'table_name' | 'action'>>(logs: readonly T[], filter: AuditLogFilter): T[] {
  return logs.filter((log) =>
    (filter.group === 'all' || auditTableGroup(log.table_name) === filter.group)
    && (filter.table === 'all' || log.table_name === filter.table)
    && (filter.action === 'all' || log.action === filter.action));
}

/** The record types the table filter offers for an area. */
export function auditTablesOfGroup(group: AuditGroup | 'all'): readonly AuditedTable[] {
  return group === 'all' ? AUDITED_TABLES : AUDIT_TABLE_GROUPS[group];
}
