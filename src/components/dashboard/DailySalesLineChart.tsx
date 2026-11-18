'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatCurrency } from '@/lib/formatters';
import type { DailySalesLineRow } from '@/lib/calculations/dashboardMetrics';
import { ChartCard, chartColors, chartTooltipStyle, formatAxis } from './ChartCard';

interface DailySalesLineChartProps {
  /** One row per day; the date is already formatted for the axis. */
  data: DailySalesLineRow[];
}

const SERIES = [
  { key: 'gameClub', color: chartColors.primary },
  { key: 'playstation', color: chartColors.purple },
  { key: 'bar', color: chartColors.orange },
] as const;

/** Each day's Game Club, PlayStation and bar sales as three lines over the selected range. */
export function DailySalesLineChart({ data }: DailySalesLineChartProps) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const seriesNames: Record<string, string> = {
    gameClub: t('gameClubIncome'),
    playstation: t('playstationIncome'),
    bar: t('barSales'),
  };

  return (
    <ChartCard
      title={t('dailySales')}
      help={t('dailySalesHelp')}
      action={(
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-gray-500">
          {SERIES.map((series) => (
            <span key={series.key} className="inline-flex items-center gap-2">
              <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: series.color }} aria-hidden="true" />
              {seriesNames[series.key]}
            </span>
          ))}
        </div>
      )}
    >
      <div className="mt-3 h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              cursor={{ stroke: chartColors.grid }}
              formatter={(value, name) => [`${formatCurrency(Number(value))} ${currency}`, seriesNames[String(name)] ?? String(name)]}
            />
            {SERIES.map((series) => (
              <Line
                key={series.key}
                dataKey={series.key}
                name={series.key}
                type="monotone"
                stroke={series.color}
                strokeWidth={2.5}
                dot={{ r: 2.5, strokeWidth: 0, fill: series.color }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
