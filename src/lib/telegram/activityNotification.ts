import { formatCurrency, formatYearMonth } from '../formatters';
import { canAccessFeature, FEATURE_DEFINITIONS, type FeatureKey } from '../permissions';
import { rowStockAdjustment, type RowStockAdjustment } from '../stockWriteOffs';
import type { UserRole } from '@/types';
import { WRITE_OFF_KIND_LABELS } from './dailyFinanceReport';
import { RUSSIAN_EXPENSE_CATEGORY_LABELS } from './expenseCategoryLabels';
import { authorLine, commentLine, details, lines, method, noticeDate, source, sum, unitSum, units } from './messageParts';

/**
 * Club-group notices for the activity the database captures in
 * entry_audit_logs (migration 183): new products, promotions, team access,
 * club settings, planned expenses, owner money, purchases, debts and the
 * removal of collected money. Each message says what happened, then
 * "Field: old → new" for every field that changed, then who did it.
 * Russian, like every club-group message.
 */

type Row = Record<string, unknown>;
export type ActivityAction = 'insert' | 'update' | 'delete';

/** One entry_audit_logs row as claim_activity_notices returns it. */
export interface ActivityAuditRow {
  id: number;
  club_id: string;
  table_name: string;
  row_id: string | null;
  action: ActivityAction;
  /** The row before the change; null for an insert. */
  old_row: Row | null;
  /** The row after the change; null for a delete. */
  new_row: Row | null;
  /** Null when a server job or a migration made the change. */
  changed_by: string | null;
  changed_at: string;
  changed_on: string;
}

/** One or more log rows of the same record, by the same person, told as one change. */
export interface ActivityChange {
  table: string;
  action: ActivityAction;
  before: Row | null;
  after: Row | null;
  changedBy: string | null;
  rows: ActivityAuditRow[];
}

export interface ShortageLookup {
  amount: number;
  date: string;
  created_at: string;
}

/** Names the messages mention, read by the sender for the rows it claimed. */
export interface ActivityLookups {
  /** Profile names by user id: authors and team members. */
  people: ReadonlyMap<string, string>;
  products: ReadonlyMap<string, string>;
  /** Salary employee names by id. */
  employees: ReadonlyMap<string, string>;
  /** The person of a debt, by debt id. */
  debts: ReadonlyMap<string, string>;
  shortages: ReadonlyMap<string, ShortageLookup>;
}

/** The club's own group, or the owners-only group (cash shortages, which admins must not read). */
export type ActivityChat = 'club' | 'owners';

export interface ActivityNotice {
  chat: ActivityChat;
  text: string;
  /** The entry_audit_logs ids the message reports. */
  logIds: number[];
}

const SYSTEM_AUTHOR = 'Система';
const UNKNOWN_PERSON = 'Пользователь';

const ROLE_LABELS: Record<UserRole, string> = { owner: 'Владелец', admin: 'Администратор', viewer: 'Наблюдатель' };

/** The Team page's section names (team.features in ru.json). */
const FEATURE_LABELS: Record<FeatureKey, string> = {
  dashboard: 'Панель управления',
  daily_cash: 'Дневная касса',
  closing_stock: 'Закрытие склада',
  stock_purchase: 'Закупка товара',
  expenses: 'Расходы',
  reports: 'Отчёты',
  owner_profit: 'Прибыль владельца',
  debts: 'Долги',
  inventory: 'Инвентарь',
  salaries: 'Редактирование зарплат',
  assistant: 'ИИ-ассистент',
  collection: 'Инкассация',
  showcase: 'Публичная страница',
  team: 'Команда',
  settings: 'Настройки',
};

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value));
const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const orDash = (value: string) => value || '—';
const yesNo = (value: boolean) => (value ? 'да' : 'нет');
const category = (value: unknown) => orDash(RUSSIAN_EXPENSE_CATEGORY_LABELS[str(value)] ?? str(value));
const month = (value: unknown) => (str(value) ? formatYearMonth(str(value).slice(0, 7), 'ru').toLocaleLowerCase('ru') : '—');
const optionalDate = (value: unknown) => (str(value) ? noticeDate(str(value)) : '—');

