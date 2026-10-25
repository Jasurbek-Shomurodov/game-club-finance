'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/PresentationFoundation';
import { ChartCard, chartColors } from '@/components/dashboard/ChartCard';
import { cn } from '@/lib/utils';
import { capitalizeFirst, formatCurrency, formatMonthShort, formatYearMonth } from '@/lib/formatters';
import type { AvailableSourceBalance } from '@/lib/calculations/availableMoney';
import type { ProfitMonthRow } from '@/lib/calculations/analysisSeries';
import type { SourceIndicators } from '@/lib/calculations/financialAnalysis';
import { formatCompactMoney, formatShare } from './analysisFormat';

type Side = 'gameClub' | 'bar';

const SIDE_COLOR: Record<Side, string> = { gameClub: chartColors.primary, bar: chartColors.orange };

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function LegendRow({ color, label, amount, note, currency, tone }: {
  color: string;
  label: string;
  amount: number;
  note?: string;
  currency: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className={cn(
          'whitespace-nowrap text-base font-semibold tabular-nums',
          tone === 'success' ? 'text-success-600' : tone === 'danger' ? 'text-danger-600' : 'text-gray-950',
        )}
        >
          {formatCurrency(amount)} <span className="text-xs font-medium text-gray-500">{currency}</span>
        </p>
        {note && <p className="text-xs text-gray-500">{note}</p>}
      </div>
    </div>
  );
}

