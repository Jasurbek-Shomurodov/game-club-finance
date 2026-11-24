'use client';

import { useRef, type KeyboardEvent, type Ref, type TouchEvent } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CHART_Y_AXIS_WIDTH,
  ChartLegendToggle,
  ChartTooltipBody,
  chartColors,
  formatAxis,
  seriesOpacity,
  useSeriesVisibility,
} from '@/components/dashboard/ChartCard';

export interface BalanceFlowRow {
  /** Stable id of the day, week or month; what `selectedKey` and `onSelect` carry. */
  key: string;
  /** Already formatted for the axis. */
  label: string;
  /** Already formatted for the tooltip. */
  tooltipLabel: string;
  /** Balance at the end of the bucket. */
  held: number;
  income: number;
  expenses: number;
}

const FLOW_KEYS = ['income', 'expenses'] as const;
/** Bars outside the selected column. */
const DIMMED = 0.3;
/** Horizontal travel before a touch counts as dragging across the plot rather than a tap. */
const DRAG_THRESHOLD_PX = 8;

/**
 * Where a key press moves the selection over `keys` (oldest first): Left and
 * Right step, Home and End jump, Escape clears. From nothing selected an arrow
 * starts at the latest. `undefined` when the key does nothing.
 */
export function nextSelectionKey(keys: readonly string[], selectedKey: string | null, key: string): string | null | undefined {
  if (keys.length === 0) return undefined;
  if (key === 'Escape') return selectedKey === null ? undefined : null;
  if (key === 'Home') return keys[0];
  if (key === 'End') return keys[keys.length - 1];
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return undefined;
  const index = selectedKey === null ? -1 : keys.indexOf(selectedKey);
  if (index === -1) return keys[keys.length - 1];
  const next = index + (key === 'ArrowRight' ? 1 : -1);
  return keys[Math.max(0, Math.min(keys.length - 1, next))];
}

interface ChartPointer {
  activeLabel?: string;
  activeTooltipIndex?: number;
}

/**
 * A balance over time (step area) with what came in and went out in each
 * day, week or month under it on the same axis (paired bars). Tapping a
 * column, dragging across either plot, or the arrow keys select a bucket; the
 * selection is the caller's and stays until it is cleared. Days that moved
 * carry a dot on the balance line so there is something to aim at.
 */
