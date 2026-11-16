'use client';

import { ArrowDownToLine, ArrowUpFromLine, Clock, MessageSquareText, ShoppingCart, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { Badge, IconButton } from '@/components/PresentationFoundation';
import type { ReserveActivity } from '@/lib/calculations/ownerReserve';
import { formatCurrency, formatDateOnly } from '@/lib/formatters';
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

/** Every deposit, return and purchase of the reserve, newest first. */
export function ReserveHistoryList({ activity, methodLabel, busyId, disabled, onDelete }: ReserveHistoryListProps) {
  const t = useTranslations('ownerReserve');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();

  return (
    <ul className="divide-y divide-gray-100" aria-label={t('activityLabel')}>
      {activity.map((row) => {
        const Icon = row.kind === 'deposit' ? ArrowDownToLine : row.kind === 'return' ? ArrowUpFromLine : ShoppingCart;
        const incoming = row.kind === 'deposit';
        // A collection deposit is undone with its collection in Reports, a dollar entry with its exchange.
        const locked = row.kind === 'purchase' || Boolean(row.entry.exchange_id) || (row.kind === 'deposit' && Boolean(row.entry.collection_date));
        return (
          <li key={`${row.kind}:${row.id}`} className="group flex items-start gap-3 px-4 py-3.5 sm:px-5">
            <span className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              incoming ? 'bg-primary-50 text-primary-600' : 'bg-gray-100 text-gray-600',
            )}>
              <Icon size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-gray-900">{t(`kinds.${row.kind}`)}</span>
                <Badge size="sm" variant="outline">{t(`sources.${row.source}`)}</Badge>
                {row.method ? <Badge size="sm" variant="outline">{methodLabel(row.method)}</Badge> : null}
              </div>
              {row.kind !== 'purchase' && row.entry.exchange_id ? (
                <p className="mt-1 text-sm leading-5 text-gray-600">{t(row.kind === 'deposit' ? 'fromExchange' : 'toExchange')}</p>
              ) : null}
              {row.kind === 'deposit' && row.entry.collection_date ? (
                <p className="mt-1 text-sm leading-5 text-gray-600">
                  {t('fromCollection', { date: formatDateOnly(row.entry.collection_date, locale) })}
                </p>
              ) : null}
              {row.note ? (
                <p className="mt-1 flex gap-1.5 text-sm leading-5 text-gray-600">
                  <MessageSquareText size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
                  <span className="min-w-0 break-words">{row.note}</span>
                </p>
              ) : null}
              <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-400">
                <Clock size={12} aria-hidden="true" />
                {formatDateOnly(row.date, locale)}
              </p>
            </div>
            <div className="flex shrink-0 items-start gap-3">
              <p className={cn('whitespace-nowrap pt-1 text-base font-bold tabular-nums sm:text-lg', incoming ? 'text-primary-600' : 'text-gray-900')}>
                {incoming ? '+' : '−'}{formatCurrency(row.amount)}
                <span className="ml-1 text-xs font-medium text-gray-500">{tc('currency')}</span>
              </p>
              {locked ? (
                <span aria-hidden="true" className="w-8 shrink-0" />
              ) : (
                <IconButton
                  variant="danger"
                  size="sm"
                  label={`${tc('delete')}: ${t(`kinds.${row.kind}`)} · ${formatCurrency(row.amount)} ${tc('currency')}`}
                  icon={<Trash2 size={16} />}
                  loading={busyId === row.id}
                  disabled={disabled}
                  onClick={() => onDelete(row)}
                  className={cn('mt-0.5 transition-opacity', busyId !== row.id && 'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100')}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