/** "Field: old → new", or nothing when the field did not change. */
const diff = (label: string, before: string, after: string) => (before === after ? null : `${label}: ${before} → ${after}`);

/** The change lines that are not empty; null when nothing a reader would see changed. */
const changeLines = (...items: Array<string | null>) => {
  const changed = items.filter((item): item is string => item !== null);
  return changed.length > 0 ? changed : null;
};

/** Merge key of a log row: its record, except one collect of several methods (169), which is one request. */
function recordKey(row: ActivityAuditRow): string {
  if (row.table_name === 'money_collections') {
    const request = str((row.old_row ?? row.new_row)?.request_id);
    if (request) return `${row.table_name}:request:${request}`;
  }
  // "Withdraw all" (142) writes one withdrawal per method and the bar in one
  // transaction: same time, month and note. They are told as one.
  if (row.table_name === 'owner_withdrawals' && row.action === 'insert' && row.new_row) {
    const withdrawal = row.new_row;
    return `${row.table_name}:insert:${str(withdrawal.created_at) || row.changed_at}:${str(withdrawal.period_month)}:${str(withdrawal.comment)}`;
  }
  return `${row.table_name}:${row.row_id ?? `log:${row.id}`}`;
}

const PRODUCT_FIELDS = ['name', 'category', 'sale_price', 'cost_price', 'low_stock_threshold', 'is_active', 'is_deleted'] as const;

/** The watched fields this one log row changed. */
const rowChanged = (row: ActivityAuditRow, fields: readonly string[]) => fields.filter(
  (field) => JSON.stringify(row.old_row?.[field] ?? null) !== JSON.stringify(row.new_row?.[field] ?? null),
);

/**
 * Removing a purchase moves the product's stock and average cost in the same
 * update (120); that is the purchase's record, told by its own notice. A
 * person's product edit never moves stock.
 */
function isPurchaseProductRow(row: ActivityAuditRow): boolean {
  if (row.action !== 'update') return false;
  if (num(row.old_row?.current_stock) === num(row.new_row?.current_stock)) return false;
  return rowChanged(row, PRODUCT_FIELDS).every((field) => field === 'cost_price');
}

/** A log row whose change another notice tells, or that says nothing. */
function toldElsewhere(row: ActivityAuditRow): boolean {
  if (row.table_name === 'products') return isPurchaseProductRow(row);
  if (row.table_name === 'daily_stock_counts' && row.action === 'update') {
    return stockCountMove(row.old_row ?? {}, row.new_row ?? {}, row.changed_on).kind === 'skip';
  }
  return false;
}

/**
 * Oldest first, one change per record: later edits of a record by the same
 * person join its earlier insert or edit (several fields, page-access
 * toggles), and the rows of one removed collection join each other. A delete
 * after an insert or edit stays its own message.
 */
export function mergeActivityRows(rows: readonly ActivityAuditRow[]): ActivityChange[] {
  const changes: ActivityChange[] = [];
  const open = new Map<string, ActivityChange>();
  // A row another notice already tells is dropped on its own, before merging,
  // so it can neither hide nor join a person's edit of the same record.
  for (const row of [...rows].sort((a, b) => a.id - b.id).filter((item) => !toldElsewhere(item))) {
    const key = recordKey(row);
    const current = open.get(key);
    const samePerson = current !== undefined && current.changedBy === row.changed_by;
    if (current && samePerson && row.action === 'update' && current.action !== 'delete') {
      current.after = row.new_row;
      current.rows.push(row);
      continue;
    }
    const sameRequest = (row.table_name === 'money_collections' && row.action === 'delete' && current?.action === 'delete')
      || (row.table_name === 'owner_withdrawals' && row.action === 'insert' && current?.action === 'insert');
    if (current && samePerson && sameRequest) {
      current.rows.push(row);
      continue;
    }
    const next: ActivityChange = {
      table: row.table_name,
      action: row.action,
      before: row.old_row,
      after: row.new_row,
      changedBy: row.changed_by,
      rows: [row],
    };
    changes.push(next);
    open.set(key, next);
  }
  return changes;
}

