'use client';

import { useId, useState } from 'react';
import { CalendarArrowUp, CalendarDays, ChevronDown, Clock, History, Layers, MessageSquareText, Sprout, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { Badge, EmptyState, IconButton, SectionHeading, SegmentedControl } from '@/components/PresentationFoundation';
import { investedBySourceForMonth, withdrawnBySourceForMonth, type InvestmentRow } from '@/lib/calculations/ownerProfitSnapshot';
import { capitalizeFirst, formatCurrency, formatDateTime, formatYearMonth } from '@/lib/formatters';
import { cn, previousYearMonth } from '@/lib/utils';
import {
  OWNER_WITHDRAWAL_SOURCES,
  type OwnerProfitCarryover,
  type OwnerWithdrawal,
  type OwnerWithdrawalPaymentMethod,
  type OwnerWithdrawalSource,
} from '@/types';
import { METHOD_ICONS, SOURCE_ICONS, SOURCE_TINTS } from './profitIcons';

export type HistoryRow =
  | { kind: 'withdrawal'; id: string; month: string; withdrawal: OwnerWithdrawal }
  | { kind: 'carryover'; id: string; month: string; carryover: OwnerProfitCarryover };

type SourceFilter = OwnerWithdrawalSource | 'all';


export function historyCreatedAt(row: HistoryRow): string {
  return row.kind === 'withdrawal' ? row.withdrawal.created_at : row.carryover.created_at;
}

interface WithdrawalHistoryProps {
  /** Newest month first, newest entry first within a month. */
  rows: readonly HistoryRow[];
  /** The club's current business month (YYYY-MM); only the month before it starts expanded. */
  currentMonth: string;
  withdrawals: readonly OwnerWithdrawal[];
  /** `investments` expenses, shown per month beside what was withdrawn. */
  investments: readonly InvestmentRow[];
  isOwner: boolean;
  deletingId: string | null;
  deleteDisabled: boolean;
  methodLabel: (method: OwnerWithdrawalPaymentMethod) => string;
  /** Accessible delete label, e.g. "Game Club · Card · 1 474 000 UZS". */
  deleteLabel: (row: HistoryRow) => string;
  onDelete: (row: HistoryRow) => void;
}

/** Owner withdrawals and carryovers as a month-by-month timeline, filterable by source. */
export function WithdrawalHistory({
  rows,
  currentMonth,
  withdrawals,
  investments,
  isOwner,
  deletingId,
  deleteDisabled,
  methodLabel,
  deleteLabel,
  onDelete,
}: WithdrawalHistoryProps) {
  const t = useTranslations('moneyTaken');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const baseId = useId();
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const entry = (row: HistoryRow) => (row.kind === 'withdrawal' ? row.withdrawal : row.carryover);
  const visibleRows = filter === 'all' ? rows : rows.filter((row) => entry(row).source === filter);
  const months: Array<{ month: string; rows: HistoryRow[] }> = [];
  for (const row of visibleRows) {
    const last = months.at(-1);
    if (last?.month === row.month) last.rows.push(row);
    else months.push({ month: row.month, rows: [row] });
  }

  const lastMonth = previousYearMonth(currentMonth);
  const forFilter = (totals: Record<OwnerWithdrawalSource, number>) => (filter === 'all'
    ? OWNER_WITHDRAWAL_SOURCES.reduce((sum, source) => sum + totals[source], 0)
    : totals[filter]);
  // Withdrawn and invested per month for the chosen source: this and last month always, then every month with history.
  const monthTotals = [...new Set([currentMonth, lastMonth, ...rows.map((row) => row.month)])]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => ({
      month,
      amount: forFilter(withdrawnBySourceForMonth(withdrawals, month)),
      invested: forFilter(investedBySourceForMonth(investments, month)),
    }));
  const monthLabel = (month: string) => (month === currentMonth
    ? t('summaryThisMonth')
    : month === lastMonth ? t('summaryLastMonth') : capitalizeFirst(formatYearMonth(month, locale), locale));
  function showMonth(month: string) {
    setToggled((current) => ({ ...current, [month]: true }));
    requestAnimationFrame(() => document.getElementById(`${baseId}-section-${month}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  const filterOptions = (['all', ...OWNER_WITHDRAWAL_SOURCES] as const).map((source) => {
    const Icon = source === 'all' ? Layers : SOURCE_ICONS[source];
    return { value: source, label: t(`sources.${source}`), icon: <Icon size={14} aria-hidden="true" /> };
  });

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
            <History size={20} aria-hidden="true" />
          </span>
          <SectionHeading title={t('historyTitle')} description={t('historyDescription')} />
        </div>
        {rows.length > 0 ? (
          <SegmentedControl
            label={t('historyFilter')}
            variant="chips"
            size="sm"
            options={filterOptions}
            value={filter}
            onChange={setFilter}
          />
        ) : null}
        <div>
          <p className="text-xs font-medium text-gray-500">{t('withdrawnByMonth')}</p>
          <ul className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
            {monthTotals.map(({ month, amount, invested }) => {
              const hasRows = months.some((group) => group.month === month);
              return (
                <li key={month} className="shrink-0">
                  <button
                    type="button"
                    disabled={!hasRows}
                    onClick={() => showMonth(month)}
                    className={cn(
                      'h-full min-w-[10.5rem] rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                      month === currentMonth ? 'border-primary-200 bg-primary-50/60' : 'border-gray-100 bg-gray-50/60',
                      hasRows ? 'hover:bg-gray-100/70' : 'cursor-default',
                    )}
                  >
                    <span className="block text-xs text-gray-500">{monthLabel(month)}</span>
                    <span className="mt-0.5 block whitespace-nowrap font-bold tabular-nums text-gray-900">
                      {formatCurrency(amount)}
                      <span className="ml-1 text-[11px] font-medium text-gray-500">{tc('currency')}</span>
                    </span>
                    {/* Always shown, even at 0, so every month card has the same height. */}
                    <span className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-[11px] text-gray-500">
                      <Sprout size={11} aria-hidden="true" />
                      {t('historyMonthInvested')}
                      <span className="font-semibold tabular-nums text-gray-700">{formatCurrency(invested)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {months.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState compact title={rows.length === 0 ? t('noHistory') : t('noHistoryForSource')} />
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {months.map(({ month, rows: monthRows }) => {
            const open = toggled[month] ?? false;
            const panelId = `${baseId}-${month}`;
            const totals = withdrawnBySourceForMonth(withdrawals, month);
            const sides = OWNER_WITHDRAWAL_SOURCES.filter((source) => totals[source] > 0 && (filter === 'all' || filter === source));
            const total = sides.reduce((sum, source) => sum + totals[source], 0);
            const investedTotals = investedBySourceForMonth(investments, month);
            const invested = forFilter(investedTotals);
            // Every source in the filter, even at 0, so all month rows read the same.
            const legend = OWNER_WITHDRAWAL_SOURCES.filter((source) => filter === 'all' || filter === source);

            return (
              <section key={month} id={`${baseId}-section-${month}`} className="scroll-mt-20" aria-label={formatYearMonth(month, locale)}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setToggled((current) => ({ ...current, [month]: !open }))}
                  className="flex w-full flex-col gap-3 bg-gray-50/60 px-4 py-3 text-left transition hover:bg-gray-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 sm:px-5"
                >
                  <span className="flex w-full items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-gray-600 shadow-sm">
                      <CalendarDays size={18} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-gray-900">{capitalizeFirst(formatYearMonth(month, locale), locale)}</span>
                      <span className="block text-xs text-gray-500">{t('historyEntries', { count: monthRows.length })}</span>
                    </span>
                    <span className="text-right sm:min-w-[9rem]">
                        <span className="flex items-center justify-end gap-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                          <Sprout size={12} aria-hidden="true" />
                          {t('historyMonthInvested')}
                        </span>
                        <span className="block whitespace-nowrap text-base font-semibold leading-tight tabular-nums text-gray-700">
                          {formatCurrency(invested)}
                          <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
                        </span>
                      </span>
                    {/* Always shown, so a month with only moves or investments still reads "nothing withdrawn". */}
                    <span className="text-right sm:min-w-[9rem]">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">{t('historyMonthTotal')}</span>
                      <span className={cn('block text-lg font-bold leading-tight tabular-nums', total > 0 ? 'text-gray-900' : 'text-gray-400')}>
                        {formatCurrency(total)}
                        <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
                      </span>
                    </span>
                    {/* Same width as an entry's delete button, so month totals and entry amounts share a right edge. */}
                    <span className="flex w-8 shrink-0 justify-center">
                      <ChevronDown
                        size={18}
                        aria-hidden="true"
                        className={cn('text-gray-400 transition-transform duration-200', open && 'rotate-180')}
                      />
                    </span>
                  </span>

                  <span className="flex w-full flex-col gap-2 pl-12">
                    <span className="flex h-2 w-full overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                      {sides.map((source) => (
                        <span
                          key={source}
                          className={cn('h-full transition-[width] duration-500', SOURCE_TINTS[source].bar)}
                          style={{ width: `${(totals[source] / total) * 100}%` }}
                        />
                      ))}
                    </span>
                    <span className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
                      {legend.map((source) => (
                        <span key={source} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className={cn('h-2 w-2 rounded-full', SOURCE_TINTS[source].dot)} aria-hidden="true" />
                          {t(`sources.${source}`)}
                          <span className="font-semibold tabular-nums text-gray-900">{formatCurrency(totals[source])}</span>
                          <span className="ml-1 inline-flex items-center gap-1 text-gray-500">
                            <Sprout size={11} aria-hidden="true" />
                            {t('historyMonthInvested')}
                            <span className="font-semibold tabular-nums text-gray-700">{formatCurrency(investedTotals[source])}</span>
                          </span>
                        </span>
                      ))}
                    </span>
                  </span>
                </button>

                {open ? (
                  <ul id={panelId} className="divide-y divide-gray-100">
                    {monthRows.map((row) => {
                      const item = entry(row);
                      const SourceIcon = row.kind === 'carryover' ? CalendarArrowUp : SOURCE_ICONS[item.source];
                      const MethodIcon = item.payment_method ? METHOD_ICONS[item.payment_method] : null;
                      return (
                        <li key={`${row.kind}:${row.id}`} className="group flex items-start gap-3 px-4 py-3.5 transition hover:bg-gray-50/70 sm:px-5">
                          <span
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                              row.kind === 'carryover' ? 'bg-gray-100 text-gray-600' : SOURCE_TINTS[item.source].bubble,
                            )}
                          >
                            <SourceIcon size={18} aria-hidden="true" />
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-gray-900">{t(`sources.${item.source}`)}</span>
                              {item.payment_method && MethodIcon ? (
                                <Badge size="sm" variant="outline" icon={<MethodIcon size={12} aria-hidden="true" />}>
                                  {methodLabel(item.payment_method)}
                                </Badge>
                              ) : null}
                              {row.kind === 'carryover' ? (
                                <Badge size="sm" variant="info">
                                  {t('carriedTo', { month: formatYearMonth(row.carryover.to_month.slice(0, 7), locale) })}
                                </Badge>
                              ) : null}
                            </div>
                            {item.comment ? (
                              <p className="mt-1 flex gap-1.5 text-sm leading-5 text-gray-600">
                                <MessageSquareText size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
                                <span className="min-w-0 break-words">{item.comment}</span>
                              </p>
                            ) : null}
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-400">
                              <Clock size={12} aria-hidden="true" />
                              {formatDateTime(item.created_at, locale)}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-start gap-3">
                            <p
                              className={cn(
                                'whitespace-nowrap pt-1 text-right text-base font-bold tabular-nums sm:text-lg',
                                row.kind === 'carryover' ? 'text-gray-600' : 'text-gray-900',
                              )}
                            >
                              {formatCurrency(item.amount)}
                              <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
                            </p>
                            {isOwner ? (
                              <IconButton
                                variant="danger"
                                size="sm"
                                label={`${tc('delete')}: ${deleteLabel(row)}`}
                                icon={<Trash2 size={16} />}
                                loading={deletingId === row.id}
                                disabled={deleteDisabled}
                                onClick={() => onDelete(row)}
                                className={cn(
                                  'mt-0.5 transition-opacity',
                                  deletingId !== row.id && 'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
                                )}
                              />
                            ) : <span aria-hidden="true" className="w-8 shrink-0" />}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
