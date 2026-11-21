'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Trash2, Users } from 'lucide-react';
import {
  Badge,
  type BadgeVariant,
  Button,
  Card,
  DataTable,
  EmptyState,
  IconButton,
  Money,
  SectionHeading,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { buildSalaryCalendar, shiftYearMonth } from '@/lib/calculations/salaryCalendar';
import { absentDates, canDeleteSalaryRate, dailyBasePay, rateInForce, type SalaryEmployee, type SalaryEntry, type SalaryMonth, type SalaryRate } from '@/lib/calculations/salaries';
import { formatCurrency, formatDateOnly, formatDateTime, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { dayRange, employeeSalaryHref, reportsHref } from '@/lib/detailLinks';
import { formatPercentShare } from '@/components/charts/chartFormat';
import { SalaryCalendar } from './SalaryCalendar';
import { SalaryHistoryBodySkeleton } from './SalariesSkeleton';
import { useSalaryText, type DeletionTarget, type HistoryKindFilter } from './shared';
import { scrollBehavior } from '@/lib/scroll';

const ENTRY_BADGE: Record<SalaryEntry['kind'], BadgeVariant> = { payment: 'warning', bonus: 'info', fine: 'danger', absence: 'neutral' };

export interface HistoryViewProps {
  /** Requested employee id from the route; without it the history covers the whole club. */
  employeeId?: string;
  historyEmployee: SalaryEmployee | undefined;
  employees: SalaryEmployee[];
  rates: SalaryRate[];
  entries: SalaryEntry[];
  /** Who deleted each deleted rate or entry, by user id. */
  deleterNames: Record<string, string>;
  months: SalaryMonth[];
  balances: Record<string, SalaryMonth[]>;
  loading: boolean;
  loadError: boolean;
  /** Only the owner deletes payments, bonuses, fines and rates (migration 113). */
  isOwner: boolean;
  saving: boolean;
  /** The club's business date; the calendar opens on its month. */
  today: string;
  /** Narrows the transactions to one kind of entry (a headline card that is switched on). */
  kindFilter?: HistoryKindFilter | null;
  onDelete: (target: DeletionTarget) => void;
}

/** Monthly breakdown, transactions and rate history for one employee or the whole club. */
export function HistoryView({
  employeeId, historyEmployee, employees, rates, entries, deleterNames, months, balances, loading, loadError, isOwner, saving, today, kindFilter = null, onDelete,
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
  const staff = useMemo(() => (historyEmployee ? [historyEmployee] : employees), [historyEmployee, employees]);
  // Each day's base pay, summed over the club in the club-wide history; a raise shows from its effective date.
  const calendarDays = useMemo(() => {
    const absent = new Map(staff.map((employee) => [employee.id, absentDates(entries, employee.id)]));
    const earnedOn = (date: string) => staff.reduce((sum, employee) => sum + (dailyBasePay(employee, rates, date, absent.get(employee.id)) ?? 0), 0);
    const kpiByDay = Object.assign({}, ...months.map((month) => month.kpiByDay));
    return buildSalaryCalendar(calendarMonth, historyEntries, today, earnedOn, kpiByDay);
  }, [calendarMonth, historyEntries, entries, today, staff, rates, months]);

  if (loading) return <SalaryHistoryBodySkeleton />;
  if (employeeId && !loadError && !historyEmployee) return <Card><EmptyState icon={Users} title={t('employeeNotFound')} /></Card>;
  if (!historyEmployee && (employeeId || loadError)) return null;

  const visibleEntries = historyEntries.filter((e) => (selectedDate ? e.date === selectedDate : e.date.startsWith(calendarMonth)) && (!kindFilter || e.kind === kindFilter));
  /** A KPI rate as a percentage, keeping its fraction (2.5%). */
  const percent = (value: number | string) => formatPercentShare(Number(value) / 100, locale, 2);
  // KPI is earned, not recorded: it has no rows once the list is narrowed to a kind of entry.
  const kpiRows = kindFilter ? [] : staff.flatMap((employee) => {
    const month = balances[employee.id]?.find((row) => row.month === calendarMonth);
    const amount = selectedDate ? month?.kpiByDay[selectedDate] : month?.kpi;
    return amount ? [{ employeeId: employee.id, amount, rate: selectedDate ? rateInForce(rates, employee.id, selectedDate) : undefined }] : [];
  });
  const historyRates = rates.filter((r) => !historyEmployee || r.employee_id === historyEmployee.id)
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  // In the club-wide history each row names its employee.
  const employeePrefix = (id: string) => (historyEmployee ? '' : `${employees.find((e) => e.id === id)?.name ?? ''} · `);
  /** On the all-staff history the name opens that employee's own history. */
  const employeeLink = (id: string) => (historyEmployee ? null : (
    <>
      <Link href={employeeSalaryHref(id)} className="hover:underline">{employees.find((e) => e.id === id)?.name ?? ''}</Link>
      {' · '}
    </>
  ));
  const deleterName = (id?: string | null) => (id ? deleterNames[id] : undefined);

  return (
    <Card as="section" padding="lg">
      <div className="space-y-6">
        {/* The calendar with the rate changes beside it on wide screens, below it on narrow ones. */}
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <SalaryCalendar
              month={calendarMonth}
              days={calendarDays}
              selectedDate={selectedDate}
              maxMonth={today.slice(0, 7)}
              onMonthChange={(delta) => { setCalendarMonth((month) => shiftYearMonth(month, delta)); setSelectedDate(''); }}
              onSelectDate={setSelectedDate}
            />
          </div>
          <aside className="min-w-0 2xl:border-l 2xl:border-gray-200 2xl:pl-6">
            <SectionHeading size="sm" title={t('rateHistory')} className="mb-3" />
            {historyRates.length === 0 && <EmptyState compact bordered title={t('noRates')} />}
            <div className="space-y-2">
              {historyRates.map((rate) => {
                const deletable = canDeleteSalaryRate(rates, rate);
                return (
                  <div className="flex flex-wrap items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm" key={rate.id}>
                    <div className={cn('min-w-0 flex-1', rate.deleted_at && 'opacity-60')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('font-semibold text-gray-900', rate.deleted_at && 'line-through')}>{employeePrefix(rate.employee_id)}{formatDateOnly(rate.effective_date, locale)}</span>
                        <Badge variant={rate.active ? 'success' : 'neutral'} size="sm">{t(rate.active ? 'active' : 'inactive')}</Badge>
                      </div>
                      <p className="mt-1 text-gray-600">
                        {t(rate.salary_type)} · <span className="tabular-nums">{currency(Number(rate.amount))}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">{t('kpi')}: {percent(rate.kpi_percent)} ({kpiSummary(rate)})</p>
                      {rate.delete_reason && <p className="mt-1 break-words text-xs text-gray-500">{t('deleteReason')}: {rate.delete_reason}</p>}
                      {deleterName(rate.deleted_by) && <p className="mt-0.5 break-words text-xs text-gray-500">{t('deletedBy')}: {deleterName(rate.deleted_by)}</p>}
                      {!rate.deleted_at && isOwner && !deletable && <p className="mt-1.5 text-xs text-gray-500">{t('lastRateHelp')}</p>}
                    </div>
                    {rate.deleted_at ? (
                      <Badge variant="neutral" size="sm" className="shrink-0">{t('deleted')} · {formatDateTime(rate.deleted_at, locale)}</Badge>
                    ) : isOwner && deletable && (
                      <IconButton
                        variant="danger"
                        size="sm"
                        className="shrink-0"
                        label={`${t('delete')}: ${employeePrefix(rate.employee_id)}${formatDateOnly(rate.effective_date, locale)}`}
                        icon={<Trash2 size={16} aria-hidden="true" />}
                        disabled={saving}
                        onClick={() => onDelete({ id: rate.id, employeeId: rate.employee_id, kind: 'rate', label: `${employeePrefix(rate.employee_id)}${formatDateOnly(rate.effective_date, locale)} · ${currency(Number(rate.amount))} · ${percent(rate.kpi_percent)}` })}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
        <div id="salary-transactions">
          <SectionHeading
            size="sm"
            title={t('transactions')}
            description={selectedDate ? formatDateOnly(selectedDate, locale) : formatYearMonth(calendarMonth, locale)}
            badge={kindFilter ? <Badge variant={ENTRY_BADGE[kindFilter]} size="sm">{t(kindFilter)}</Badge> : undefined}
            action={selectedDate ? <Button variant="secondary" size="sm" onClick={() => setSelectedDate('')}>{t('calendarWholeMonth')}</Button> : undefined}
            className="mb-3"
          />
          <div className="space-y-2">
            {kpiRows.map(({ employeeId: id, amount, rate }) => (
              <div key={`kpi-${id}`} className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success" size="sm">{t('kpi')}</Badge>
                    <span className="font-semibold text-gray-900">{employeeLink(id)}{selectedDate ? formatDateOnly(selectedDate, locale) : formatYearMonth(calendarMonth, locale)}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{t(selectedDate ? 'calendarKpiDay' : 'calendarKpiMonth')}{rate ? ` · ${percent(rate.kpi_percent)} (${kpiSummary(rate)})` : ''}</p>
                </div>
                <strong className="shrink-0 whitespace-nowrap tabular-nums text-success-700">+{currency(amount)}</strong>
              </div>
            ))}
            {visibleEntries.map((entry) => (
              <div key={entry.id} className={cn('flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm', entry.deleted_at && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={ENTRY_BADGE[entry.kind]} size="sm">{t(entry.kind)}</Badge>
                    <span className="font-semibold text-gray-900">{employeeLink(entry.employee_id)}{formatDateOnly(entry.date, locale)}</span>
                  </div>
                  {entry.payment_method && (
                    <p className="mt-1 text-xs text-gray-500">
                      {tc(`paymentMethods.${entry.payment_method}`)} · {tp(`paymentSources.${entry.payment_source}`)}
                      {entry.kind === 'payment' && !entry.deleted_at && (
                        <>
                          {' · '}
                          <Link
                            href={reportsHref(dayRange(entry.date), { category: 'expense:salary', source: entry.payment_source === 'bar' ? 'bar' : 'game_club' })}
                            className="font-medium text-primary-700 hover:underline"
                          >
                            {t('openInReports')}
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                  {entry.comment && <p className="mt-1.5 whitespace-pre-line break-words text-gray-600">{entry.comment}</p>}
                  {entry.delete_reason && <p className="mt-1 break-words text-xs text-gray-500">{t('deleteReason')}: {entry.delete_reason}</p>}
                  {deleterName(entry.deleted_by) && <p className="mt-0.5 break-words text-xs text-gray-500">{t('deletedBy')}: {deleterName(entry.deleted_by)}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <strong className={cn('whitespace-nowrap tabular-nums', entry.kind === 'bonus' ? 'text-primary-700' : entry.kind === 'fine' ? 'text-danger-600' : 'text-gray-900')}>{entry.kind === 'absence' ? t('absenceNoPay') : `${entry.kind === 'bonus' ? '+' : '−'}${currency(Number(entry.amount))}`}</strong>
                  {entry.deleted_at ? (
                    <Badge variant="neutral" size="sm">{t('deleted')} · {formatDateTime(entry.deleted_at, locale)}</Badge>
                  ) : isOwner && (
                    <IconButton
                      variant="danger"
                      size="sm"
                      label={`${t('delete')}: ${employeePrefix(entry.employee_id)}${t(entry.kind)} · ${formatDateOnly(entry.date, locale)}`}
                      icon={<Trash2 size={16} aria-hidden="true" />}
                      disabled={saving}
                      onClick={() => onDelete({ id: entry.id, employeeId: entry.employee_id, kind: 'entry', label: `${employeePrefix(entry.employee_id)}${t(entry.kind)} · ${formatDateOnly(entry.date, locale)}${entry.kind === 'absence' ? '' : ` · ${currency(Number(entry.amount))}`}` })}
                    />
                  )}
                </div>
              </div>
            ))}
            {visibleEntries.length === 0 && kpiRows.length === 0 && <EmptyState compact bordered title={t('noTransactions')} />}
          </div>
        </div>
        <div>
          <SectionHeading size="sm" title={t('monthlyBreakdown')} description={t('estimateHelp')} className="mb-3" />
          <DataTable
            mobileCards
            bare
            dense
            label={t('monthlyBreakdown')}
            minWidth={640}
            keyExtractor={(month) => month.month}
            onRowClick={(month) => {
              setCalendarMonth(month.month);
              setSelectedDate('');
              document.getElementById('salary-transactions')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
            }}
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
      </div>
    </Card>
  );
}