type Builder = (change: ActivityChange, lookups: ActivityLookups, by: string) => string | null;

const current = (change: ActivityChange): Row => change.after ?? change.before ?? {};

function productNotice(change: ActivityChange, _lookups: ActivityLookups, by: string): string | null {
  const name = str(current(change).name) || 'Товар';
  const threshold = (row: Row) => (row.low_stock_threshold == null ? '—' : units(num(row.low_stock_threshold)));
  if (change.action === 'insert') {
    const row = change.after!;
    return lines(
      `🆕 Новый товар бара: ${name}`,
      details(str(row.category), `продажа ${unitSum(num(row.sale_price))}`, `себестоимость ${unitSum(num(row.cost_price))}`, row.is_active === false && 'не продаётся'),
      by,
    );
  }
  if (change.action !== 'update') return null;
  const before = change.before!;
  const after = change.after!;
  // Archiving also zeroes the stock (055); it is told before anything else.
  if (before.is_deleted !== true && after.is_deleted === true) return lines(`🗄 Товар убран в архив: ${name}`, by);
  // Only what these rows changed: stock and cost moved between them by a
  // count or a purchase are not this person's edit.
  const edited = new Set(change.rows.flatMap((row) => rowChanged(row, PRODUCT_FIELDS)));
  const field = (key: string, line: string | null) => (edited.has(key) ? line : null);
  const changed = changeLines(
    field('name', diff('Название', str(before.name), str(after.name))),
    field('category', diff('Категория', orDash(str(before.category)), orDash(str(after.category)))),
    field('sale_price', diff('Цена продажи', unitSum(num(before.sale_price)), unitSum(num(after.sale_price)))),
    field('cost_price', diff('Себестоимость', unitSum(num(before.cost_price)), unitSum(num(after.cost_price)))),
    field('low_stock_threshold', diff('Порог остатка', threshold(before), threshold(after))),
    field('is_active', diff('Продаётся', yesNo(before.is_active !== false), yesNo(after.is_active !== false))),
    field('is_deleted', diff('В архиве', yesNo(before.is_deleted === true), yesNo(after.is_deleted === true))),
  );
  return changed && lines(`✏️ Изменён товар бара: ${name}`, ...changed, by);
}

const stockAdjustment = (row: Row) => rowStockAdjustment({
  adjustmentQuantity: String(row.adjustment_quantity ?? 0),
  adjustmentReason: str(row.adjustment_reason),
});

function adjustmentLabel(adjustment: RowStockAdjustment | null): string {
  if (!adjustment) return '—';
  const amount = `${adjustment.sign > 0 ? '+' : '−'}${units(adjustment.quantity)}`;
  if (adjustment.kind === 'correction') return `${amount} (больше ожидаемого)`;
  if (adjustment.kind === 'other') return amount;
  return `${amount} (${WRITE_OFF_KIND_LABELS[adjustment.kind]})`;
}

interface StockCountMove {
  /**
   * skip: told elsewhere or nothing to tell (a write-off alone, a purchase, an
   * evening's first count over a write-off placeholder); correction: only a
   * correction is news; recount: a saved count changed.
   */
  kind: 'skip' | 'correction' | 'recount';
  was: RowStockAdjustment | null;
  now: RowStockAdjustment | null;
  adjustmentChanged: boolean;
}

