'use client';

// Route: /history (owners only)

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChevronRight, History } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSectionTabs } from '@/components/layout/SectionTabs';
import { useClub } from '@/components/layout/DashboardShell';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  InlineAlert,
  LoadErrorAlert,
  MonthPicker,
  PageHeader,
  SegmentedControl,
  Select,
  SkeletonStatus,
} from '@/components/PresentationFoundation';
import { EntryHistoryListSkeleton } from './EntryHistorySkeleton';
import {
  AUDIT_GROUPS,
  auditCurrentRow,
  auditEntryDate,
  auditRecordHref,
  auditRecordSubject,
  auditFieldChanges,
  auditFieldKind,
  auditMoneyUnit,
  auditTablesOfGroup,
  filterAuditLogs,
  type AuditGroup,
  type AuditLogFilter,
} from '@/lib/entryHistory';
import { isKnownExpenseCategory } from '@/lib/expenseCategories';
import { formatCurrency, formatDateOnly, formatDateTime, formatDollars, formatNumber, formatUnitCurrency, formatYearMonth } from '@/lib/formatters';
import { FEATURE_DEFINITIONS } from '@/lib/permissions';
import type { RowStockAdjustment } from '@/lib/stockWriteOffs';
import { fetchEntryHistory, type EntryHistory } from '@/lib/supabase/entryHistory';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { monthRange } from '@/lib/utils';
import type { EntryAuditLog } from '@/types';

const EMPTY_HISTORY: EntryHistory = { logs: [], names: new Map(), products: new Map(), employees: new Map(), missing: false };

const KNOWN_FIELDS = new Set([
  'date', 'period_month', 'from_month', 'to_month', 'amount', 'cash_income', 'terminal_income', 'card_income',
  'playstation_income', 'from_amount', 'to_amount', 'rate', 'cost_price', 'sale_price', 'quantity', 'product_id',
  'payment_method', 'from_method', 'to_method', 'payment_source', 'source', 'category', 'comment', 'person_name',
  'kind', 'collection_date', 'usd_amount', 'usd_rate', 'paid_from_reserve',
  'entry_date', 'paid_from_collected', 'from_collected', 'reason',
  'name', 'low_stock_threshold', 'is_active', 'is_deleted', 'closing_stock', 'adjustment', 'free_quantity', 'min_spend',
  'starts_on', 'ends_on', 'role', 'pages', 'pages_opened', 'pages_closed', 'address', 'business_day_start_hour',
  'enabled_payment_methods', 'internet_payment_day', 'monthly_amount', 'archived_at', 'job_title',
]);
const KNOWN_KINDS = new Set(['deposit', 'return']);
const KNOWN_METHODS = new Set(['cash', 'terminal', 'card', 'playstation', 'usd']);
const KNOWN_SOURCES = new Set(['bar', 'game_club']);
const KNOWN_ROLES = new Set(['owner', 'admin', 'viewer']);
const KNOWN_REASONS = new Set(['stolen', 'short_handover', 'unknown']);
const FEATURE_LABEL_KEYS = new Map<string, string>(FEATURE_DEFINITIONS.map((feature) => [feature.key, feature.labelKey]));

