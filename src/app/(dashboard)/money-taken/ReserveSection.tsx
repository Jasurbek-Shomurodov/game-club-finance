'use client';

import { ArrowDownToLine, ChartColumn, PiggyBank } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, ButtonLink, IconChip, SectionHeading, StatTile } from '@/components/PresentationFoundation';
import type { ReserveBalance } from '@/lib/calculations/ownerReserve';
import { reserveHistoryHref } from '@/lib/detailLinks';
import { formatCurrency, formatUnitCurrency } from '@/lib/formatters';
import { OWNER_WITHDRAWAL_SOURCES, type OwnerWithdrawalSource } from '@/types';
import { SOURCE_ICONS, SOURCE_TONES } from './profitIcons';

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
 * The owner reserve on Owner Profit: its balance as a link, and the one thing
 * that belongs to this page, putting what is left of the month into it.
 * Returning, paying, charts and history live on /reserve.
 */
export function ReserveSection({ balances, depositAllAmounts, monthLabel, dollarsHeld, busyId, disabled, onDepositAll }: ReserveSectionProps) {
  const t = useTranslations('ownerReserve');
  const tc = useTranslations('common');
  const held = balances.game_club.held + balances.bar.held;

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

      <div className="border-b border-gray-100 px-4 py-3 sm:px-5">
        <StatTile
          variant="flat"
          href={reserveHistoryHref()}
          label={t('held')}
          value={formatCurrency(held)}
          unit={(
            <>
              {tc('currency')}
              {dollarsHeld !== 0 ? <span className="tabular-nums"> · {dollarsHeld < 0 ? '−' : ''}${formatUnitCurrency(Math.abs(dollarsHeld))}</span> : null}
            </>
          )}
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
