'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import {
  Badge,
  type BadgeVariant,
  Button,
  Card,
  DataTable,
  EmptyState,
  Money,
  SectionHeading,
  TableSkeleton,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { buildSalaryCalendar, shiftYearMonth } from '@/lib/calculations/salaryCalendar';
import { canDeleteSalaryRate, type SalaryEmployee, type SalaryEntry, type SalaryMonth, type SalaryRate } from '@/lib/calculations/salaries';
import { formatCurrency, formatDateOnly, formatDateTime, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { SalaryCalendar } from './SalaryCalendar';
import { useSalaryText, type DeletionTarget } from './shared';

const ENTRY_BADGE: Record<SalaryEntry['kind'], BadgeVariant> = { payment: 'info', bonus: 'success', fine: 'danger' };

export interface HistoryViewProps {
  /** Requested employee id from the route; without it the history covers the whole club. */
  employeeId?: string;
  historyEmployee: SalaryEmployee | undefined;
  employees: SalaryEmployee[];
  rates: SalaryRate[];
  entries: SalaryEntry[];
  months: SalaryMonth[];
  loading: boolean;
  loadError: boolean;
  canEdit: boolean;
  isOwner: boolean;
  saving: boolean;
  /** The club's business date; the calendar opens on its month. */
  today: string;
  onDelete: (target: DeletionTarget) => void;
}

/** Monthly breakdown, transactions and rate history for one employee or the whole club. */
export function HistoryView({
  employeeId, historyEmployee, employees, rates, entries, months, loading, loadError, canEdit, isOwner, saving, today, onDelete,
}: HistoryViewProps) {
  const t = useTranslations('salaries');
  const tc = useTranslations('common');
  const tp = useTranslations('expenses');
  const { locale } = useAppLocale();
  const { kpiSummary, currency } = useSalaryText();
  const [calendarMonth, setCalendarMonth] = useState(() => today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState('');
  const historyEntries = useMemo(() => entries.filter((e) => !historyEmployee || e.employee_id === historyEmployee.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)), [entries, historyEmployee]);
  const calendarDays = useMemo(() => buildSalaryCalendar(calendarMonth, historyEntries, today), [calendarMonth, historyEntries, today]);

  if (loading) return <TableSkeleton rows={6} columns={7} />;
  if (employeeId && !loadError && !historyEmployee) return <Card><EmptyState icon={Users} title={t('employeeNotFound')} /></Card>;
  if (!historyEmployee && (employeeId || loadError)) return null;

  const visibleEntries = historyEntries.filter((e) => (selectedDate ? e.date === selectedDate : e.date.startsWith(calendarMonth)));
  const historyRates = rates.filter((r) => !historyEmployee || r.employee_id === historyEmployee.id)
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  // In the club-wide history each row names its employee.
  const employeePrefix = (id: string) => (historyEmployee ? '' : `${employees.find((e) => e.id === id)?.name ?? ''} · `);

  return (
    <Card as="section" padding="lg">
      <div className="space-y-6">
        <div>
          <SectionHeading size="sm" title={t('monthlyBreakdown')} description={t('estimateHelp')} className="mb-3" />
          <DataTable
            bare
            dense
            minWidth={640}
            keyExtractor={(month) => month.month}
            data={[...months].reverse()}
            columns={[
              { key: 'month', header: t('month'), render: (month) => formatYearMonth(month.month, locale) },
              { key: 'base', header: t('base'), align: 'right', render: (month) => formatCurrency(month.base) },
              { key: 'kpi', header: t('kpi'), align: 'right', render: (month) => formatCurrency(month.kpi) },
              { key: 'bonus', header: t('bonus'), align: 'right', render: (month) => formatCurrency(month.bonus) },
              { key: 'fine', header: t('fine'), align: 'right', render: (month) => formatCurrency(month.fine) },
              { key: 'payment', header: t('payment'), align: 'right', render: (month) => formatCurrency(month.paid) },
              { key: 'balance', header: t('balance'), align: 'right', render: (month) => <Money amount={month.balance} currency={null} signed className="font-semibold" /> },
            ]}
          />
        </div>
        <div>
          <SalaryCalendar
            month={calendarMonth}
            days={calendarDays}
            selectedDate={selectedDate}
            onMonthChange={(delta) => { setCalendarMonth((month) => shiftYearMonth(month, delta)); setSelectedDate(''); }}
            onSelectDate={setSelectedDate}
          />
        </div>
        <div>
          <SectionHeading
            size="sm"
            title={t('transactions')}
            description={selectedDate ? formatDateOnly(selectedDate, locale) : formatYearMonth(calendarMonth, locale)}
            action={selectedDate ? <Button variant="secondary" size="sm" onClick={() => setSelectedDate('')}>{t('calendarWholeMonth')}</Button> : undefined}
            className="mb-3"
          />
          <div className="space-y-2">
            {visibleEntries.map((entry) => (
              <div key={entry.id} className={cn('flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm', entry.deleted_at && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={ENTRY_BADGE[entry.kind]} size="sm">{t(entry.kind)}</Badge>
                    <span className="font-semibold text-gray-900">{employeePrefix(entry.employee_id)}{formatDateOnly(entry.date, locale)}</span>
                  </div>
                  {entry.payment_method && <p className="mt-1 text-xs text-gray-500">{tc(`paymentMethods.${entry.payment_method}`)} · {tp(`paymentSources.${entry.payment_source}`)}</p>}
                  {entry.comment && <p className="mt-1.5 whitespace-pre-line break-words text-gray-600">{entry.comment}</p>}
                  {entry.delete_reason && <p className="mt-1 break-words text-xs text-gray-500">{t('deleteReason')}: {entry.delete_reason}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <strong className={cn('whitespace-nowrap tabular-nums', entry.kind === 'bonus' ? 'text-success-600' : entry.kind === 'fine' ? 'text-danger-600' : 'text-gray-900')}>{entry.kind === 'bonus' ? '+' : '−'}{currency(Number(entry.amount))}</strong>
                  {entry.deleted_at ? (
                    <Badge variant="neutral" size="sm">{t('deleted')} · {formatDateTime(entry.deleted_at, locale)}</Badge>
                  ) : canEdit && (
                    <Button variant="dangerOutline" size="sm" disabled={saving} onClick={() => onDelete({ id: entry.id, employeeId: entry.employee_id, kind: 'entry', label: `${employeePrefix(entry.employee_id)}${t(entry.kind)} · ${formatDateOnly(entry.date, locale)} · ${currency(Number(entry.amount))}` })}>
                      {t('delete')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {visibleEntries.length === 0 && <EmptyState compact bordered title={t('noTransactions')} />}
          </div>
        </div>
        <div>
          <SectionHeading size="sm" title={t('rateHistory')} className="mb-3" />
          {historyRates.length === 0 && <EmptyState compact bordered title={t('noRates')} />}
          <div className="space-y-2">
            {historyRates.map((rate) => {
              const deletable = canDeleteSalaryRate(rates, rate);
              return (
                <div className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm" key={rate.id}>
                  <div className={cn('min-w-0 flex-1', rate.deleted_at && 'opacity-60')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('font-semibold text-gray-900', rate.deleted_at && 'line-through')}>{employeePrefix(rate.employee_id)}{formatDateOnly(rate.effective_date, locale)}</span>
                      <Badge variant={rate.active ? 'success' : 'neutral'} size="sm">{t(rate.active ? 'active' : 'inactive')}</Badge>
                    </div>
                    <p className="mt-1 text-gray-600">
                      {t(rate.salary_type)} · <span className="tabular-nums">{currency(Number(rate.amount))}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">{t('kpi')}: {Number(rate.kpi_percent)}% ({kpiSummary(rate)})</p>
                    {rate.delete_reason && <p className="mt-1 break-words text-xs text-gray-500">{t('deleteReason')}: {rate.delete_reason}</p>}
                    {!rate.deleted_at && isOwner && !deletable && <p className="mt-1.5 text-xs text-gray-400">{t('lastRateHelp')}</p>}
                  </div>
                  {rate.deleted_at ? (
                    <Badge variant="neutral" size="sm" className="shrink-0">{t('deleted')} · {formatDateTime(rate.deleted_at, locale)}</Badge>
                  ) : isOwner && deletable && (
                    <Button
                      variant="dangerOutline"
                      size="sm"
                      className="shrink-0"
                      disabled={saving}
                      onClick={() => onDelete({ id: rate.id, employeeId: rate.employee_id, kind: 'rate', label: `${employeePrefix(rate.employee_id)}${formatDateOnly(rate.effective_date, locale)} · ${currency(Number(rate.amount))} · ${Number(rate.kpi_percent)}%` })}
                    >
                      {t('delete')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
