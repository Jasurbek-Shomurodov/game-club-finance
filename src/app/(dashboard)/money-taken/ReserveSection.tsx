'use client';

import { ArrowDownToLine, Banknote, ChartColumn, DollarSign, PiggyBank } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, ButtonLink, IconChip, SectionHeading, Skeleton, StatTile } from '@/components/PresentationFoundation';
import { HeadingSkeleton } from '@/components/charts/ChartSkeletons';
import { reserveSumsHeld, type ReserveBalance } from '@/lib/calculations/ownerReserve';
import { reserveHistoryHref, reserveHref } from '@/lib/detailLinks';
import { formatCurrency, formatDollars } from '@/lib/formatters';
import { OWNER_WITHDRAWAL_SOURCES, type OwnerWithdrawalSource } from '@/types';
import { SOURCE_ICONS, SOURCE_TONES } from '@/components/owner-money/profitIcons';

interface ReserveSectionProps {
  balances: Record<OwnerWithdrawalSource, ReserveBalance>;
  /** What "put all into reserve" would move from the selected month, per side. */
  depositAllAmounts: Record<OwnerWithdrawalSource, number>;
  /** The selected month, e.g. "November 2026". */
  monthLabel: string;
  /** US dollars the club holds now; the reserve keeps them (143). */
  dollarsHeld: number;
  busyId: string | null;
  disabled: boolean;
  onDepositAll: (source: OwnerWithdrawalSource) => void;
}

/**
 * The owner reserve on Owner Profit: its two accounts as links, the sums as
 * /reserve counts them (without what its dollars cost) and the dollars apart,
 * and the one thing that belongs to this page, putting what is left of the
 * month into it.
 * Returning, paying, charts and history live on /reserve.
 */
export function ReserveSection({ balances, depositAllAmounts, monthLabel, dollarsHeld, busyId, disabled, onDepositAll }: ReserveSectionProps) {
  const t = useTranslations('ownerReserve');
  const tp = useTranslations('reservePage');
  const tc = useTranslations('common');

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <IconChip icon={PiggyBank} tone="reserve" />
          <SectionHeading title={t('sectionTitle')} description={t('sectionDescription')} />
        </div>
        <ButtonLink href="/reserve" variant="ghost" size="sm" className="shrink-0 self-start" icon={<ChartColumn size={15} aria-hidden="true" />}>
          {t('openPage')}
        </ButtonLink>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
        <StatTile
          variant="flat"
          href={reserveHistoryHref()}
          icon={Banknote}
          label={tp('sumsPot')}
          value={formatCurrency(reserveSumsHeld(balances))}
          unit={tc('currency')}
        />
        <StatTile
          variant="flat"
          href={reserveHref()}
          icon={DollarSign}
          label={tp('dollarsPot')}
          value={formatDollars(dollarsHeld)}
        />
      </div>

      <ul className="divide-y divide-gray-100">
        {OWNER_WITHDRAWAL_SOURCES.map((source) => (
          <li key={source} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <IconChip icon={SOURCE_ICONS[source]} tone={SOURCE_TONES[source]} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{t(`sources.${source}`)}</p>
                <p className="text-xs text-gray-500">{t('leftInMonth', { month: monthLabel, amount: formatCurrency(depositAllAmounts[source]) })}</p>
              </div>
            </div>
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
          </li>
        ))}
      </ul>
    </>
  );
}

/** The reserve card while owner profit loads: its heading, the two accounts and one row per side. */
export function ReserveSectionSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-surface shadow-card" aria-hidden="true">
      <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-4 sm:px-5">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <HeadingSkeleton action className="min-w-0 flex-1" />
      </div>
      <div className="grid grid-cols-2 gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
        {[0, 1].map((index) => (
          <div key={index} className="space-y-2 py-1">
            <Skeleton className="h-3 w-24 max-w-full bg-gray-100" />
            <Skeleton className="h-5 w-32 max-w-full" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-gray-100">
        {OWNER_WITHDRAWAL_SOURCES.map((source) => (
          <div key={source} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40 max-w-full bg-gray-100" />
              </div>
            </div>
            <Skeleton className="h-8 w-32 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
