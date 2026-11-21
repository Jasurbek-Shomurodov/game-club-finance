'use client';

import { useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, CalendarRange, ChevronRight, ShoppingCart, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { Badge, Button, CategoryIcon, IconButton, IconChip, Modal, TappableSurface, type Tone } from '@/components/PresentationFoundation';
import { groupReserveActivityByDay, type ReserveActivity } from '@/lib/calculations/ownerReserve';
import { isKnownExpenseCategory } from '@/lib/expenseCategories';
import { formatCurrency, formatDateOnly, formatDateShort, formatDateTime, formatUnitCurrency, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { OwnerReserveMethod } from '@/types';

export type DeletableReserveActivity = ReserveActivity;

interface ReserveHistoryListProps {
  activity: readonly ReserveActivity[];
  methodLabel: (method: OwnerReserveMethod) => string;
  busyId: string | null;
  disabled: boolean;
  onDelete: (activity: DeletableReserveActivity) => void;
}

const KIND_ICON = { deposit: ArrowDownToLine, return: ArrowUpFromLine, purchase: ShoppingCart, exchange: ArrowRightLeft } as const;
const KIND_TONE: Record<ReserveActivity['kind'], Tone> = { deposit: 'primary', return: 'warning', purchase: 'neutral', exchange: 'reserve' };

const dollars = (value: number) => `$${formatUnitCurrency(value)}`;

/** Why a row cannot be deleted here, or null when it can. */
function lockReason(row: ReserveActivity): 'exchange' | 'collection' | null {
  // A purchase is an expense the reserve paid: deleting it gives the money back to the reserve.
  // An exchange inside the reserve (170) is undone here, both halves at once.
  if (row.kind === 'purchase' || row.kind === 'exchange') return null;
  if (row.entry.exchange_id) return 'exchange';
  if (row.kind === 'deposit' && row.entry.collection_date) return 'collection';
  return null;
}

/**
 * Every deposit, return and purchase of the reserve, newest first, grouped by
 * the day it was made. Each row leads with what the money was and which
 * month's profit it left or joined; tapping it opens the full details, and
 * the trash button deletes it after a confirmation.
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
    if (row.kind === 'exchange') return t(row.direction === 'buy' ? 'exchangeBought' : 'exchangeSold', { usd: dollars(row.usd) });
    return row.note ?? t(`kinds.${row.kind}`);
  };
  /** The month whose owner profit the money left (deposit) or joined (return). */
  const monthOf = (row: ReserveActivity) => (row.kind === 'purchase' || row.kind === 'exchange'
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
                const deletable = !lockReason(row);
                return (
                  <li key={keyOf(row)} className="flex items-center pr-2 sm:pr-3">
                    <TappableSurface onClick={() => setOpenKey(keyOf(row))} chevron={false} className="min-w-0 flex-1 rounded-lg py-3 pl-4 pr-2 sm:pl-5">
                      <span className="flex items-center gap-3">
                      {/* A purchase shows what it paid for; the other kinds show how the money moved. */}
                      {row.kind === 'purchase' ? <CategoryIcon category={row.category} tone="move" /> : (
                        <IconChip icon={Icon} tone={KIND_TONE[row.kind]} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium leading-5 text-gray-900">{title}</span>
                        {/* One pot: which side or method the money came from is only in the details. */}
                        {title !== kindLabel || month ? (
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-gray-500">
                            {title !== kindLabel ? <span>{kindLabel}</span> : null}
                            {month ? <Badge size="sm" variant="neutral" icon={<CalendarRange size={12} aria-hidden="true" />}>{month}</Badge> : null}
                          </span>
                        ) : null}
                      </span>
                      {row.kind === 'exchange' ? (
                        // Sums swapped for dollars: the reserve's total is unchanged.
                        <span className="shrink-0 whitespace-nowrap text-right tabular-nums sm:w-40">
                          <span className="block text-base font-bold text-gray-900">{dollars(row.usd)}</span>
                          <span className="block text-xs text-gray-500">{formatCurrency(row.amount)} {tc('currency')}</span>
                        </span>
                      ) : (
                        <span className={cn(
                          'shrink-0 whitespace-nowrap text-right text-base font-bold tabular-nums sm:w-40',
                          incoming ? 'text-primary-600' : 'text-gray-900',
                        )}>
                          {incoming ? '+' : '−'}{formatCurrency(row.amount)}
                          <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
                        </span>
                      )}
                      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-gray-400" />
                      </span>
                    </TappableSurface>
                    {deletable ? (
                      <IconButton
                        variant="danger"
                        size="sm"
                        label={`${tc('delete')}: ${title}`}
                        icon={<Trash2 size={16} aria-hidden="true" />}
                        loading={busyId === row.id}
                        disabled={disabled}
                        onClick={() => onDelete(row)}
                        className="shrink-0"
                      />
                    ) : <span aria-hidden="true" className="w-8 shrink-0" />}
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
  if (row.kind === 'purchase' || row.kind === 'exchange') facts.push({ label: t('details.paidOn'), value: formatDateOnly(row.date, locale) });
  if (row.kind === 'exchange') {
    facts.push({ label: t('details.dollars'), value: `${row.direction === 'buy' ? '+' : '−'}${dollars(row.usd)}` });
    facts.push({ label: t('details.sumsPart'), value: `${row.direction === 'buy' ? '−' : '+'}${formatCurrency(row.amount)} ${tc('currency')}` });
    if (row.rate !== null) facts.push({ label: t('details.rate'), value: `${formatUnitCurrency(row.rate)} ${tc('currency')}` });
    if (row.method) facts.push({ label: t('details.sumsMethod'), value: methodLabel(row.method) });
  }
  facts.push({ label: t('details.madeOn'), value: formatDateTime(row.createdAt, locale) });
  if (collectionDate) facts.push({ label: t('details.collectionDay'), value: formatDateOnly(collectionDate, locale) });
  // The reserve is one pot; where the money came from is kept for reference only.
  // A purchase is paid by the pot itself, in sums or dollars, never by a side's method (155).
  if (row.kind !== 'exchange') {
    facts.push({
      label: t(row.kind === 'deposit' ? 'details.takenFrom' : row.kind === 'return' ? 'details.returnedTo' : 'details.paidWith'),
      value: row.kind === 'purchase'
        ? (row.method === 'usd' ? methodLabel('usd') : t('details.sums'))
        : [t(`sources.${row.source}`), row.method && methodLabel(row.method)].filter(Boolean).join(' · '),
    });
  }
  if (row.kind === 'purchase') facts.push({ label: t('details.category'), value: categoryLabel(row.category) });
  if (row.note && row.note !== title) facts.push({ label: t('details.note'), value: row.note });

  const lockText = row.kind === 'exchange'
    ? t('details.exchangeHint')
    : locked === 'exchange'
    ? t(incoming ? 'fromExchange' : 'toExchange')
    : locked === 'collection'
      ? t('details.lockedCollection')
      : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={kindLabel}
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          {!locked ? (
            <Button
              variant="danger"
              icon={<Trash2 size={16} aria-hidden="true" />}
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
        <IconChip icon={Icon} tone={KIND_TONE[row.kind]} size="lg" />
        <div className="min-w-0">
          {row.kind === 'exchange' ? (
            <p className="text-2xl font-bold tabular-nums text-gray-900">
              {row.direction === 'buy'
                ? `${formatCurrency(row.amount)} ${tc('currency')} → ${dollars(row.usd)}`
                : `${dollars(row.usd)} → ${formatCurrency(row.amount)} ${tc('currency')}`}
            </p>
          ) : (
            <p className={cn('text-2xl font-bold tabular-nums', incoming ? 'text-primary-600' : 'text-gray-900')}>
              {incoming ? '+' : '−'}{formatCurrency(row.amount)}
              <span className="ml-1 text-sm font-medium text-gray-500">{tc('currency')}</span>
            </p>
          )}
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
