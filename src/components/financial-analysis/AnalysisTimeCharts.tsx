'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslations } from 'next-intl';
import { chartColors, formatAxis } from '@/components/dashboard/ChartCard';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import {
  SPENDING_GROUPS,
  type DailyAnalysisRow,
  type MonthlyAnalysisRow,
} from '@/lib/calculations/financialAnalysis';
import { SPENDING_GROUP_COLORS } from './analysisFormat';

function LegendItem({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {line
        ? <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        : <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />}
      {label}
    </span>
  );
}

const axisProps = {
  tick: { fontSize: 11, fill: chartColors.axis },
  tickLine: false,
} as const;

/** Stacked daily spending (by where it went) with the day's income as a line. */
export function DailyFlowChart({ data, locale, currency }: { data: DailyAnalysisRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = {
    income: t('income'),
    barCost: t('barCost'),
    gameClubExpenses: t('gameClubExpenses'),
    barExpenses: t('barExpenses'),
  };
  const chartData = data.map((row) => ({ ...row, label: formatDateShort(row.date, locale) }));

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-gray-500">
        {SPENDING_GROUPS.map((group) => <LegendItem key={group} color={SPENDING_GROUP_COLORS[group]} label={names[group]} />)}
        <LegendItem color={chartColors.success} label={names.income} line />
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart accessibilityLayer data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={16} />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
            <Tooltip
              cursor={{ fill: chartColors.cursor }}
              formatter={(value, name) => [`${formatCurrency(Number(value))} ${currency}`, names[String(name)] ?? String(name)]}
              labelStyle={{ fontWeight: 600 }}
            />
            {SPENDING_GROUPS.map((group, index) => (
              <Bar
                key={group}
                dataKey={group}
                stackId="spent"
                fill={SPENDING_GROUP_COLORS[group]}
                fillOpacity={0.85}
                maxBarSize={28}
                radius={index === SPENDING_GROUPS.length - 1 ? [3, 3, 0, 0] : undefined}
              />
            ))}
            <Line dataKey="income" type="monotone" stroke={chartColors.success} strokeWidth={2} dot={data.length <= 14 ? { r: 2.5 } : false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function monthLabel(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}T00:00:00Z`));
}

/** Income and spending per month with accounting profit as a line. */
export function MonthlyTrendChart({ data, locale, currency }: { data: MonthlyAnalysisRow[]; locale: string; currency: string }) {
  const t = useTranslations('financialAnalysis');
  const names: Record<string, string> = { income: t('income'), spent: t('spent'), profit: t('profit') };
  const monthTitle = (month: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}T00:00:00Z`));

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-gray-500">
        <LegendItem color={chartColors.primary} label={names.income} />
        <LegendItem color={chartColors.danger} label={names.spent} />
        <LegendItem color={chartColors.success} label={names.profit} line />
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart accessibilityLayer data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis
              dataKey="month"
              {...axisProps}
              axisLine={{ stroke: chartColors.grid }}
              interval={0}
              tickFormatter={(month: string) => monthLabel(month, locale)}
            />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
            <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.4} />
            <Tooltip
              cursor={{ fill: chartColors.cursor }}
              labelFormatter={(month) => monthTitle(String(month))}
              formatter={(value, name) => [`${formatCurrency(Number(value))} ${currency}`, names[String(name)] ?? String(name)]}
              labelStyle={{ fontWeight: 600 }}
            />
            <Bar dataKey="income" fill={chartColors.primary} radius={[3, 3, 0, 0]} maxBarSize={24} />
            <Bar dataKey="spent" fill={chartColors.danger} fillOpacity={0.6} radius={[3, 3, 0, 0]} maxBarSize={24} />
            <Line dataKey="profit" type="monotone" stroke={chartColors.success} strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