/** What one change of a saved stock count means, `changedOn` being the club's business date then. */
function stockCountMove(before: Row, after: Row, changedOn: string): StockCountMove {
  const closingMoved = num(after.closing_stock) - num(before.closing_stock);
  const adjustmentMoved = num(after.adjustment_quantity) - num(before.adjustment_quantity);
  const adjustmentChanged = adjustmentMoved !== 0 || str(before.adjustment_reason) !== str(after.adjustment_reason);
  const addedMoved = num(after.added_today) - num(before.added_today);
  const was = stockAdjustment(before);
  const now = stockAdjustment(after);
  const correction = adjustmentChanged && (was?.kind === 'correction' || now?.kind === 'correction');
  const move = (kind: StockCountMove['kind']): StockCountMove => ({ kind, was, now, adjustmentChanged });

  // A purchase on the open day adds to the count (120): the purchase is the record.
  if (!adjustmentChanged && addedMoved !== 0 && closingMoved === addedMoved) return move('skip');
  // A write-off alone: /api/stock-write-offs tells it.
  if (adjustmentChanged && !correction && (closingMoved === 0 || closingMoved === adjustmentMoved)) return move('skip');
  if (closingMoved === 0 && !adjustmentChanged) return move('skip');
  // A write-off or correction saved before the evening count leaves a row with
  // nothing sold yet; the evening's first count of the open day replaces it.
  const placeholder = was !== null && num(before.sold_quantity) === 0 && str(before.date) === changedOn;
  if (placeholder) return move(correction ? 'correction' : 'skip');
  return move('recount');
}

/**
 * A saved stock count changed: a genuine re-count, or a correction set,
 * changed or removed. Write-offs and purchases have notices of their own.
 */
function stockCountNotice(change: ActivityChange, lookups: ActivityLookups, by: string): string | null {
  if (change.action !== 'update') return null;
  const before = change.before!;
  const after = change.after!;
  const { kind, was, now, adjustmentChanged } = stockCountMove(before, after, change.rows[0].changed_on);
  if (kind === 'skip') return null;
  return lines(
    `✏️ Изменён остаток бара: ${lookups.products.get(str(after.product_id)) || 'Товар'}`,
    details(kind === 'recount' && 'сохранённый подсчёт', noticeDate(str(after.date))),
    kind === 'recount' && diff('Остаток', units(num(before.closing_stock)), units(num(after.closing_stock))),
    adjustmentChanged && `Корректировка: ${adjustmentLabel(was)} → ${adjustmentLabel(now)}`,
    authorLine(by, now?.note || null),
  );
}

function promotionNotice(change: ActivityChange, lookups: ActivityLookups, by: string): string | null {
  const product = (row: Row) => lookups.products.get(str(row.product_id)) || 'товар';
  const period = (row: Row) => (str(row.ends_on)
    ? `${noticeDate(str(row.starts_on))} – ${noticeDate(str(row.ends_on))}`
    : `с ${noticeDate(str(row.starts_on))}`);
  const promotionDetails = (row: Row) => details(
    `${units(num(row.free_quantity))} ${product(row)} бесплатно`,
    `при чеке от ${sum(num(row.min_spend))}`,
    period(row),
  );
  const name = str(current(change).name) || 'Акция';
  if (change.action === 'insert') {
    return lines(`🎁 Новая акция: ${name}`, promotionDetails(change.after!), change.after!.is_active === false && 'Пока выключена', by);
  }
  if (change.action === 'delete') return lines(`🗑 Удалена акция: ${name}`, promotionDetails(change.before!), `Удалил(а) ${by}`);
  const before = change.before!;
  const after = change.after!;
  const changed = changeLines(
    diff('Название', str(before.name), str(after.name)),
    diff('Товар', product(before), product(after)),
    diff('Бесплатно', units(num(before.free_quantity)), units(num(after.free_quantity))),
    diff('Чек от', sum(num(before.min_spend)), sum(num(after.min_spend))),
    diff('Начало', optionalDate(before.starts_on), optionalDate(after.starts_on)),
    diff('Окончание', optionalDate(before.ends_on), optionalDate(after.ends_on)),
  );
  const switched = before.is_active !== after.is_active;
  if (!changed && !switched) return null;
  if (!changed) {
    return lines(after.is_active ? `▶️ Акция включена: ${name}` : `⏸ Акция выключена: ${name}`, promotionDetails(after), by);
  }
  return lines(
    `✏️ Изменена акция: ${name}`,
    ...changed,
    switched && diff('Действует', yesNo(before.is_active === true), yesNo(after.is_active === true)),
    by,
  );
}

