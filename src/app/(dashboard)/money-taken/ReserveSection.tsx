'use client';

import Link from 'next/link';
import { ArrowDownToLine, ChartColumn, ChevronRight, PiggyBank, ShoppingCart, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, ButtonLink, SectionHeading } from '@/components/PresentationFoundation';
import type { ReserveActivity, ReserveBalance } from '@/lib/calculations/ownerReserve';
import { formatCurrency, formatUnitCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { OWNER_RESERVE_METHODS, OWNER_WITHDRAWAL_SOURCES, type OwnerReserveMethod, type OwnerWithdrawalSource } from '@/types';
import { SOURCE_ICONS, SOURCE_TINTS } from './profitIcons';

interface ReserveSectionProps {
  balances: Record<OwnerWithdrawalSource, ReserveBalance>;
  /** What "put all into reserve" would move from the selected month, per side. */
  depositAllAmounts: Record<OwnerWithdrawalSource, number>;
  /** The selected month, e.g. "November 2026". */
  monthLabel: string;
  activity: readonly ReserveActivity[];
  /** US dollars the club holds now; the reserve keeps them (143). */
  dollarsHeld: number;
  methodLabel: (method: OwnerReserveMethod) => string;
  busyId: string | null;
  disabled: boolean;
  onReturn: (source: OwnerWithdrawalSource) => void;
  onDepositAll: (source: OwnerWithdrawalSource) => void;
  onPay: () => void;
}

/** The owner reserve on Owner Profit: what it holds per side and ways to fill and spend it; charts and history are on /reserve. */
export function ReserveSection({ balances, depositAllAmounts, monthLabel, activity, dollarsHeld, methodLabel, busyId, disabled, onReturn, onDepositAll, onPay }: ReserveSectionProps) {
  const t = useTranslations('ownerReserve');
  const tc = useTranslations('common');

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
          disabled={disabled || (balances.game_club.held - balances.game_club.byMethod.usd <= 0 && balances.bar.held <= 0)}
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
            ? OWNER_RESERVE_METHODS.filter((method) => side.byMethod[method] !== 0 || (method === 'usd' && dollarsHeld !== 0))
            : [];
          return (
            <div key={source} className="flex min-w-0 flex-col rounded-2xl border border-gray-100 bg-gray-50/40 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', SOURCE_TINTS[source].bubble)}>
                  <SourceIcon size={15} aria-hidden="true" />
                </span>
                {t(`sources.${source}`)}
              </p>
              <Link
                href="/reserve?view=history"
                className="group -mx-2 mt-2 block rounded-lg px-2 py-1 transition-colors hover:bg-gray-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span className="flex items-center justify-between text-xs text-gray-500">
                  {t('held')}
                  <ChevronRight size={14} aria-hidden="true" className="text-gray-300 group-hover:text-gray-500" />
                </span>
                <span className="mt-1 block break-words text-2xl font-bold leading-none tracking-tight tabular-nums text-gray-950">
                  {formatCurrency(side.held)}
                  <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{tc('currency')}</span>
                </span>
              </Link>
              {methods.length > 0 ? (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                  {methods.map((method) => (
                    <span key={method} className="whitespace-nowrap">
                      {methodLabel(method)} <span className="font-semibold tabular-nums text-gray-700">{formatCurrency(side.byMethod[method])}</span>
                      {method === 'usd' ? (
                        <span className="tabular-nums"> ({dollarsHeld < 0 ? '−' : ''}${formatUnitCurrency(Math.abs(dollarsHeld))})</span>
                      ) : null}
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

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <p className="text-xs text-gray-500">
          {activity.length === 0 ? t('empty') : t('historyCount', { count: activity.length })}
        </p>
        <ButtonLink href="/reserve" variant="ghost" size="sm" icon={<ChartColumn size={15} aria-hidden="true" />}>
          {t('openPage')}
        </ButtonLink>
      </div>
    </>
  );
}
