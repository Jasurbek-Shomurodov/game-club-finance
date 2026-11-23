'use client';

import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  CHART_Y_AXIS_WIDTH,
  ChartLegendToggle,
  ChartTooltipBody,
  categoricalColors,
  chartColors,
  formatAxis,
  seriesOpacity,
  useSeriesVisibility,
} from '@/components/dashboard/ChartCard';
import { formatPercentShare } from '@/components/charts/chartFormat';
import { formatNumber, intlLocaleFor } from '@/lib/formatters';
import type { ChartSpec, ChartUnit } from '@/lib/assistant/chartSpec';

/** Value text for a unit: money goes through the tooltip's own currency format. */
function unitFormat(unit: ChartUnit, locale: string): ((value: number) => string) | undefined {
  if (unit === 'percent') return (value) => formatPercentShare(value / 100, locale, 1);
  if (unit === 'number') return (value) => formatNumber(value, intlLocaleFor(locale));
  return undefined;
}

function axisFormat(unit: ChartUnit, locale: string): (value: number) => string {
  if (unit === 'percent') return (value) => formatPercentShare(value / 100, locale);
  return (value) => formatAxis(value, locale);
}

/**
 * A chart the assistant drew from a validated spec (parseChartSpec). Labels,
 * names and the title are rendered as text only. Sized for a phone-width chat
 * bubble; a second series gets a legend that shows or hides it.
 */
export default function AssistantChart({ spec }: { spec: ChartSpec }) {
  const t = useTranslations('assistant');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();

  const series = useMemo(() => spec.series.map((item, index) => ({
    key: `s${index}`,
    label: item.name,
    color: categoricalColors[index],
    format: unitFormat(spec.unit, locale),
  })), [locale, spec.series, spec.unit]);
  const keys = series.map((item) => item.key);
  const data = useMemo(() => spec.labels.map((label, point) => Object.fromEntries([
    ['label', label],
    ...spec.series.map((item, index) => [`s${index}`, item.values[point]]),
  ])), [spec.labels, spec.series]);

  const name = spec.title ?? t('chartLabel');
  const tickFormatter = axisFormat(spec.unit, locale);
  const axes = (
    <>
      <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 4" vertical={false} />
      <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} tickLine={false} axisLine={{ stroke: chartColors.grid }} minTickGap={12} />
      <YAxis tickFormatter={tickFormatter} tick={{ fontSize: 11, fill: chartColors.axis }} tickLine={false} axisLine={false} width={CHART_Y_AXIS_WIDTH} />
    </>
  );
  const tooltip = (cursor: object) => (
    <Tooltip
      cursor={cursor}
      content={({ active, label, payload }) => (
        <ChartTooltipBody active={active} label={label} payload={payload} series={series} currency={tc('currency')} />
      )}
    />
  );

  return (
    <figure aria-label={name} className="rounded-xl border border-gray-200 p-3">
      {(spec.title || series.length > 1) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {spec.title ? <figcaption className="min-w-0 break-words text-[13px] font-semibold text-gray-950">{spec.title}</figcaption> : null}
          {series.length > 1 ? (
            <ChartLegendToggle
              label={t('chartLegendLabel', { title: name })}
              hidden={hidden}
              onToggle={(key) => toggle(key, keys)}
              onFocus={setFocused}
              items={series.map((item) => ({ ...item, swatch: spec.type === 'bar' ? 'square' as const : 'line' as const }))}
            />
          ) : null}
        </div>
      )}
      <div className="h-48 w-full sm:h-56">
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === 'bar' ? (
            <BarChart accessibilityLayer data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              {axes}
              {tooltip({ fill: chartColors.cursor })}
              {series.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.label}
                  hide={hidden.has(item.key)}
                  fill={item.color}
                  fillOpacity={seriesOpacity(item.key, focused)}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={28}
                  animationDuration={500}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart accessibilityLayer data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              {axes}
              {tooltip({ stroke: chartColors.axis, strokeDasharray: '3 3' })}
              {series.map((item) => (
                <Line
                  key={item.key}
                  dataKey={item.key}
                  name={item.label}
                  type="monotone"
                  hide={hidden.has(item.key)}
                  stroke={item.color}
                  strokeWidth={focused === item.key ? 3 : 2.25}
                  strokeOpacity={seriesOpacity(item.key, focused)}
                  dot={spec.labels.length <= 12 ? { r: 2.5, fill: item.color, strokeWidth: 0 } : false}
                  activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'rgb(var(--c-surface))', fill: item.color }}
                  animationDuration={500}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
