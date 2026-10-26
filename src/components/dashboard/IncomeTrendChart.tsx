'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatCurrency } from '@/lib/formatters';
import { ChartCard, chartColors, chartTooltipStyle, formatAxis } from './ChartCard';

interface IncomeTrendChartProps {
  /** Each side's money in per day; the game club and the bar are never summed. */
  data: Array<{ date: string; gameClubIncome: number; barSales: number; gameClubAverage?: number | null; barAverage?: number | null }>;
  /** Optional header link, e.g. to the full financial analysis. */
  link?: ReactNode;
}

export function IncomeTrendChart({ data, link }: IncomeTrendChartProps) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const seriesNames: Record<string, string> = {
    gameClubIncome: t('gameClubIncome'),
    barSales: t('barSales'),
    gameClubAverage: t('gameClubDailyAverage'),
    barAverage: t('barDailyAverage'),
  };

  return (
    <ChartCard
      title={t('incomeTrend')}
      action={(
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-gray-500">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-primary-600" aria-hidden="true" />
            {seriesNames.gameClubIncome}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-500" aria-hidden="true" />
            {seriesNames.barSales}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-3 border-t-2 border-dashed border-primary-600" aria-hidden="true" />
            {seriesNames.gameClubAverage}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-3 border-t-2 border-dashed border-orange-500" aria-hidden="true" />
            {seriesNames.barAverage}
          </span>
          {link}
        </div>
      )}
    >
      <div className="mt-3 h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
            barGap={2}
            barCategoryGap="25%"
          >
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: chartColors.axis }}
              tickLine={false}
              axisLine={{ stroke: chartColors.grid }}
              minTickGap={16}
            />
            <YAxis
              tickFormatter={(value: number) => formatAxis(value, locale)}
              tick={{ fontSize: 11, fill: chartColors.axis }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              {...chartTooltipStyle}
              cursor={{ fill: chartColors.cursor }}
              formatter={(value, name) => [`${formatCurrency(Number(value))} ${currency}`, seriesNames[String(name)] ?? String(name)]}
            />
            <Bar dataKey="gameClubIncome" name="gameClubIncome" fill={chartColors.primary} radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Bar dataKey="barSales" name="barSales" fill={chartColors.orange} radius={[3, 3, 0, 0]} maxBarSize={28} />
            {/* Running averages through each day; they stop after a side's latest entry. */}
            <Line dataKey="gameClubAverage" name="gameClubAverage" type="monotone" stroke={chartColors.primary} strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            <Line dataKey="barAverage" name="barAverage" type="monotone" stroke={chartColors.orange} strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
