'use client';

import type { ReactNode } from 'react';
import { DollarSign, Package, ReceiptText, TrendingDown, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  MetricCard,
  MetricGridSkeleton,
  MetricMoney,
  SectionHeading,
  Skeleton,
  metricGridClassName,
  toneForAmount,
  type MetricTone,
} from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';

/** The game club's figures, in the order they are shown. */
const GAME_CLUB_KINDS = ['manualIncome', 'debtIncome', 'gameClubIncome', 'gameClubExpenses', 'gameClubProfit'] as const;
/** The bar's figures: profit first (sales, cost, expenses), then its cash (purchases, cash left). */
const BAR_KINDS = ['barSales', 'costOfGoodsSold', 'barExpenses', 'barProfit', 'inventoryPurchases', 'barCashLeft'] as const;

export type ReportTotalKind = (typeof GAME_CLUB_KINDS)[number] | (typeof BAR_KINDS)[number];

export interface ReportTotalFigure {
  label: string;
  amount: number;
  /** The records behind the figure; leave out when the viewer may not open them. */
  href?: string;
}

/** What each figure is, so the day and the month report draw it the same way. `signed` takes its tone from the amount. */
const KIND_LOOK: Record<ReportTotalKind, { icon: LucideIcon; tone: MetricTone | 'signed' }> = {
  manualIncome: { icon: TrendingUp, tone: 'success' },
  debtIncome: { icon: Users, tone: 'success' },
  gameClubIncome: { icon: TrendingUp, tone: 'success' },
  gameClubExpenses: { icon: ReceiptText, tone: 'danger' },
  gameClubProfit: { icon: DollarSign, tone: 'signed' },
  barSales: { icon: TrendingUp, tone: 'success' },
  costOfGoodsSold: { icon: TrendingDown, tone: 'danger' },
  barExpenses: { icon: ReceiptText, tone: 'danger' },
  barProfit: { icon: DollarSign, tone: 'signed' },
  inventoryPurchases: { icon: Package, tone: 'danger' },
  barCashLeft: { icon: Wallet, tone: 'signed' },
};

/** Columns on wide screens follow the number of cards, so no row ends in a lone card. */
const WIDE_COLUMNS: Record<number, string> = {
  1: 'lg:grid-cols-1 xl:grid-cols-1',
  2: 'lg:grid-cols-2 xl:grid-cols-2',
  3: 'lg:grid-cols-3 xl:grid-cols-3',
  4: 'lg:grid-cols-4 xl:grid-cols-4',
  5: 'lg:grid-cols-5 xl:grid-cols-5',
  6: 'lg:grid-cols-3 xl:grid-cols-3',
};

const groupGridClassName = (count: number) => cn(metricGridClassName, 'sm:gap-4', WIDE_COLUMNS[count] ?? 'lg:grid-cols-4 xl:grid-cols-4');

/**
 * A report's totals as two labelled groups, the game club and the bar: they are
 * separate businesses and are never added together. The daily and the monthly
 * report share it, so the same figure has the same place, icon and colour in both.
 */
export function ReportTotals({ figures, currency, barNote }: {
  /** The figures this report has; a kind left out is not drawn. */
  figures: Partial<Record<ReportTotalKind, ReportTotalFigure>>;
  currency: string;
  /** One line under the bar heading (how bar cash left is counted). */
  barNote?: ReactNode;
}) {
  const t = useTranslations('dashboard');

  const group = (title: string, kinds: readonly ReportTotalKind[], description?: ReactNode) => {
    const shown = kinds.filter((kind) => figures[kind]);
    if (!shown.length) return null;
    return (
      <section className="space-y-3">
        <SectionHeading size="sm" title={title} description={description} />
        <div className={groupGridClassName(shown.length)}>
          {shown.map((kind) => {
            const figure = figures[kind]!;
            const { icon, tone } = KIND_LOOK[kind];
            return (
              <MetricCard
                key={kind}
                href={figure.href}
                label={figure.label}
                value={<MetricMoney amount={figure.amount} currency={currency} />}
                icon={icon}
                tone={tone === 'signed' ? toneForAmount(figure.amount) : tone}
              />
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-5">
      {group(t('gameClub'), GAME_CLUB_KINDS)}
      {group(t('bar'), BAR_KINDS, barNote)}
    </div>
  );
}

/** The two groups while the report loads: `gameClubCount` game club cards, then the bar's six. */
export function ReportTotalsSkeleton({ gameClubCount }: { gameClubCount: number }) {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <MetricGridSkeleton count={gameClubCount} className={groupGridClassName(gameClubCount)} />
      </div>
      <div className="space-y-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-80 max-w-full bg-gray-100" />
        </div>
        <MetricGridSkeleton count={BAR_KINDS.length} className={groupGridClassName(BAR_KINDS.length)} />
      </div>
    </div>
  );
}
