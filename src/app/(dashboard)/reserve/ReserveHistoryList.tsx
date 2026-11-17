'use client';

import { useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CalendarRange, ChevronRight, ShoppingCart, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { Badge, Button, Modal } from '@/components/PresentationFoundation';
import { groupReserveActivityByDay, type ReserveActivity } from '@/lib/calculations/ownerReserve';
import { isKnownExpenseCategory } from '@/lib/expenseCategories';
import { formatCurrency, formatDateOnly, formatDateShort, formatDateTime, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { OwnerReserveMethod } from '@/types';

export type DeletableReserveActivity = Extract<ReserveActivity, { kind: 'deposit' | 'return' }>;

interface ReserveHistoryListProps {
  activity: readonly ReserveActivity[];
  methodLabel: (method: OwnerReserveMethod) => string;
  busyId: string | null;
  disabled: boolean;
  onDelete: (activity: DeletableReserveActivity) => void;
}

const KIND_ICON = { deposit: ArrowDownToLine, return: ArrowUpFromLine, purchase: ShoppingCart } as const;
const KIND_TONE = {
  deposit: 'bg-primary-50 text-primary-600',
  return: 'bg-warning-50 text-warning-700',
  purchase: 'bg-gray-100 text-gray-600',
} as const;

/** Why a row cannot be deleted here, or null when it can. */
function lockReason(row: ReserveActivity): 'purchase' | 'exchange' | 'collection' | null {
  if (row.kind === 'purchase') return 'purchase';
  if (row.entry.exchange_id) return 'exchange';
  if (row.kind === 'deposit' && row.entry.collection_date) return 'collection';
  return null;
}

/**
 * Every deposit, return and purchase of the reserve, newest first, grouped by
 * the day it was made. Each row leads with what the money was and which
 * month's profit it left or joined; tapping it opens the full details.
 */
export function ReserveHistoryList({ activity, methodLabel, busyId, disabled, onDelete }: ReserveHistoryListProps) {
  const t = useTranslations('ownerReserve');
  const tc = useTranslations('common');
  const te = useTranslations('expenses.categories');
  const { locale } = useAppLocale();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const days = groupReserveActivityByDay(activity);

  const keyOf = (row: ReserveActivity) => `${row.kind}:${row.id}`;
  const money = (amount: number) => `${formatCurrency(amount)} ${tc('currency')}`;
  const titleOf = (row: ReserveActivity) => {
    const collectionDate = row.kind === 'deposit' ? row.entry.collection_date : null;
    if (collectionDate) {
      return t('collectionOf', {
        date: collectionDate.slice(0, 4) === row.date.slice(0, 4)
          ? formatDateShort(collectionDate, locale)
          : formatDateOnly(collectionDate, locale),
      });
    }
    return row.note ?? t(`kinds.${row.kind}`);
  };
  /** The month whose owner profit the money left (deposit) or joined (return). */
  const monthOf = (row: ReserveActivity) => (row.kind === 'purchase'
    ? null
    : t(row.kind === 'deposit' ? 'fromMonth' : 'toMonth', { month: formatYearMonth(row.entry.period_month.slice(0, 7), locale) }));

  const selected = activity.find((row) => keyOf(row) === openKey) ?? null;

  return (
    <>
      <ul aria-label={t('activityLabel')}>
        {days.map((day) => (
          <li key={day.date} className="border-b border-gray-100 last:border-b-0">
            <div className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-2 sm:px-5">
              <p className="text-sm font-semibold text-gray-800">
                {formatDateOnly(day.date, locale)}
                <span className="ml-2 text-xs font-normal text-gray-500">{t('dayCount', { count: day.rows.length })}</span>
              </p>
              <p className="flex gap-3 whitespace-nowrap text-xs font-semibold tabular-nums">
                {day.deposited > 0 ? <span className="text-primary-600">+{money(day.deposited)}</span> : null}
                {day.withdrawn > 0 ? <span className="text-gray-600">−{money(day.withdrawn)}</span> : null}
              </p>
            </div>
            <ul className="divide-y divide-gray-100">
              {day.rows.map((row) => {
                const Icon = KIND_ICON[row.kind];
                const incoming = row.kind === 'deposit';
                const kindLabel = t(`kinds.${row.kind}`);
                const title = titleOf(row);
                const month = monthOf(row);
                return (
                  <li key={keyOf(row)}>
                    <button
                      type="button"
                      onClick={() => setOpenKey(keyOf(row))}
                      aria-haspopup="dialog"
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50/70 focus-visible:bg-gray-50/70 focus-visible:outline-none sm:px-5"
                    >
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', KIND_TONE[row.kind])}>
                        <Icon size={18} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium leading-5 text-gray-900">{title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-4 text-gray-500">
                          {title !== kindLabel ? <><span>{kindLabel}</span><span aria-hidden="true">·</span></> : null}
                          <span>{t(`sources.${row.source}`)}</span>
                          {row.method ? <Badge size="sm" variant="outline" className="sm:hidden">{methodLabel(row.method)}</Badge> : null}
                        </span>
                        {month ? (
                          <span className="mt-1 flex">
                            <Badge size="sm" variant="neutral" icon={<CalendarRange size={12} aria-hidden="true" />}>{month}</Badge>
                          </span>
                        ) : null}
                      </span>
                      <span className="hidden w-24 shrink-0 sm:block">
                        {row.method ? <Badge size="sm" variant="outline">{methodLabel(row.method)}</Badge> : null}
                      </span>
                      <span className={cn(
                        'shrink-0 whitespace-nowrap text-right text-base font-bold tabular-nums sm:w-40',
                        incoming ? 'text-primary-600' : 'text-gray-900',
                      )}>
                        {incoming ? '+' : '−'}{formatCurrency(row.amount)}
                        <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      {selected ? (
        <ReserveEntryDetails
          row={selected}
          title={titleOf(selected)}
          month={monthOf(selected)}
          methodLabel={methodLabel}
          categoryLabel={(category) => (isKnownExpenseCategory(category) || category === 'other' ? te(category) : category)}
          busy={busyId === selected.id}
          disabled={disabled}
          onClose={() => setOpenKey(null)}
          onDelete={(row) => {
            setOpenKey(null);
            onDelete(row);
          }}
        />
      ) : null}
    </>
  );
}

interface ReserveEntryDetailsProps {
  row: ReserveActivity;
  title: string;
  month: string | null;
  methodLabel: (method: OwnerReserveMethod) => string;
  categoryLabel: (category: string) => string;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onDelete: (row: DeletableReserveActivity) => void;
}

/** Everything known about one reserve entry, with delete where the entry is undone here. */
function ReserveEntryDetails({ row, title, month, methodLabel, categoryLabel, busy, disabled, onClose, onDelete }: ReserveEntryDetailsProps) {
  const t = useTranslations('ownerReserve');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const Icon = KIND_ICON[row.kind];
  const incoming = row.kind === 'deposit';
  const kindLabel = t(`kinds.${row.kind}`);
  const locked = lockReason(row);
  const collectionDate = row.kind === 'deposit' ? row.entry.collection_date : null;

  const facts: Array<{ label: string; value: ReactNode; hint?: string }> = [];
  if (month && row.kind !== 'purchase') {
    facts.push({
      label: t('details.profitMonth'),
      value: formatYearMonth(row.entry.period_month.slice(0, 7), locale),
      hint: t(incoming ? 'details.depositMonthHint' : 'details.returnMonthHint'),
    });
  }
  if (row.kind === 'purchase') facts.push({ label: t('details.paidOn'), value: formatDateOnly(row.date, locale) });
  facts.push({ label: t('details.madeOn'), value: formatDateTime(row.createdAt, locale) });
  if (collectionDate) facts.push({ label: t('details.collectionDay'), value: formatDateOnly(collectionDate, locale) });
  facts.push({ label: t('details.side'), value: t(`sources.${row.source}`) });
  if (row.method) facts.push({ label: t('details.method'), value: methodLabel(row.method) });
  if (row.kind === 'purchase') facts.push({ label: t('details.category'), value: categoryLabel(row.category) });
  if (row.note && row.note !== title) facts.push({ label: t('details.note'), value: row.note });

  const lockText = locked === 'exchange'
    ? t(incoming ? 'fromExchange' : 'toExchange')
    : locked === 'collection'
      ? t('details.lockedCollection')
      : locked === 'purchase'
        ? t('details.lockedPurchase')
        : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={kindLabel}
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          {row.kind !== 'purchase' && !locked ? (
            <Button
              variant="danger"
              icon={<Trash2 size={16} />}
              loading={busy}
              disabled={disabled}
              onClick={() => onDelete(row)}
            >
              {tc('delete')}
            </Button>
          ) : <span />}
          <Button variant="secondary" onClick={onClose}>{tc('close')}</Button>
        </div>
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', KIND_TONE[row.kind])}>
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className={cn('text-2xl font-bold tabular-nums', incoming ? 'text-primary-600' : 'text-gray-900')}>
            {incoming ? '+' : '−'}{formatCurrency(row.amount)}
            <span className="ml-1 text-sm font-medium text-gray-500">{tc('currency')}</span>
          </p>
          {title !== kindLabel ? <p className="break-words text-sm text-gray-600">{title}</p> : null}
        </div>
      </div>

      <dl className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-start justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-sm text-gray-500">{fact.label}</dt>
            <dd className="min-w-0 text-right">
              <span className="block break-words text-sm font-medium text-gray-900">{fact.value}</span>
              {fact.hint ? <span className="block text-xs text-gray-500">{fact.hint}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      {lockText ? <p className="mt-3 text-xs leading-5 text-gray-500">{lockText}</p> : null}
    </Modal>
  );
}