const role = (row: Row): UserRole => (['owner', 'admin', 'viewer'].includes(str(row.role)) ? str(row.role) as UserRole : 'viewer');
const sections = (row: Row) => FEATURE_DEFINITIONS
  .filter((feature) => canAccessFeature(role(row), row.feature_access, feature.key))
  .map((feature) => feature.key);
const sectionList = (keys: FeatureKey[]) => (keys.length ? keys.map((key) => FEATURE_LABELS[key]).join(', ') : '—');

/** Team access: who was let in, what they may open, who was removed. */
function membershipNotice(change: ActivityChange, lookups: ActivityLookups, by: string): string | null {
  const userId = str(current(change).user_id) || change.rows[0].row_id || '';
  const person = lookups.people.get(userId) || UNKNOWN_PERSON;
  if (change.action === 'insert') {
    const row = change.after!;
    return lines(
      `👤 Выдан доступ: ${person}`,
      `Роль: ${ROLE_LABELS[role(row)]}`,
      role(row) !== 'owner' && `Разделы: ${sectionList(sections(row))}`,
      by,
    );
  }
  if (change.action === 'delete') {
    return lines(`🚫 Доступ закрыт: ${person}`, `Роль была: ${ROLE_LABELS[role(change.before!)]}`, `Закрыл(а) ${by}`);
  }
  const before = change.before!;
  const after = change.after!;
  const had = sections(before);
  const has = sections(after);
  const opened = has.filter((key) => !had.includes(key));
  const closed = had.filter((key) => !has.includes(key));
  const roleLine = diff('Роль', ROLE_LABELS[role(before)], ROLE_LABELS[role(after)]);
  if (!roleLine && opened.length === 0 && closed.length === 0) return null;
  return lines(
    `🔑 Изменён доступ: ${person}`,
    roleLine,
    opened.length > 0 && `Открыто: ${sectionList(opened)}`,
    closed.length > 0 && `Закрыто: ${sectionList(closed)}`,
    by,
  );
}

function clubNotice(change: ActivityChange, _lookups: ActivityLookups, by: string): string | null {
  if (change.action !== 'update') return null;
  const before = change.before!;
  const after = change.after!;
  const hour = (row: Row) => (row.business_day_start_hour == null ? '—' : `${num(row.business_day_start_hour)}:00`);
  const methods = (row: Row) => (Array.isArray(row.enabled_payment_methods)
    ? orDash(row.enabled_payment_methods.map((item) => method(str(item))).join(', '))
    : 'все');
  const day = (row: Row) => (row.internet_payment_day == null ? '—' : `${num(row.internet_payment_day)}-е число`);
  const changed = changeLines(
    diff('Название', str(before.name), str(after.name)),
    diff('Адрес', orDash(str(before.address)), orDash(str(after.address))),
    diff('Начало рабочего дня', hour(before), hour(after)),
    diff('Способы оплаты', methods(before), methods(after)),
    diff('День оплаты интернета', day(before), day(after)),
  );
  return changed && lines('⚙️ Изменены настройки клуба', ...changed, by);
}

