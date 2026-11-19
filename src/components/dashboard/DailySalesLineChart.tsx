'use client';

import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { SIDE_ICONS } from '@/components/sideIcons';
import type { DailySalesLineRow } from '@/lib/calculations/dashboardMetrics';
import {
  CHART_Y_AXIS_WIDTH,
  ChartCard,
  ChartLegendToggle,
  ChartTooltipBody,
  chartColors,
  formatAxis,
  seriesOpacity,
  seriesTotal,
  useSeriesVisibility,
} from './ChartCard';

interface DailySalesLineChartProps {
  /** One row per day; the date is already formatted for the axis. */
  data: DailySalesLineRow[];
}

const SERIES = [
  { key: 'gameClub', color: chartColors.primary, icon: SIDE_ICONS.gameClub },
  { key: 'playstation', color: chartColors.purple, icon: SIDE_ICONS.playstation },
  { key: 'bar', color: chartColors.orange, icon: SIDE_ICONS.bar },
] as const;

const SERIES_KEYS = SERIES.map((series) => series.key);

/** Each day's Game Club, PlayStation and bar sales as three lines; tap a legend pill to hide or show one. */
export function DailySalesLineChart({ data }: DailySalesLineChartProps) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const gradientId = useId().replace(/:/g, '');
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const seriesNames: Record<string, string> = {
    gameClub: t('gameClubIncome'),
    playstation: t('playstationIncome'),
    bar: t('barSales'),
  };
  const series = SERIES.map((item) => ({ ...item, label: seriesNames[item.key] }));

  return (
    <ChartCard
      title={t('dailySales')}
      help={t('dailySalesHelp')}
      action={(
        <ChartLegendToggle
          label={t('chartLegendLabel', { title: t('dailySales') })}
          hidden={hidden}
          onToggle={(key) => toggle(key, SERIES_KEYS)}
          onFocus={setFocused}
          items={series.map((item) => ({
            ...item,
            swatch: 'line' as const,
            total: formatAxis(seriesTotal(data, (row) => row[item.key]), locale),
          }))}
        />
      )}
    >
      <div className="mt-3 h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {SERIES.map((item) => (
                <linearGradient key={item.key} id={`${gradientId}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={item.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={item.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 4" vertical={false} />
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
              width={CHART_Y_AXIS_WIDTH}
            />
            <Tooltip
              cursor={{ stroke: chartColors.axis, strokeDasharray: '3 3' }}
              content={({ active, label, payload }) => (
                <ChartTooltipBody active={active} label={label} payload={payload} series={series} currency={currency} />
              )}
            />
            {SERIES.map((item) => (
              <Area
                key={item.key}
                dataKey={item.key}
                name={item.key}
                type="monotone"
                hide={hidden.has(item.key)}
                stroke={item.color}
                strokeWidth={focused === item.key ? 3 : 2.25}
                strokeOpacity={seriesOpacity(item.key, focused)}
                fill={`url(#${gradientId}-${item.key})`}
                fillOpacity={seriesOpacity(item.key, focused)}
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'rgb(var(--c-surface))', fill: item.color }}
                animationDuration={500}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
