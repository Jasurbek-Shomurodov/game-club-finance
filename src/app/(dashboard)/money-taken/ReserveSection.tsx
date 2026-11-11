'use client';

import { ArrowDownToLine, ArrowUpFromLine, Clock, MessageSquareText, PiggyBank, ShoppingCart, Trash2, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { Badge, Button, EmptyState, IconButton, SectionHeading } from '@/components/PresentationFoundation';
import type { ReserveActivity, ReserveBalance } from '@/lib/calculations/ownerReserve';
import { formatCurrency, formatDateOnly } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { OWNER_WITHDRAWAL_PAYMENT_METHODS, OWNER_WITHDRAWAL_SOURCES, type OwnerWithdrawalPaymentMethod, type OwnerWithdrawalSource } from '@/types';
import { SOURCE_ICONS, SOURCE_TINTS } from './profitIcons';

const ACTIVITY_LIMIT = 12;

interface ReserveSectionProps {
  balances: Record<OwnerWithdrawalSource, ReserveBalance>;
  /** What "put all into reserve" would move from the selected month, per side. */
  depositAllAmounts: Record<OwnerWithdrawalSource, number>;
  /** The selected month, e.g. "November 2026". */
  monthLabel: string;
  activity: readonly ReserveActivity[];
  methodLabel: (method: OwnerWithdrawalPaymentMethod) => string;
  busyId: string | null;
  disabled: boolean;
  onReturn: (source: OwnerWithdrawalSource) => void;
  onDepositAll: (source: OwnerWithdrawalSource) => void;
  onPay: () => void;
  onDelete: (activity: Extract<ReserveActivity, { kind: 'deposit' | 'return' }>) => void;
}

/** The owner reserve: what it holds per side, ways to fill and spend it, and every deposit, return and purchase. */
export function ReserveSection({ balances, depositAllAmounts, monthLabel, activity, methodLabel, busyId, disabled, onReturn, onDepositAll, onPay, onDelete }: ReserveSectionProps) {
  const t = useTranslations('ownerReserve');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const recent = activity.slice(0, ACTIVITY_LIMIT);

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <PiggyBank size={20} aria-hidden="true" />
          </span>
          <SectionHeading title={t('sectionTitle')} description={t('sectionDescription')} />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 self-start"
          disabled={disabled || (balances.game_club.held <= 0 && balances.bar.held <= 0)}
          onClick={onPay}
          icon={<ShoppingCart size={16} aria-hidden="true" />}
        >
          {t('payButton')}
        </Button>
      </div>

      <div className="grid gap-3 border-b border-gray-100 px-4 py-4 sm:grid-cols-2 sm:px-5">
        {OWNER_WITHDRAWAL_SOURCES.map((source) => {
          const SourceIcon = SOURCE_ICONS[source];
          const side = balances[source];
          const methods = source === 'game_club'
            ? OWNER_WITHDRAWAL_PAYMENT_METHODS.filter((method) => side.byMethod[method] !== 0)
            : [];
          return (
            <div key={source} className="flex min-w-0 flex-col rounded-2xl border border-gray-100 bg-gray-50/40 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', SOURCE_TINTS[source].bubble)}>
                  <SourceIcon size={15} aria-hidden="true" />
                </span>
                {t(`sources.${source}`)}
              </p>
              <p className="mt-3 text-xs text-gray-500">{t('held')}</p>
              <p className="mt-1 break-words text-2xl font-bold leading-none tracking-tight tabular-nums text-gray-950">
                {formatCurrency(side.held)}
                <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{tc('currency')}</span>
              </p>
              {methods.length > 0 ? (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                  {methods.map((method) => (
                    <span key={method} className="whitespace-nowrap">
                      {methodLabel(method)} <span className="font-semibold tabular-nums text-gray-700">{formatCurrency(side.byMethod[method])}</span>
                    </span>
                  ))}
                </p>
              ) : null}

              <p className="mt-3 text-xs text-gray-500">
                {t('leftInMonth', { month: monthLabel, amount: formatCurrency(depositAllAmounts[source]) })}
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || depositAllAmounts[source] <= 0}
                  loading={busyId === `all:${source}`}
                  onClick={() => onDepositAll(source)}
                  icon={<ArrowDownToLine size={15} aria-hidden="true" />}
                >
                  {t('depositAllShort', { amount: formatCurrency(depositAllAmounts[source]) })}
                </Button>
                <Button variant="ghost" size="sm" disabled={disabled || side.held <= 0} onClick={() => onReturn(source)} icon={<Undo2 size={15} aria-hidden="true" />}>
                  {t('returnButton')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {recent.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState compact title={t('empty')} description={t('emptyHint')} />
        </div>
      ) : (
        <ul className="divide-y divide-gray-100" aria-label={t('activityLabel')}>
          {recent.map((row) => {
            const Icon = row.kind === 'deposit' ? ArrowDownToLine : row.kind === 'return' ? ArrowUpFromLine : ShoppingCart;
            const incoming = row.kind === 'deposit';
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
                  {row.kind === 'purchase' ? (
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
      )}
    </>
  );
}
