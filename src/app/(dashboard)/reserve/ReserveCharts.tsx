'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { chartColors, chartTooltipStyle, formatAxis } from '@/components/dashboard/ChartCard';
import { axisProps, LegendItem } from '@/components/financial-analysis/AnalysisTimeCharts';
import { capitalizeFirst, formatCurrency, formatDateOnly, formatDateShort, formatMonthShort, formatYearMonth } from '@/lib/formatters';
import type { ReserveDayRow, ReserveMonthRow } from '@/lib/calculations/ownerReserve';

interface ChartProps {
  rows: ReserveMonthRow[];
  locale: string;
  currency: string;
}

function Frame({ children }: { children: ReactElement }) {
  return (
    <div className="mt-3 h-64">
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

const tick = (locale: string) => (month: string) => formatMonthShort(`${month}-01`, locale);
const title = (locale: string) => (month: unknown) => capitalizeFirst(formatYearMonth(String(month), locale), locale);
const money = (currency: string, names: Record<string, string>) => (
  (value: unknown, name: unknown) => [`${formatCurrency(Number(value))} ${currency}`, names[String(name)] ?? String(name)] as [string, string]
);

const dayTick = (locale: string) => (date: string) => formatDateShort(date, locale);
const dayTitle = (locale: string) => (date: unknown) => formatDateOnly(String(date), locale);

/** What the reserve held at the end of every day, as one pot whatever side the money came from. */
export function ReserveBalanceChart({ rows, locale, currency }: { rows: ReserveDayRow[]; locale: string; currency: string }) {
  const t = useTranslations('reservePage');
  return (
    <Frame>
      <AreaChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="reserve-held" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.35} />
            <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={chartColors.grid} vertical={false} />
        <XAxis dataKey="date" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={24} tickFormatter={dayTick(locale)} />
        <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
        <Tooltip {...chartTooltipStyle} labelFormatter={dayTitle(locale)} formatter={money(currency, { held: t('totalHeld') })} />
        <Area dataKey="held" type="stepAfter" stroke={chartColors.primary} strokeWidth={2} fill="url(#reserve-held)" />
      </AreaChart>
    </Frame>
  );
}

/** Money put in and money taken out of the reserve, month by month. */
export function ReserveFlowChart({ rows, locale, currency }: ChartProps) {
  const t = useTranslations('reservePage');
  const names: Record<string, string> = { deposited: t('putIn'), withdrawn: t('takenOut') };
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-gray-500">
        <LegendItem color={chartColors.success} label={names.deposited} />
        <LegendItem color={chartColors.danger} label={names.withdrawn} />
      </div>
      <Frame>
        <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="month" {...axisProps} axisLine={{ stroke: chartColors.grid }} minTickGap={12} tickFormatter={tick(locale)} />
          <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(value: number) => formatAxis(value, locale)} />
          <Tooltip {...chartTooltipStyle} cursor={{ fill: chartColors.cursor }} labelFormatter={title(locale)} formatter={money(currency, names)} />
          <Bar dataKey="deposited" fill={chartColors.success} radius={[3, 3, 0, 0]} maxBarSize={24} />
          <Bar dataKey="withdrawn" fill={chartColors.danger} fillOpacity={0.8} radius={[3, 3, 0, 0]} maxBarSize={24} />
        </BarChart>
      </Frame>
    </>
  );
}