function presetNotice(change: ActivityChange, _lookups: ActivityLookups, by: string): string | null {
  const name = str(current(change).name) || 'Расход';
  const presetMethod = (row: Row) => (str(row.payment_method) ? method(str(row.payment_method)) : 'любая');
  const monthly = (row: Row) => `${sum(num(row.monthly_amount))} в месяц`;
  if (change.action === 'insert') {
    const row = change.after!;
    return lines(
      `🗓 Новый плановый расход: ${name}`,
      details(source(str(row.payment_source)), category(row.category), str(row.payment_method) && method(str(row.payment_method)), monthly(row)),
      by,
    );
  }
  if (change.action !== 'update') return null;
  const before = change.before!;
  const after = change.after!;
  if (!before.archived_at && after.archived_at) return lines(`🗄 Плановый расход в архиве: ${name}`, by);
  if (before.archived_at && !after.archived_at) return lines(`↩️ Плановый расход возвращён из архива: ${name}`, by);
  const changed = changeLines(
    diff('Название', str(before.name), str(after.name)),
    diff('Категория', category(before.category), category(after.category)),
    diff('Источник', source(str(before.payment_source)), source(str(after.payment_source))),
    diff('Оплата', presetMethod(before), presetMethod(after)),
    diff('Сумма', monthly(before), monthly(after)),
  );
  return changed && lines(`✏️ Изменён плановый расход: ${name}`, ...changed, by);
}

/**
 * A salary fine recovering a cash shortage (135), for the owners' group. A
 * recovery saved together with its shortage is told by the shortage notice.
 * Salary employee details and corrected payment methods are kept in the log
 * but never marked for a notice: /api/salaries and PATCH /api/expenses tell them.
 */
function salaryEntryNotice(change: ActivityChange, lookups: ActivityLookups, by: string): string | null {
  if (change.action !== 'insert') return null;
  const fine = change.after!;
  const shortage = lookups.shortages.get(str(fine.cash_shortage_id));
  if (!shortage) return null;
  if (Date.parse(shortage.created_at) === Date.parse(str(fine.created_at))) return null;
  return lines(
    `↩️ Недостача: удержано из зарплаты ${sum(num(fine.amount))}`,
    details(
      lookups.employees.get(str(fine.employee_id)) || 'Сотрудник',
      `недостача ${sum(shortage.amount)} от ${noticeDate(shortage.date)}`,
    ),
    by,
  );
}

const ownerMoneyDetails = (row: Row) => details(source(str(row.source)), str(row.payment_method) && method(str(row.payment_method)), `за ${month(row.period_month)}`);

function withdrawalNotice(change: ActivityChange, _lookups: ActivityLookups, by: string): string | null {
  const row = current(change);
  if (change.action === 'insert' && change.rows.length > 1) {
    const parts = change.rows.map((item) => item.new_row ?? {});
    const total = parts.reduce((amount, part) => amount + num(part.amount), 0);
    const part = (value: Row) => `${str(value.source) === 'bar' || !str(value.payment_method) ? source(str(value.source)) : method(str(value.payment_method))} ${formatCurrency(num(value.amount))}`;
    return lines(
      `💰 Владелец забрал прибыль: ${sum(total)}`,
      details(...parts.map(part), `за ${month(row.period_month)}`),
      authorLine(by, str(row.comment) || null),
    );
  }
  if (change.action === 'insert') {
    return lines(`💰 Владелец забрал прибыль: ${sum(num(row.amount))}`, ownerMoneyDetails(row), authorLine(by, str(row.comment) || null));
  }
  if (change.action === 'delete') {
    return lines(`🗑 Удалено снятие прибыли: ${sum(num(row.amount))}`, ownerMoneyDetails(row), commentLine(str(row.comment) || null), `Удалил(а) ${by}`);
  }
  const before = change.before!;
  const after = change.after!;
  const changed = changeLines(
    diff('Сумма', sum(num(before.amount)), sum(num(after.amount))),
    diff('Источник', source(str(before.source)), source(str(after.source))),
    diff('Оплата', method(str(before.payment_method)), method(str(after.payment_method))),
    diff('Месяц', month(before.period_month), month(after.period_month)),
    diff('Комментарий', orDash(str(before.comment)), orDash(str(after.comment))),
  );
  return changed && lines(`✏️ Изменено снятие прибыли: ${sum(num(after.amount))}`, ownerMoneyDetails(after), ...changed, `Изменил(а) ${by}`);
}

