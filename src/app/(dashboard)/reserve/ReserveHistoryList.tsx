'use client';

import { ArrowDownToLine, ArrowUpFromLine, MessageSquareText, ShoppingCart, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { Badge, IconButton } from '@/components/PresentationFoundation';
import { groupReserveActivityByDay, type ReserveActivity } from '@/lib/calculations/ownerReserve';
import { formatCurrency, formatDateOnly, formatDateShort } from '@/lib/formatters';
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

/**
 * Every deposit, return and purchase of the reserve, newest first, grouped by
 * day. Each row leads with what the money was (a day's collection, a note)
 * and its amount; the kind, side and payment method sit underneath.
 */
export function ReserveHistoryList({ activity, methodLabel, busyId, disabled, onDelete }: ReserveHistoryListProps) {
  const t = useTranslations('ownerReserve');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const days = groupReserveActivityByDay(activity);

  const money = (amount: number) => `${formatCurrency(amount)} ${tc('currency')}`;

  return (
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
              const collectionDate = row.kind === 'deposit' ? row.entry.collection_date : null;
              const exchanged = row.kind !== 'purchase' && Boolean(row.entry.exchange_id);
              // A collection deposit is undone with its collection in Reports, a dollar entry with its exchange.
              const locked = row.kind === 'purchase' || exchanged || Boolean(collectionDate);
              const kindLabel = t(`kinds.${row.kind}`);
              const title = collectionDate
                ? t('collectionOf', {
                  date: collectionDate.slice(0, 4) === row.date.slice(0, 4)
                    ? formatDateShort(collectionDate, locale)
                    : formatDateOnly(collectionDate, locale),
                })
                : row.note ?? kindLabel;
              const noteIsTitle = !collectionDate && Boolean(row.note);
              return (
                <li key={`${row.kind}:${row.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/70 sm:px-5">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', KIND_TONE[row.kind])}>
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-medium leading-5 text-gray-900', noteIsTitle && 'line-clamp-2 break-words')}>{title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-4 text-gray-500">
                      {title !== kindLabel ? <span>{kindLabel}</span> : null}
                      {title !== kindLabel ? <span aria-hidden="true">·</span> : null}
                      <span>{t(`sources.${row.source}`)}</span>
                      {row.method ? <Badge size="sm" variant="outline" className="sm:hidden">{methodLabel(row.method)}</Badge> : null}
                    </p>
                    {exchanged ? (
                      <p className="mt-1 text-xs leading-4 text-gray-500">{t(incoming ? 'fromExchange' : 'toExchange')}</p>
                    ) : null}
                    {row.note && !noteIsTitle ? (
                      <p className="mt-1 flex gap-1.5 text-xs leading-4 text-gray-500">
                        <MessageSquareText size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
                        <span className="min-w-0 break-words">{row.note}</span>
                      </p>
                    ) : null}
                  </div>
                  <span className="hidden w-24 shrink-0 sm:block">
                    {row.method ? <Badge size="sm" variant="outline">{methodLabel(row.method)}</Badge> : null}
                  </span>
                  <p className={cn(
                    'shrink-0 whitespace-nowrap text-right text-base font-bold tabular-nums sm:w-40',
                    incoming ? 'text-primary-600' : 'text-gray-900',
                  )}>
                    {incoming ? '+' : '−'}{formatCurrency(row.amount)}
                    <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
                  </p>
                  {locked ? (
                    <span aria-hidden="true" className="w-8 shrink-0" />
                  ) : (
                    <IconButton
                      variant="danger"
                      size="sm"
                      label={`${tc('delete')}: ${kindLabel} · ${money(row.amount)}`}
                      icon={<Trash2 size={16} />}
                      loading={busyId === row.id}
                      disabled={disabled}
                      onClick={() => onDelete(row)}
                      className={cn('transition-opacity', busyId !== row.id && 'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100')}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
