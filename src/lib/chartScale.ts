/**
 * Value and time axes for the charts: round ticks, an axis fitted to what is
 * shown, evenly spread day labels and end labels that never overlap. Pure, so
 * the charts in `src/components/charts` stay thin over tested arithmetic.
 */

export interface AxisScale {
  domain: [number, number];
  ticks: number[];
}

const DAY_MS = 86_400_000;

/**
 * Round value-axis ticks (1, 2, 2.5 or 5 × 10ⁿ, never below a whole step of 1,
 * so money never shows ticks like 0.3). Non-negative data never gets a
 * negative tick.
 */
export function niceAxis(values: readonly number[], count = 5): AxisScale {
  const finite = values.filter(Number.isFinite);
  let min = finite.length ? Math.min(...finite) : 0;
  let max = finite.length ? Math.max(...finite) : 1;
  // Floating-point noise is not a range: a step that small could never advance a tick.
  if (max - min <= Math.max(Math.abs(min), Math.abs(max)) * 1e-9) max = min;
  if (min >= 0) min = Math.min(min, Math.max(0, min - (max - min) * 0.1));
  if (max === min) {
    const pad = Math.max(Math.abs(max) * 0.1, 1);
    max += pad;
    min = min >= 0 ? Math.max(0, min - pad) : min - pad;
  }
  const rough = (max - min) / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough)!);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  const steps = Math.round((end - start) / step);
  for (let index = 0; index <= steps; index++) ticks.push(Number((start + index * step).toPrecision(12)));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

/**
 * A value axis that starts exactly at `floor` (the value the main line opens
 * on, or the lowest value in view), so that line begins in the bottom-left
 * corner. Round ticks continue above it, none closer than half a step to the
 * floor. A value below the floor lowers the axis to it, so every line shows in full.
 */
export function flooredAxis(values: readonly number[], floor: number, count = 5): AxisScale {
  if (!Number.isFinite(floor)) return niceAxis(values, count);
  const lowest = values.reduce((low, value) => (Number.isFinite(value) && value < low ? value : low), floor);
  const nice = niceAxis([lowest, ...values.filter((value) => Number.isFinite(value) && value > lowest)], count);
  const step = nice.ticks.length > 1 ? nice.ticks[1] - nice.ticks[0] : 1;
  const above = nice.ticks.filter((tick) => tick - lowest >= step / 2);
  const top = above.length ? above[above.length - 1] : lowest + step;
  return { domain: [lowest, top], ticks: [lowest, ...(above.length ? above : [top])] };
}

/**
 * The days a time axis labels between `start` and `end` (timestamps): at most
 * `count`, spread evenly from the first whole day inside the range to the
 * last, each exactly on a day, so no two land on the same date or crowd one
 * edge. A zoomed-in view starts and ends between midnights; its labels still
 * sit on the days' own points. None when no midnight falls inside the range.
 */
export function evenTimeTicks(start: number, end: number, count: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const first = Math.ceil(start / DAY_MS) * DAY_MS;
  const last = Math.floor(end / DAY_MS) * DAY_MS;
  if (last < first) return [];
  const days = Math.round((last - first) / DAY_MS);
  const steps = Math.min(Math.max(1, Math.floor(count) - 1), days);
  if (steps === 0) return [first];
  const ticks = Array.from({ length: steps + 1 }, (_, index) => first + Math.round((days * index) / steps) * DAY_MS);
  return [...new Set(ticks)];
}

/**
 * Where each line's end label sits on the value axis: at its last value,
 * pushed apart so no two are closer than `gap` (a value distance), and kept
 * inside the axis. Labels come back ordered from the highest value down.
 */
export function spreadLabels<T extends { value: number }>(items: readonly T[], domain: [number, number], gap: number): Array<T & { at: number }> {
  const sorted = [...items]
    .sort((a, b) => b.value - a.value)
    .map((item) => ({ ...item, at: Math.min(domain[1], Math.max(domain[0], item.value)) }));
  for (let index = 1; index < sorted.length; index++) sorted[index].at = Math.min(sorted[index].at, sorted[index - 1].at - gap);
  const last = sorted.length - 1;
  if (last >= 0 && sorted[last].at < domain[0]) {
    sorted[last].at = domain[0];
    for (let index = last - 1; index >= 0; index--) sorted[index].at = Math.max(sorted[index].at, sorted[index + 1].at + gap);
  }
  return sorted;
}

/**
 * The value distance that keeps end labels about `pixels` apart on a plot
 * `plotHeight` pixels tall drawing `domain`.
 */
export function labelGap(domain: [number, number], plotHeight: number, pixels = 24): number {
  return ((domain[1] - domain[0]) * pixels) / Math.max(1, plotHeight);
}

/**
 * The first of `formats` that tells every tick apart (a zoomed-in axis can
 * have ticks 1.40M and 1.45M, which one decimal would both call 1.4M); the
 * last format when none does.
 */
export function distinctTickFormat(ticks: readonly number[], formats: ReadonlyArray<(value: number) => string>): (value: number) => string {
  return formats.find((format) => new Set(ticks.map(format)).size === ticks.length) ?? formats[formats.length - 1];
}

/**
 * The values a value axis must reach for stacked bars: for each row and each
 * stack (the keys drawn on one column), the top of its positive part and the
 * bottom of its negative part. A key on its own is a stack of one. Missing
 * and non-finite values count as nothing.
 */
export function stackedValues<T>(rows: readonly T[], stacks: ReadonlyArray<ReadonlyArray<keyof T>>): number[] {
  return rows.flatMap((row) => stacks.flatMap((keys) => {
    let up = 0;
    let down = 0;
    for (const key of keys) {
      const value = Number(row[key]);
      if (!Number.isFinite(value)) continue;
      if (value >= 0) up += value;
      else down += value;
    }
    return [up, down];
  }));
}