/** Tiny profit-per-month bars: green above the line for a profit, red below it for a loss. */
function ProfitSparkBars({ months, locale, currency }: { months: ProfitMonthRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const shown = months.slice(-12);
  const peak = Math.max(1, ...shown.map((row) => Math.abs(row.profit)));
  const hasLoss = shown.some((row) => row.profit < 0);
  return (
    <div className="min-w-0 flex-1 basis-56">
      <p className="text-xs text-gray-500">{t('summaryProfitByMonth')}</p>
      <div className={cn('mt-2 flex gap-1.5', hasLoss ? 'h-20' : 'h-16')}>
        {shown.map((row) => {
          const height = `${(Math.abs(row.profit) / peak) * (hasLoss ? 50 : 100)}%`;
          const title = `${capitalizeFirst(formatYearMonth(row.month.slice(0, 7), locale), locale)}: ${formatCurrency(row.profit)} ${currency}`;
          return (
            <div key={row.month} className="flex min-w-0 flex-1 flex-col" title={title} role="img" aria-label={title}>
              <div className={cn('flex flex-col justify-end', hasLoss ? 'h-1/2' : 'h-full')}>
                {row.profit >= 0 && <span className="w-full rounded-t-[3px]" style={{ height, backgroundColor: chartColors.success }} />}
              </div>
              {hasLoss && (
                <div className="flex h-1/2 flex-col border-t" style={{ borderColor: chartColors.grid }}>
                  {row.profit < 0 && <span className="w-full rounded-b-[3px]" style={{ height, backgroundColor: chartColors.danger }} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 text-[10px] text-gray-500" aria-hidden="true">
        {shown.map((row) => <span key={row.month} className="min-w-0 flex-1 truncate text-center">{formatMonthShort(row.month, locale)}</span>)}
      </div>
    </div>
  );
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * One side's all-time money in as a ring: the red arc is what was spent, the
 * green arc what was left as profit. A loss fills the ring red.
 */
export function SideSummaryCard({ side, title, icon: Icon, incomeLabel, data, months, help, loading, locale, currency }: {
  side: Side;
  help?: string;
  months: ProfitMonthRow[];
  title: string;
  icon: LucideIcon;
  incomeLabel: string;
  data: SourceIndicators;
  loading: boolean;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const spentShare = data.income > 0 ? Math.min(1, data.spent / data.income) : 0;
  const profitShare = data.income > 0 ? Math.max(0, data.left) / data.income : 0;
  const loss = data.left < 0;
  const ringLabel = t('summaryRingLabel', {
    income: formatCurrency(data.income),
    spent: formatCurrency(data.spent),
    profit: formatCurrency(data.left),
    currency,
  });

  return (
    <ChartCard title={title} help={help} action={<Icon size={18} className="shrink-0" style={{ color: SIDE_COLOR[side] }} aria-hidden="true" />}>
      {loading ? (
        <div className="mt-4 flex items-center gap-6">
          <Skeleton className="h-28 w-28 shrink-0 rounded-full sm:h-32 sm:w-32" />
          <div className="flex-1 space-y-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        </div>
      ) : (
        // Every row wraps by the card's own width, not the screen's: the card is half
        // the page on a desktop and the whole page on a phone.
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-5">
        <div className="flex min-w-0 flex-1 basis-72 flex-wrap items-center justify-center gap-x-5 gap-y-4">
          <svg viewBox="0 0 132 132" className="h-28 w-28 shrink-0 sm:h-32 sm:w-32" role="img" aria-label={ringLabel}>
            <circle cx="66" cy="66" r={RADIUS} fill="none" stroke={chartColors.cursor} strokeWidth="14" />
            <g transform="rotate(-90 66 66)">
              <circle
                cx="66"
                cy="66"
                r={RADIUS}
                fill="none"
                stroke={chartColors.danger}
                strokeWidth="14"
                strokeDasharray={`${CIRCUMFERENCE * spentShare} ${CIRCUMFERENCE}`}
              />
              {profitShare > 0 && (
                <circle
                  cx="66"
                  cy="66"
                  r={RADIUS}
                  fill="none"
                  stroke={chartColors.success}
                  strokeWidth="14"
                  strokeDasharray={`${CIRCUMFERENCE * profitShare} ${CIRCUMFERENCE}`}
                  strokeDashoffset={-CIRCUMFERENCE * spentShare}
                />
              )}
            </g>
            <text x="66" y="60" textAnchor="middle" className="fill-gray-500" style={{ fontSize: 10 }}>
              {t('margin')}
            </text>
            <text
              x="66"
              y="80"
              textAnchor="middle"
              style={{ fontSize: 20, fontWeight: 700, fill: loss ? chartColors.danger : chartColors.success }}
            >
              {formatShare(data.marginPct, locale)}
            </text>
          </svg>
          <div className="grid min-w-0 flex-1 basis-40 gap-3">
            <LegendRow color={SIDE_COLOR[side]} label={incomeLabel} amount={data.income} currency={currency} />
            <LegendRow
              color={chartColors.danger}
              label={t('spent')}
              amount={data.spent}
              note={t('summaryShareOfIncome', { share: formatShare(share(data.spent, data.income), locale) })}
              currency={currency}
              tone="danger"
            />
            <LegendRow
              color={loss ? chartColors.danger : chartColors.success}
              label={t('profit')}
              amount={data.left}
              note={t('summaryShareOfIncome', { share: formatShare(data.marginPct, locale) })}
              currency={currency}
              tone={loss ? 'danger' : 'success'}
            />
          </div>
        </div>
        {months.length > 1 && <ProfitSparkBars months={months} locale={locale} currency={currency} />}
        </div>
      )}
    </ChartCard>
  );
}

/** One side's owner profit as a bar: earned, split into withdrawn and still left to take. */
function OwnerBalanceBar({ side, label, icon: Icon, balance, locale, currency }: {
  side: Side;
  label: string;
  icon: LucideIcon;
  balance: AvailableSourceBalance;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const overdrawn = balance.available < 0;
  const scale = Math.max(balance.earned, balance.withdrawn, 1);
  const withdrawnWidth = (Math.min(balance.withdrawn, scale) / scale) * 100;
  const leftWidth = (Math.max(0, balance.available) / scale) * 100;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Icon size={16} style={{ color: SIDE_COLOR[side] }} aria-hidden="true" />
          {label}
        </p>
        <p className="text-xs text-gray-500">
          {t('ownerEarned')}{' '}
          <span className="font-semibold tabular-nums text-gray-900">{formatCurrency(balance.earned)} {currency}</span>
        </p>
      </div>
      <div
        className="flex h-4 overflow-hidden rounded-full bg-gray-100"
        role="img"
        aria-label={t('ownerBarLabel', {
          earned: formatCurrency(balance.earned),
          withdrawn: formatCurrency(balance.withdrawn),
          left: formatCurrency(balance.available),
          currency,
        })}
      >
        <span className="h-full" style={{ width: `${withdrawnWidth}%`, backgroundColor: SIDE_COLOR[side] }} />
        <span className="h-full" style={{ width: `${leftWidth}%`, backgroundColor: chartColors.success }} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 text-gray-500">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: SIDE_COLOR[side] }} aria-hidden="true" />
          {t('ownerWithdrawn')}
          <span className="font-semibold tabular-nums text-gray-900">{formatCompactMoney(balance.withdrawn, locale)}</span>
        </span>
        <span className={cn('inline-flex items-center gap-1.5', overdrawn ? 'text-danger-600' : 'text-gray-500')}>
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: overdrawn ? chartColors.danger : chartColors.success }} aria-hidden="true" />
          {overdrawn ? t('ownerOverdrawn') : t('ownerLeft')}
          <span className={cn('font-semibold tabular-nums', overdrawn ? 'text-danger-600' : 'text-success-600')}>
            {formatCurrency(Math.abs(balance.available))} {currency}
          </span>
        </span>
      </div>
    </div>
  );
}

export function OwnerBalanceCard({ sides, help, loading, locale, currency }: {
  help?: string;
  sides: Array<{ side: Side; label: string; icon: LucideIcon; balance: AvailableSourceBalance }>;
  loading: boolean;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  return (
    <ChartCard title={t('ownerBalanceTitle')} description={t('ownerBalanceDesc')} help={help}>
      <div className="mt-5 space-y-6">
        {sides.map((entry) => (loading
          ? <Skeleton key={entry.side} className="h-16" />
          : <OwnerBalanceBar key={entry.side} {...entry} locale={locale} currency={currency} />))}
      </div>
    </ChartCard>
  );
}

/** Below the app's top bar (3.5rem plus the phone's safe area), with a little air. */
const NAV_OFFSET_GAP = 12;

/**
 * Chips that jump to each part of the overall analysis. The row sticks under
 * the app's top bar while the page scrolls and marks the section in view.
 */
export function SectionNav({ items, label }: { items: Array<{ id: string; label: string }>; label: string }) {
  const navRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(items[0]?.id ?? '');

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const bottom = (navRef.current?.getBoundingClientRect().bottom ?? 0) + NAV_OFFSET_GAP;
      let current = items[0]?.id ?? '';
      for (const item of items) {
        const section = document.getElementById(item.id);
        if (section && section.getBoundingClientRect().top <= bottom) current = item.id;
      }
      // At the very bottom the last short sections can never reach the top; mark the last one.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = items.at(-1)?.id ?? current;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [items]);

  // Keep the marked chip visible when the row scrolls sideways on a phone.
  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!nav || !chip) return;
    const left = chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [active]);

  const jump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const section = document.getElementById(id);
    if (!section) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const top = section.getBoundingClientRect().top + window.scrollY
      - (navRef.current?.getBoundingClientRect().bottom ?? 0) - NAV_OFFSET_GAP + 1;
    window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${id}`);
    setActive(id);
  };

  return (
    <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 bg-gray-50/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:top-14 lg:-mx-8 lg:px-8">
      <nav ref={navRef} aria-label={label} className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none]">
        {items.map((item) => {
          const current = item.id === active;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              data-section={item.id}
              aria-current={current ? 'location' : undefined}
              onClick={(event) => jump(event, item.id)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                current
                  ? 'border-primary-600 bg-primary-600 text-on-accent'
                  : 'border-gray-200 bg-surface text-gray-700 hover:border-primary-300 hover:text-primary-700',
              )}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
