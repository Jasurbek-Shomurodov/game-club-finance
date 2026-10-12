'use client';

import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/PresentationFoundation';
import { ChartEmpty, chartColors } from '@/components/dashboard/ChartCard';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type {
  CategoryAmount,
  CategoryComparisonRow,
  PaymentMethodFlowRow,
} from '@/lib/calculations/financialAnalysis';
import type { ExpenseRow } from '@/lib/calculations/dashboardMetrics';
import { formatCompactMoney, formatShare } from './analysisFormat';

interface CommonProps {
  locale: string;
  currency: string;
}

/** Donut of expense categories with a hover-linked legend. */
export function CategoryDonut({
  categories,
  colors,
  total,
  labelFor,
  locale,
  currency,
}: CommonProps & {
  categories: CategoryAmount[];
  colors: Record<string, string>;
  total: number;
  labelFor: (category: string) => string;
}) {
  const t = useTranslations('financialAnalysis');
  const [hovered, setHovered] = useState<string | null>(null);
  if (!total) return <ChartEmpty title={t('noExpenses')} className="mt-4" />;

  const size = 200;
  const radius = 78;
  const stroke = 30;
  const circumference = 2 * Math.PI * radius;
  const gap = categories.length > 1 ? 2 : 0;
  const active = categories.find((row) => row.category === hovered);
  const segments = categories.map((row, index) => ({
    row,
    length: (row.amount / total) * circumference,
    offset: categories.slice(0, index).reduce((sum, previous) => sum + (previous.amount / total) * circumference, 0),
  }));

  return (
    <div className="mt-4 flex flex-col items-center gap-5 xl:flex-row xl:items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-48 w-48 shrink-0" role="img" aria-label={t('categoriesTitle')}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segments.map(({ row, length, offset }) => (
              <circle
                key={row.category}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={colors[row.category] ?? chartColors.gray}
                strokeWidth={hovered === row.category ? stroke + 6 : stroke}
                strokeDasharray={`${Math.max(0.5, length - gap)} ${circumference}`}
                strokeDashoffset={-offset}
                opacity={hovered && hovered !== row.category ? 0.35 : 1}
                className="transition-[opacity,stroke-width]"
                onMouseEnter={() => setHovered(row.category)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${labelFor(row.category)}: ${formatCurrency(row.amount)} ${currency}`}</title>
              </circle>
          ))}
        </g>
        <text x={size / 2} y={size / 2 - 6} textAnchor="middle" className="fill-current text-[11px] font-medium text-gray-500">
          {active ? labelFor(active.category).slice(0, 22) : t('spentTotal')}
        </text>
        <text x={size / 2} y={size / 2 + 15} textAnchor="middle" className="fill-current text-[18px] font-bold text-gray-950">
          {formatCompactMoney(active ? active.amount : total, locale)}
        </text>
      </svg>
      <ul className="w-full min-w-0 space-y-0.5">
        {categories.map((row) => (
          <li
            key={row.category}
            onMouseEnter={() => setHovered(row.category)}
            onMouseLeave={() => setHovered(null)}
            className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors', hovered === row.category && 'bg-gray-100')}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colors[row.category] ?? chartColors.gray }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-gray-700">{labelFor(row.category)}</span>
            <span className="text-xs font-medium tabular-nums text-gray-400">{formatShare(row.share, locale)}</span>
            <span className="w-28 text-right font-semibold tabular-nums text-gray-950">
              {formatCurrency(row.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Each category this period against the previous one, largest first. */
export function CategoryComparison({
  rows,
  colors,
  labelFor,
  locale,
  currency,
}: CommonProps & {
  rows: CategoryComparisonRow[];
  colors: Record<string, string>;
  labelFor: (category: string) => string;
}) {
  const t = useTranslations('financialAnalysis');
  if (!rows.length) return <ChartEmpty title={t('noExpenses')} className="mt-4" />;
  const max = Math.max(...rows.map((row) => Math.max(row.current, row.previous)), 1);

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center gap-4 text-xs font-medium text-gray-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-gray-700" aria-hidden="true" />{t('current')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-gray-300" aria-hidden="true" />{t('previous')}</span>
      </div>
      <ul className="max-h-[340px] space-y-3 overflow-y-auto overscroll-contain pr-2 [scrollbar-gutter:stable]">
        {rows.map((row) => {
          const up = row.change > 0;
          const Icon = up ? ArrowUpRight : ArrowDownRight;
          return (
            <li
              key={row.category}
              aria-label={`${labelFor(row.category)}: ${t('current')} ${formatCurrency(row.current)} ${currency}, ${t('previous')} ${formatCurrency(row.previous)} ${currency}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-gray-700">{labelFor(row.category)}</span>
                <Badge variant={row.change === 0 ? 'neutral' : up ? 'danger' : 'success'} className="shrink-0 tabular-nums">
                  {row.change !== 0 && <Icon size={11} aria-hidden="true" />}
                  {row.changePct === null ? t('newItem') : formatShare(Math.abs(row.changePct), locale)}
                  <span className="ml-1 opacity-80">
                    {row.change > 0 ? '+' : row.change < 0 ? '−' : ''}{formatCompactMoney(Math.abs(row.change), locale)}
                  </span>
                </Badge>
              </div>
              <div className="space-y-0.5" aria-hidden="true">
                <div className="h-2 rounded-r" style={{ width: `${Math.max(0.5, (row.current / max) * 100)}%`, backgroundColor: colors[row.category] ?? chartColors.gray }} />
                <div className="h-2 rounded-r bg-gray-300" style={{ width: `${Math.max(0.5, (row.previous / max) * 100)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Game Club money in and out per payment method, with what is left. */
export function PaymentMethodFlow({
  rows,
  methodLabel,
  locale,
  currency,
}: CommonProps & {
  rows: PaymentMethodFlowRow[];
  methodLabel: (method: PaymentMethodFlowRow['method']) => string;
}) {
  const t = useTranslations('financialAnalysis');
  const visible = rows.filter((row) => row.income > 0 || row.expenses > 0);
  if (!visible.length) return <ChartEmpty title={t('empty')} className="mt-4" />;
  const max = Math.max(...visible.map((row) => Math.max(row.income, row.expenses)), 1);

  return (
    <div className="mt-4 space-y-3">
      {visible.map((row) => (
        <div key={row.method} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-gray-950">{methodLabel(row.method)}</span>
            <span className={cn('whitespace-nowrap text-sm font-semibold tabular-nums', row.left < 0 ? 'text-danger-600' : 'text-success-600')}>
              {formatCurrency(row.left)} <span className="text-xs font-medium text-gray-500">{currency}</span>
            </span>
          </div>
          {([
            [t('moneyIn'), row.income, chartColors.success],
            [t('spent'), row.expenses, chartColors.danger],
          ] as const).map(([label, amount, color]) => (
            <div key={label} className="mb-1.5" aria-label={`${label}: ${formatCurrency(amount)} ${currency}`}>
              <div className="mb-0.5 flex justify-between text-xs text-gray-500">
                <span>{label}</span>
                <span className="tabular-nums">{formatCompactMoney(amount, locale)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${(amount / max) * 100}%`, backgroundColor: color }} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The biggest single payments of the period. */
export function LargestPayments({
  rows,
  colors,
  labelFor,
  locale,
  currency,
}: CommonProps & {
  rows: ExpenseRow[];
  colors: Record<string, string>;
  labelFor: (category: string) => string;
}) {
  const t = useTranslations('financialAnalysis');
  if (!rows.length) return <ChartEmpty title={t('noExpenses')} className="mt-4" />;
  const max = Math.max(...rows.map((row) => Number(row.amount ?? 0)), 1);

  return (
    <ul className="mt-3 divide-y divide-gray-100">
      {rows.map((row) => {
        const amount = Number(row.amount ?? 0);
        return (
          <li key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-950">
                {labelFor(row.category)}
                {row.comment && <span className="font-normal text-gray-500"> · {row.comment}</span>}
              </p>
              <p className="text-xs text-gray-500">
                {formatDateShort(row.date, locale)} · {row.payment_source === 'bar' ? t('paidFromBar') : t('paidFromGameClub')}
              </p>
            </div>
            <p className="text-right text-sm font-semibold tabular-nums text-gray-950">
              {formatCurrency(amount)} <span className="text-xs font-medium text-gray-500">{currency}</span>
            </p>
            <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${(amount / max) * 100}%`, backgroundColor: colors[row.category] ?? chartColors.gray }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