export function BalanceFlowChart({
  rows,
  selectedKey,
  onSelect,
  heldLabel,
  incomeLabel,
  expensesLabel,
  legendLabel,
  summary,
  currency,
  locale,
  balanceHeight = 200,
  flowHeight = 96,
  initialWidth,
  plotRef,
}: {
  rows: readonly BalanceFlowRow[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  heldLabel: string;
  incomeLabel: string;
  expensesLabel: string;
  /** Names the put in / taken out legend. */
  legendLabel: string;
  /** What the plots show, for screen readers (the period and its totals). */
  summary: string;
  currency: string;
  locale: string;
  balanceHeight?: number;
  flowHeight?: number;
  /** Width drawn before the container is measured (static renders). */
  initialWidth?: number;
  /** The focusable plot group, so a caller can hand focus back to it. */
  plotRef?: Ref<HTMLDivElement>;
}) {
  const { hidden, focused, setFocused, toggle } = useSeriesVisibility();
  const touch = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const data = rows as BalanceFlowRow[];
  const labels = new Map(rows.map((row) => [row.key, row.label]));
  const selected = rows.find((row) => row.key === selectedKey) ?? null;
  const income = rows.reduce((sum, row) => sum + row.income, 0);
  const expenses = rows.reduce((sum, row) => sum + row.expenses, 0);
  const tooltipSeries = [
    { key: 'held', label: heldLabel, color: chartColors.primary },
    { key: 'income', label: incomeLabel, color: chartColors.success },
    { key: 'expenses', label: expensesLabel, color: chartColors.danger },
  ].filter((row) => !hidden.has(row.key));

  const keyAt = (pointer: ChartPointer | null | undefined) => {
    if (!pointer) return null;
    if (pointer.activeLabel !== undefined && labels.has(String(pointer.activeLabel))) return String(pointer.activeLabel);
    return pointer.activeTooltipIndex !== undefined ? rows[pointer.activeTooltipIndex]?.key ?? null : null;
  };
  // A tap (or a click) on a column selects it; on the selected one it clears.
  const handleClick = (pointer: ChartPointer | null) => {
    const key = keyAt(pointer);
    if (key !== null) onSelect(key === selectedKey ? null : key);
  };
  // A finger dragged across the plot selects where it lifts. A tap fires a click instead.
  const handlePointerUp = (pointer: ChartPointer | null) => {
    if (!touch.current?.dragging) return;
    touch.current = null;
    const key = keyAt(pointer);
    if (key !== null) onSelect(key);
  };
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const point = event.touches[0];
    touch.current = point ? { x: point.clientX, y: point.clientY, dragging: false } : null;
  };
  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const point = event.touches[0];
    const start = touch.current;
    if (!point || !start || start.dragging) return;
    const dx = Math.abs(point.clientX - start.x);
    // Scrolling the page past the chart is mostly vertical; that never selects.
    if (dx > DRAG_THRESHOLD_PX && dx > Math.abs(point.clientY - start.y)) start.dragging = true;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextSelectionKey(rows.map((row) => row.key), selectedKey, event.key);
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next);
  };

  const axisTick = { fill: chartColors.axis, fontSize: 11 };
  // Recharts draws nothing until it has measured its box; a static render is given one.
  const initialDimension = (height: number) => ({ width: initialWidth ?? -1, height: initialWidth === undefined ? -1 : height });
  const marker = selected ? <ReferenceLine x={selected.key} stroke={chartColors.axis} strokeWidth={1.5} strokeDasharray="4 3" ifOverflow="extendDomain" /> : null;
  const barOpacity = (series: string, key: string) => seriesOpacity(series, focused) * (selected && key !== selected.key ? DIMMED : 1);

  return (
    <div className="space-y-3">
      <ChartLegendToggle
        label={legendLabel}
        hidden={hidden}
        onToggle={(key) => toggle(key, FLOW_KEYS)}
        onFocus={setFocused}
        items={[
          { key: 'income', label: incomeLabel, color: chartColors.success, swatch: 'square', total: formatAxis(income, locale) },
          { key: 'expenses', label: expensesLabel, color: chartColors.danger, swatch: 'square', total: formatAxis(expenses, locale) },
        ]}
      />
      <div
        ref={plotRef}
        role="group"
        aria-label={summary}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        data-selected={selected?.key}
        className="cursor-pointer touch-pan-y select-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <div style={{ height: balanceHeight }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={initialDimension(balanceHeight)}>
            <AreaChart
              accessibilityLayer={false}
              data={data}
              syncId="balance-flow"
              margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
              onClick={handleClick}
              onMouseUp={handlePointerUp}
            >
              <defs>
                <linearGradient id="balance-flow-held" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartColors.grid} vertical={false} strokeDasharray="3 4" />
              <XAxis dataKey="key" scale="band" hide />
              <YAxis width={CHART_Y_AXIS_WIDTH} tickLine={false} axisLine={false} tick={axisTick} domain={[0, 'auto']} tickFormatter={(value: number) => formatAxis(value, locale)} />
              <Tooltip
                cursor={{ stroke: chartColors.axis, strokeOpacity: 0.4 }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as BalanceFlowRow | undefined;
                  if (!row) return null;
                  return (
                    <ChartTooltipBody
                      active={active}
                      label={row.tooltipLabel}
                      payload={[{ dataKey: 'held', value: row.held }, { dataKey: 'income', value: row.income }, { dataKey: 'expenses', value: row.expenses }]}
                      series={tooltipSeries}
                      currency={currency}
                    />
                  );
                }}
              />
              {marker}
              <Area
                dataKey="held"
                type="stepAfter"
                baseValue={0}
                stroke={chartColors.primary}
                strokeWidth={2}
                fill="url(#balance-flow-held)"
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; index?: number; payload?: BalanceFlowRow }) => (
                  props.payload && (props.payload.income > 0 || props.payload.expenses > 0) && props.cx !== undefined && props.cy !== undefined
                    ? <circle key={`moved-${props.index}`} cx={props.cx} cy={props.cy} r={2.5} fill={chartColors.primary} />
                    : <g key={`still-${props.index}`} />
                )}
                activeDot={{ r: 4, fill: chartColors.primary, strokeWidth: 0 }}
              />
              {selected ? <ReferenceDot x={selected.key} y={selected.held} r={5} fill={chartColors.primary} stroke={chartColors.primary} strokeOpacity={0.3} strokeWidth={6} ifOverflow="extendDomain" /> : null}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ height: flowHeight }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={initialDimension(flowHeight)}>
            <BarChart
              accessibilityLayer={false}
              data={data}
              syncId="balance-flow"
              barGap={1}
              barCategoryGap="20%"
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              onClick={handleClick}
              onMouseUp={handlePointerUp}
            >
              <CartesianGrid vertical={false} stroke={chartColors.grid} strokeDasharray="3 4" />
              <XAxis
                dataKey="key"
                scale="band"
                tickLine={false}
                axisLine={false}
                tick={axisTick}
                minTickGap={16}
                tickFormatter={(key: string) => labels.get(key) ?? key}
              />
              <YAxis width={CHART_Y_AXIS_WIDTH} tickLine={false} axisLine={false} tick={axisTick} tickCount={3} tickFormatter={(value: number) => formatAxis(value, locale)} />
              {/* The hovered column, mirrored from the balance plot; the numbers are in its tooltip. */}
              <Tooltip cursor={{ fill: chartColors.cursor }} content={() => null} />
              {marker}
              {!hidden.has('income') && (
                <Bar dataKey="income" fill={chartColors.success} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false}>
                  {rows.map((row) => <Cell key={row.key} fillOpacity={barOpacity('income', row.key)} />)}
                </Bar>
              )}
              {!hidden.has('expenses') && (
                <Bar dataKey="expenses" fill={chartColors.danger} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false}>
                  {rows.map((row) => <Cell key={row.key} fillOpacity={barOpacity('expenses', row.key)} />)}
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
