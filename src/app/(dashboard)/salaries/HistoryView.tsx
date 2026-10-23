'use client';

import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Money,
  SectionHeading,
  TableSkeleton,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { canDeleteSalaryRate, type SalaryEmployee, type SalaryEntry, type SalaryMonth, type SalaryRate } from '@/lib/calculations/salaries';
import { formatCurrency, formatDateOnly, formatDateTime, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { useSalaryText, type DeletionTarget } from './shared';

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
  onDelete: (target: DeletionTarget) => void;
}

/** Monthly breakdown, transactions and rate history for one employee or the whole club. */
export function HistoryView({
  employeeId, historyEmployee, employees, rates, entries, months, loading, loadError, canEdit, isOwner, saving, onDelete,
}: HistoryViewProps) {
  const t = useTranslations('salaries');
  const tc = useTranslations('common');
  const tp = useTranslations('expenses');
  const { locale } = useAppLocale();
  const { kpiSummary, currency } = useSalaryText();

  if (loading) return <TableSkeleton rows={6} columns={7} />;
  if (employeeId && !loadError && !historyEmployee) return <Card><EmptyState icon={Users} title={t('employeeNotFound')} /></Card>;
  if (!historyEmployee && (employeeId || loadError)) return null;

  const historyEntries = entries.filter((e) => !historyEmployee || e.employee_id === historyEmployee.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
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
          <SectionHeading size="sm" title={t('transactions')} className="mb-3" />
          <div className="space-y-2">
            {historyEntries.map((entry) => (
              <div key={entry.id} className={`flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 p-3 text-sm ${entry.deleted_at ? 'opacity-60' : ''}`}>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{employeePrefix(entry.employee_id)}{t(entry.kind)} · {formatDateOnly(entry.date, locale)}</p>
                  {entry.payment_method && <p className="mt-1 text-xs text-gray-500">{tc(`paymentMethods.${entry.payment_method}`)} · {tp(`paymentSources.${entry.payment_source}`)}</p>}
                  {entry.comment && <p className="mt-1 break-words text-gray-500">{entry.comment}</p>}
                  {entry.delete_reason && <p className="mt-1 break-words text-gray-500">{t('deleteReason')}: {entry.delete_reason}</p>}
                </div>
                <strong className={cn('tabular-nums', entry.kind === 'bonus' ? 'text-success-600' : entry.kind === 'fine' ? 'text-danger-600' : 'text-gray-900')}>{entry.kind === 'bonus' ? '+' : '−'}{currency(Number(entry.amount))}</strong>
                {entry.deleted_at ? (
                  <Badge variant="neutral" size="sm">{t('deleted')} · {formatDateTime(entry.deleted_at, locale)}</Badge>
                ) : canEdit && (
                  <Button variant="dangerOutline" size="sm" disabled={saving} onClick={() => onDelete({ id: entry.id, employeeId: entry.employee_id, kind: 'entry', label: `${employeePrefix(entry.employee_id)}${t(entry.kind)} · ${formatDateOnly(entry.date, locale)} · ${currency(Number(entry.amount))}` })}>
                    {t('delete')}
                  </Button>
                )}
              </div>
            ))}
            {historyEntries.length === 0 && <EmptyState compact bordered title={t('noTransactions')} />}
          </div>
        </div>
        <div>
          <SectionHeading size="sm" title={t('rateHistory')} className="mb-3" />
          {historyRates.length === 0 && <EmptyState compact bordered title={t('noRates')} />}
          <ul className="divide-y divide-gray-100">
            {historyRates.map((rate) => {
              const deletable = canDeleteSalaryRate(rates, rate);
              return (
                <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-gray-600" key={rate.id}>
                  <div className="min-w-0">
                    <p className={rate.deleted_at ? 'line-through opacity-60' : ''}>
                      {employeePrefix(rate.employee_id)}{formatDateOnly(rate.effective_date, locale)} · {t(rate.salary_type)} · {currency(Number(rate.amount))} · {t('kpi')}: {Number(rate.kpi_percent)}% ({kpiSummary(rate)}) · {t(rate.active ? 'active' : 'inactive')}
                    </p>
                    {rate.delete_reason && <p className="mt-1 break-words text-gray-500 opacity-60">{t('deleteReason')}: {rate.delete_reason}</p>}
                  </div>
                  {rate.deleted_at ? (
                    <Badge variant="neutral" size="sm">{t('deleted')} · {formatDateTime(rate.deleted_at, locale)}</Badge>
                  ) : isOwner && (
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        variant="dangerOutline"
                        size="sm"
                        disabled={saving || !deletable}
                        aria-describedby={!deletable ? `rate-delete-hint-${rate.id}` : undefined}
                        onClick={() => onDelete({ id: rate.id, employeeId: rate.employee_id, kind: 'rate', label: `${employeePrefix(rate.employee_id)}${formatDateOnly(rate.effective_date, locale)} · ${currency(Number(rate.amount))} · ${Number(rate.kpi_percent)}%` })}
                      >
                        {t('delete')}
                      </Button>
                      {!deletable && <p id={`rate-delete-hint-${rate.id}`} className="max-w-xs text-right text-xs text-gray-500">{t('lastRateHelp')}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Card>
  );
}