function carryoverNotice(change: ActivityChange, _lookups: ActivityLookups, by: string): string | null {
  const row = current(change);
  const carryDetails = details(
    source(str(row.source)),
    str(row.payment_method) && method(str(row.payment_method)),
    `${month(row.from_month)} → ${month(row.to_month)}`,
  );
  if (change.action === 'insert') {
    return lines(`➡️ Прибыль перенесена на следующий месяц: ${sum(num(row.amount))}`, carryDetails, authorLine(by, str(row.comment) || null));
  }
  if (change.action === 'delete') {
    return lines(`🗑 Удалён перенос прибыли: ${sum(num(row.amount))}`, carryDetails, commentLine(str(row.comment) || null), `Удалил(а) ${by}`);
  }
  const changed = changeLines(diff('Сумма', sum(num(change.before!.amount)), sum(num(row.amount))));
  return changed && lines(`✏️ Изменён перенос прибыли: ${sum(num(row.amount))}`, carryDetails, ...changed, `Изменил(а) ${by}`);
}

function purchaseNotice(change: ActivityChange, lookups: ActivityLookups, by: string): string | null {
  const row = current(change);
  const product = (value: Row) => lookups.products.get(str(value.product_id)) || 'Товар';
  const total = (value: Row) => sum(num(value.quantity) * num(value.cost_price));
  const purchaseDetails = (value: Row) => details(
    product(value),
    `${units(num(value.quantity))} × ${unitSum(num(value.cost_price))}`,
    method(str(value.payment_method)),
    noticeDate(str(value.date)),
  );
  // A sale price given with the purchase becomes the product's price (119).
  const salePrice = (value: Row) => value.sale_price != null && `Новая цена продажи: ${unitSum(num(value.sale_price))}`;
  if (change.action === 'insert') {
    return lines(`📦 Закупка бара: ${total(row)}`, purchaseDetails(row), salePrice(row), authorLine(by, str(row.comment) || null));
  }
  if (change.action === 'delete') {
    return lines(`🗑 Удалена закупка бара: ${total(row)}`, purchaseDetails(row), commentLine(str(row.comment) || null), `Удалил(а) ${by}`);
  }
  const before = change.before!;
  const changed = changeLines(
    diff('Количество', units(num(before.quantity)), units(num(row.quantity))),
    diff('Цена за шт.', unitSum(num(before.cost_price)), unitSum(num(row.cost_price))),
    diff('Оплата', method(str(before.payment_method)), method(str(row.payment_method))),
    diff('Дата', optionalDate(before.date), optionalDate(row.date)),
  );
  return changed && lines(`✏️ Изменена закупка бара: ${total(row)}`, purchaseDetails(row), ...changed, `Изменил(а) ${by}`);
}

function debtNotice(change: ActivityChange, _lookups: ActivityLookups, by: string): string | null {
  if (change.action !== 'insert') return null;
  const row = change.after!;
  return lines(
    `📝 Новый долг: ${sum(num(row.amount))}`,
    details(str(row.person_name), str(row.category), noticeDate(str(row.date))),
    authorLine(by, str(row.comment) || null),
  );
}

function debtPaymentNotice(change: ActivityChange, lookups: ActivityLookups, by: string): string | null {
  if (change.action !== 'insert') return null;
  const row = change.after!;
  return lines(
    `✅ Оплата долга: ${sum(num(row.amount))}`,
    details(lookups.debts.get(str(row.debt_id)), method(str(row.payment_method)), noticeDate(str(row.date))),
    authorLine(by, str(row.comment) || null),
  );
}