export default function EntryHistoryPage() {
  const sectionTabs = useSectionTabs('team');
  const t = useTranslations('history');
  const te = useTranslations('expenses.categories');
  const tc = useTranslations('common');
  const tTeam = useTranslations('team');
  const tWriteOff = useTranslations('closingStock.writeOffKinds');
  const tShortage = useTranslations('cashShortages.reasons');
  const { locale } = useAppLocale();
  const { selectedClubId, businessDayStartHour } = useClub();
  const today = useBusinessToday(businessDayStartHour);
  const businessMonth = today.slice(0, 7);
  const [month, setMonth] = useState(businessMonth);
  const [filter, setFilter] = useState<AuditLogFilter>({ group: 'all', table: 'all', action: 'all' });

  const load = useCallback(async () => {
    if (!selectedClubId) return EMPTY_HISTORY;
    const { from, to } = monthRange(month);
    return fetchEntryHistory(createClient(), selectedClubId, from, to);
  }, [selectedClubId, month]);
  const query = useClubQuery(load, EMPTY_HISTORY);
  const { logs, names, products, employees, missing } = query.data;
  const visible = useMemo(() => filterAuditLogs(logs, filter), [logs, filter]);
  const groupOptions = useMemo(
    () => (['all', ...AUDIT_GROUPS] as const).map((group) => ({ value: group, label: t(`groups.${group}`) })),
    [t],
  );
  // A record type outside the chosen area would hide every entry, so choosing an area resets it.
  const changeGroup = (group: AuditGroup | 'all') => setFilter((prev) => ({
    ...prev,
    group,
    table: prev.table !== 'all' && auditTablesOfGroup(group).includes(prev.table) ? prev.table : 'all',
  }));

  const pageList = (value: unknown) => {
    if (!Array.isArray(value)) return String(value);
    if (value.length === FEATURE_DEFINITIONS.length) return t('allPages');
    if (value.length === 0) return t('noPages');
    return value.map((key) => {
      const labelKey = FEATURE_LABEL_KEYS.get(String(key));
      return labelKey ? tTeam(`features.${labelKey}`) : String(key);
    }).join(', ');
  };
  const methodLabel = (value: unknown) => (KNOWN_METHODS.has(String(value)) ? t(`methods.${String(value)}`) : String(value));
  const adjustmentLabel = (adjustment: RowStockAdjustment) => {
    const amount = `${adjustment.sign > 0 ? '+' : '\u2212'}${formatNumber(adjustment.quantity)}`;
    const kind = adjustment.kind === 'other' ? adjustment.note || tWriteOff('other') : tWriteOff(adjustment.kind);
    const note = adjustment.kind !== 'other' && adjustment.note ? `: ${adjustment.note}` : '';
    return `${amount} · ${kind}${note}`;
  };

  /**
   * `row` is the row the value came from: it says which side of an exchange is
   * in dollars. `table` picks a field's reading where it differs by table.
   */
  function formatValue(table: string, field: string, value: unknown, row: Record<string, unknown>): string {
    const kind = auditFieldKind(field, table);
    // Every method is allowed until the owner picks some (068).
    if (kind === 'methods' && value == null) return t('allMethods');
    if (value === null || value === undefined || value === '') return '—';
    const text = String(value);
    switch (kind) {
      case 'money': return Number.isFinite(Number(value)) ? `${formatCurrency(Number(value))} ${tc('currency')}` : text;
      case 'unitMoney':
        if (!Number.isFinite(Number(value))) return text;
        return auditMoneyUnit(field, row) === 'usd' ? formatDollars(Number(value)) : `${formatUnitCurrency(Number(value))} ${tc('currency')}`;
      case 'quantity': return Number.isFinite(Number(value)) ? formatNumber(Number(value)) : text;
      case 'date': return formatDateOnly(text.slice(0, 10), locale);
      case 'dateTime': return formatDateTime(text, locale);
      case 'month': return formatYearMonth(text.slice(0, 7), locale);
      case 'method': return methodLabel(value);
      case 'methods': return Array.isArray(value) ? (value.length ? value.map(methodLabel).join(', ') : '—') : text;
      case 'source': return KNOWN_SOURCES.has(text) ? t(`sources.${text}`) : text;
      case 'category': return isKnownExpenseCategory(text) || text === 'other' ? te(text) : text;
      case 'product': return products.get(text) ?? t('unknownProduct');
      case 'entryKind': return KNOWN_KINDS.has(text) ? t(`kinds.${text}`) : text;
      case 'yesNo': return value === true || text === 'true' ? t('yes') : t('no');
      case 'role': return KNOWN_ROLES.has(text) ? tTeam(`roles.${text}`) : text;
      case 'pages': return pageList(value);
      case 'hour': return Number.isFinite(Number(value)) ? `${String(Number(value)).padStart(2, '0')}:00` : text;
      case 'dayOfMonth': return Number.isFinite(Number(value)) ? t('dayOfMonth', { day: Number(value) }) : text;
      case 'stockAdjustment': return typeof value === 'object' ? adjustmentLabel(value as RowStockAdjustment) : text;
      case 'shortageReason': return KNOWN_REASONS.has(text) ? tShortage(text) : text;
      default: return text;
    }
  }

  const fieldLabel = (field: string) => (KNOWN_FIELDS.has(field) ? t(`fields.${field}`) : field);
  const personName = (id: unknown) => (typeof id === 'string' ? names.get(id) ?? t('removedUser') : t('system'));
  const subjectName = (log: EntryAuditLog) => {
    const subject = auditRecordSubject(log);
    if (!subject) return null;
    switch (subject.kind) {
      case 'text': return subject.value;
      case 'product': return products.get(subject.id) ?? t('unknownProduct');
      case 'person': return names.get(subject.id) || t('removedUser');
      case 'employee': return employees.get(subject.id) ?? t('removedEmployee');
    }
  };

  const ACTION_BADGES = {
    insert: { variant: 'success', label: t('created') },
    update: { variant: 'warning', label: t('edited') },
    delete: { variant: 'danger', label: t('deleted') },
  } as const;

  function renderLog(log: EntryAuditLog) {
    const changes = auditFieldChanges(log);
    const row = auditCurrentRow(log);
    const entryDate = auditEntryDate(row);
    const author = row.created_by;
    const recordHref = auditRecordHref(log.table_name, entryDate, row);
    const subject = subjectName(log);
    const badge = ACTION_BADGES[log.action];
    const value = (field: string, item: unknown, from: Record<string, unknown> | null) => formatValue(log.table_name, field, item, from ?? row);
    return (
      <Card as="li" key={log.id} padding="sm" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
          <span className="font-semibold text-gray-900">{t(`tables.${log.table_name}`)}</span>
          {subject ? <span className="min-w-0 break-words text-sm text-gray-700">· {subject}</span> : null}
          {entryDate ? <span className="text-sm text-gray-500">· {formatDateOnly(entryDate, locale)}</span> : null}
          {recordHref ? (
            <Link href={recordHref} className="ml-auto inline-flex items-center gap-0.5 text-sm font-medium text-primary-700 hover:underline">
              {t('openRecord')}
              <ChevronRight size={14} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-gray-600">
          {t('changedBy', { name: personName(log.changed_by), time: formatDateTime(log.changed_at, locale) })}
          {typeof author === 'string' && author !== log.changed_by ? ` · ${t('enteredBy', { name: personName(author) })}` : null}
        </p>
        {changes.length > 0 ? (
          <dl className="divide-y divide-gray-100 rounded-lg bg-gray-50 px-3 text-sm">
            {changes.map((change) => (
              <div key={change.field} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <dt className="text-gray-500">{fieldLabel(change.field)}</dt>
                <dd className="break-words text-gray-900 sm:text-right">
                  {change.after === undefined ? (
                    value(change.field, change.before, log.old_row)
                  ) : change.before === undefined ? (
                    value(change.field, change.after, log.new_row)
                  ) : (
                    <>
                      <span className="text-gray-500 line-through">{value(change.field, change.before, log.old_row)}</span>
                      <span aria-hidden="true" className="mx-1.5 text-gray-400">→</span>
                      <span className="sr-only">{t('changedTo')}</span>
                      <span className="font-semibold">{value(change.field, change.after, log.new_row)}</span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        tabs={sectionTabs}
        className="mb-0"
        action={<MonthPicker value={month} max={businessMonth} onChange={setMonth} className="sm:w-56" />}
      />

      <div className="space-y-3">
        <SegmentedControl variant="chips" label={t('filterGroup')} options={groupOptions} value={filter.group} onChange={changeGroup} />
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <Field label={t('filterTable')} htmlFor="history-table">
            <Select
              id="history-table"
              value={filter.table}
              onChange={(event) => setFilter((prev) => ({ ...prev, table: event.target.value as AuditLogFilter['table'] }))}
            >
              <option value="all">{t('allTables')}</option>
              {auditTablesOfGroup(filter.group).map((table) => <option key={table} value={table}>{t(`tables.${table}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('filterAction')} htmlFor="history-action">
            <Select
              id="history-action"
              value={filter.action}
              onChange={(event) => setFilter((prev) => ({ ...prev, action: event.target.value as AuditLogFilter['action'] }))}
            >
              <option value="all">{t('allActions')}</option>
              <option value="insert">{t('created')}</option>
              <option value="update">{t('edited')}</option>
              <option value="delete">{t('deleted')}</option>
            </Select>
          </Field>
        </div>
      </div>

      {query.error ? (
        <LoadErrorAlert onRetry={() => void query.reload()} retrying={query.loading}>{t('loadError')}</LoadErrorAlert>
      ) : query.loading ? (
        <SkeletonStatus><EntryHistoryListSkeleton /></SkeletonStatus>
      ) : missing ? (
        <InlineAlert variant="warning">{t('notInstalled')}</InlineAlert>
      ) : visible.length === 0 ? (
        <EmptyState icon={History} title={t('emptyTitle')} description={t('emptyDescription')} bordered />
      ) : (
        <ul className="space-y-3" aria-label={t('title')}>{visible.map(renderLog)}</ul>
      )}
    </div>
  );
}
