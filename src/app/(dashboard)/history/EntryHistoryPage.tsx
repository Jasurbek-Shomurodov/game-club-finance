'use client';

// Route: /history (owners only)

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { History } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  Badge,
  Card,
  DetailListSkeleton,
  EmptyState,
  Field,
  InlineAlert,
  LoadErrorAlert,
  MonthPicker,
  PageHeader,
  Select,
} from '@/components/PresentationFoundation';
import {
  AUDITED_TABLES,
  auditEntryDate,
  auditFieldChanges,
  auditFieldKind,
  filterAuditLogs,
  type AuditLogFilter,
} from '@/lib/entryHistory';
import { isKnownExpenseCategory } from '@/lib/expenseCategories';
import { formatCurrency, formatDateOnly, formatDateTime, formatNumber, formatYearMonth } from '@/lib/formatters';
import { fetchEntryHistory, type EntryHistory } from '@/lib/supabase/entryHistory';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { monthRange } from '@/lib/utils';
import type { EntryAuditLog } from '@/types';

const EMPTY_HISTORY: EntryHistory = { logs: [], names: new Map(), products: new Map(), missing: false };

const KNOWN_FIELDS = new Set([
  'date', 'period_month', 'from_month', 'to_month', 'amount', 'cash_income', 'terminal_income', 'card_income',
  'playstation_income', 'from_amount', 'to_amount', 'rate', 'cost_price', 'sale_price', 'quantity', 'product_id',
  'payment_method', 'from_method', 'to_method', 'payment_source', 'source', 'category', 'comment', 'person_name',
]);
const KNOWN_METHODS = new Set(['cash', 'terminal', 'card', 'playstation', 'usd']);
const KNOWN_SOURCES = new Set(['bar', 'game_club']);

export default function EntryHistoryPage() {
  const t = useTranslations('history');
  const te = useTranslations('expenses.categories');
  const { locale } = useAppLocale();
  const { selectedClubId, businessDayStartHour } = useClub();
  const today = useBusinessToday(businessDayStartHour);
  const businessMonth = today.slice(0, 7);
  const [month, setMonth] = useState(businessMonth);
  const [filter, setFilter] = useState<AuditLogFilter>({ table: 'all', action: 'all' });

  const load = useCallback(async () => {
    if (!selectedClubId) return EMPTY_HISTORY;
    const { from, to } = monthRange(month);
    return fetchEntryHistory(createClient(), selectedClubId, from, to);
  }, [selectedClubId, month]);
  const query = useClubQuery(load, EMPTY_HISTORY);
  const { logs, names, products, missing } = query.data;
  const visible = useMemo(() => filterAuditLogs(logs, filter), [logs, filter]);

  function formatValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    const text = String(value);
    switch (auditFieldKind(field)) {
      case 'money': return Number.isFinite(Number(value)) ? formatCurrency(Number(value)) : text;
      case 'quantity': return Number.isFinite(Number(value)) ? formatNumber(Number(value)) : text;
      case 'date': return formatDateOnly(text.slice(0, 10), locale);
      case 'month': return formatYearMonth(text.slice(0, 7), locale);
      case 'method': return KNOWN_METHODS.has(text) ? t(`methods.${text}`) : text;
      case 'source': return KNOWN_SOURCES.has(text) ? t(`sources.${text}`) : text;
      case 'category': return isKnownExpenseCategory(text) || text === 'other' ? te(text) : text;
      case 'product': return products.get(text) ?? t('unknownProduct');
      default: return text;
    }
  }

  const fieldLabel = (field: string) => (KNOWN_FIELDS.has(field) ? t(`fields.${field}`) : field);
  const personName = (id: unknown) => (typeof id === 'string' ? names.get(id) ?? t('removedUser') : t('system'));

  function renderLog(log: EntryAuditLog) {
    const changes = auditFieldChanges(log);
    const entryDate = auditEntryDate(log.old_row);
    const author = log.old_row.created_by;
    return (
      <Card as="li" key={log.id} padding="sm" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={log.action === 'delete' ? 'danger' : 'warning'} size="sm">
            {t(log.action === 'delete' ? 'deleted' : 'edited')}
          </Badge>
          <span className="font-semibold text-gray-900">{t(`tables.${log.table_name}`)}</span>
          {entryDate ? <span className="text-sm text-gray-500">· {formatDateOnly(entryDate, locale)}</span> : null}
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
                  {log.action === 'delete' ? (
                    formatValue(change.field, change.before)
                  ) : (
                    <>
                      <span className="text-gray-500 line-through">{formatValue(change.field, change.before)}</span>
                      <span aria-hidden="true" className="mx-1.5 text-gray-400">→</span>
                      <span className="sr-only">{t('changedTo')}</span>
                      <span className="font-semibold">{formatValue(change.field, change.after)}</span>
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
        className="mb-0"
        action={<MonthPicker value={month} max={businessMonth} onChange={setMonth} className="sm:w-56" />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Field label={t('filterTable')} htmlFor="history-table">
          <Select
            id="history-table"
            value={filter.table}
            onChange={(event) => setFilter((prev) => ({ ...prev, table: event.target.value as AuditLogFilter['table'] }))}
          >
            <option value="all">{t('allTables')}</option>
            {AUDITED_TABLES.map((table) => <option key={table} value={table}>{t(`tables.${table}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('filterAction')} htmlFor="history-action">
          <Select
            id="history-action"
            value={filter.action}
            onChange={(event) => setFilter((prev) => ({ ...prev, action: event.target.value as AuditLogFilter['action'] }))}
          >
            <option value="all">{t('allActions')}</option>
            <option value="update">{t('edited')}</option>
            <option value="delete">{t('deleted')}</option>
          </Select>
        </Field>
      </div>

      {query.error ? (
        <LoadErrorAlert onRetry={() => void query.reload()} retrying={query.loading}>{t('loadError')}</LoadErrorAlert>
      ) : query.loading ? (
        <DetailListSkeleton rows={4} />
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