/** A collection given back to the till (169): one message for all its methods. */
function collectionNotice(change: ActivityChange, _lookups: ActivityLookups, by: string): string | null {
  if (change.action !== 'delete') return null;
  const parts = change.rows
    .map((row) => row.old_row ?? {})
    .map((row) => [str(row.payment_method), num(row.amount)] as const);
  const first = change.before!;
  return lines(
    `↩️ Сбор денег отменён: ${sum(parts.reduce((total, [, amount]) => total + amount, 0))}`,
    details(...parts.map(([kind, amount]) => `${method(kind)} ${formatCurrency(amount)}`), noticeDate(str(first.date))),
    'Деньги вернулись в кассу',
    commentLine(str(first.comment) || null),
    `Отменил(а) ${by}`,
  );
}

/** Collected money moved into the owner reserve (169); other reserve moves have their own notice. */
function reserveNotice(change: ActivityChange, _lookups: ActivityLookups, by: string): string | null {
  if (change.action !== 'insert' || change.after!.from_collected !== true) return null;
  const row = change.after!;
  return lines(
    `🏦 Собранные деньги в резерв: ${sum(num(row.amount))}`,
    details(method(str(row.payment_method)), noticeDate(str(row.entry_date || row.period_month))),
    authorLine(by, str(row.comment) || null),
  );
}

function shortageNotice(change: ActivityChange, _lookups: ActivityLookups, by: string): string | null {
  if (change.action !== 'delete') return null;
  const row = change.before!;
  return lines(
    `🗑 Удалена недостача: ${sum(num(row.amount))}`,
    details(source(str(row.payment_source)), method(str(row.payment_method)), noticeDate(str(row.date))),
    commentLine(str(row.comment) || null),
    `Удалил(а) ${by}`,
  );
}

const BUILDERS: Readonly<Record<string, { chat: ActivityChat; build: Builder }>> = {
  products: { chat: 'club', build: productNotice },
  daily_stock_counts: { chat: 'club', build: stockCountNotice },
  promotions: { chat: 'club', build: promotionNotice },
  club_memberships: { chat: 'club', build: membershipNotice },
  clubs: { chat: 'club', build: clubNotice },
  expense_presets: { chat: 'club', build: presetNotice },
  salary_entries: { chat: 'owners', build: salaryEntryNotice },
  owner_withdrawals: { chat: 'club', build: withdrawalNotice },
  owner_profit_carryovers: { chat: 'club', build: carryoverNotice },
  stock_purchases: { chat: 'club', build: purchaseNotice },
  new_debts: { chat: 'club', build: debtNotice },
  debt_payments: { chat: 'club', build: debtPaymentNotice },
  money_collections: { chat: 'club', build: collectionNotice },
  owner_reserve_entries: { chat: 'club', build: reserveNotice },
  cash_shortages: { chat: 'owners', build: shortageNotice },
};

/** The author of a change, as the group knows them. */
export function activityAuthor(changedBy: string | null, people: ActivityLookups['people']): string {
  if (!changedBy) return SYSTEM_AUTHOR;
  return people.get(changedBy) || UNKNOWN_PERSON;
}

/** The message for one change, or null when it must not be announced. */
export function buildActivityNotice(change: ActivityChange, lookups: ActivityLookups): ActivityNotice | null {
  const builder = BUILDERS[change.table];
  if (!builder) return null;
  const text = builder.build(change, lookups, activityAuthor(change.changedBy, lookups.people));
  return text ? { chat: builder.chat, text, logIds: change.rows.map((row) => row.id) } : null;
}

/** The messages for claimed log rows, oldest first. */
export function buildActivityNotices(rows: readonly ActivityAuditRow[], lookups: ActivityLookups): ActivityNotice[] {
  return mergeActivityRows(rows)
    .map((item) => buildActivityNotice(item, lookups))
    .filter((notice): notice is ActivityNotice => notice !== null);
}
