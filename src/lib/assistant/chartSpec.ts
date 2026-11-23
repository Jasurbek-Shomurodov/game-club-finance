import { z } from 'zod';

/**
 * Charts in assistant replies: a fenced block with the language `chart`
 * holding a small JSON spec. Replies are model output, so a spec is drawn only
 * when it parses and passes this schema; anything else draws nothing.
 */

export const CHART_MAX_TITLE = 80;
export const CHART_MIN_POINTS = 2;
export const CHART_MAX_POINTS = 62;
export const CHART_MAX_LABEL = 24;
export const CHART_MAX_SERIES = 2;
export const CHART_MAX_SERIES_NAME = 40;
/** No figure in this app comes near it; anything larger is not a real value. */
export const CHART_MAX_ABS_VALUE = 1e15;

const chartSpecSchema = z.object({
  type: z.enum(['bar', 'line']),
  title: z.string().trim().min(1).max(CHART_MAX_TITLE).optional(),
  unit: z.enum(['money', 'number', 'percent']),
  labels: z.array(z.string().max(CHART_MAX_LABEL)).min(CHART_MIN_POINTS).max(CHART_MAX_POINTS),
  series: z.array(z.object({
    name: z.string().trim().min(1).max(CHART_MAX_SERIES_NAME),
    // JSON has no NaN or Infinity, but a number past the double range parses as Infinity; the cap rejects it too.
    values: z.array(z.number().refine((value) => Number.isFinite(value) && Math.abs(value) <= CHART_MAX_ABS_VALUE)),
  })).min(1).max(CHART_MAX_SERIES),
}).refine(
  (spec) => spec.series.every((series) => series.values.length === spec.labels.length),
  { message: 'Every series needs one value per label.' },
);

export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type ChartUnit = ChartSpec['unit'];

/** The fence language that marks a chart block. */
export const CHART_LANGUAGE = 'chart';

export function isChartLanguage(language: string | undefined): boolean {
  return language?.toLowerCase() === CHART_LANGUAGE;
}

/** A valid chart spec from a block's text, or null for bad JSON or a spec that fails validation. */
export function parseChartSpec(text: string): ChartSpec | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const result = chartSpecSchema.safeParse(value);
  return result.success ? result.data : null;
}

// The Markdown package's fence rule: ``` or ~~~, then an optional language, alone on a line.
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;

/** The fence language could still grow into `chart` while it streams (``` , ```c, ```cha …). */
const mayBecomeChart = (language: string) => CHART_LANGUAGE.startsWith(language.toLowerCase());

/**
 * The reply without a chart block that is still open (its closing fence has
 * not streamed in yet), so a half-written spec never shows. The package would
 * render an open fence as a code block of raw JSON. A bare fence line at the
 * very end whose language could still become `chart` (empty, `c`, `cha`) is
 * dropped too, so no empty code box flashes. Any other open block, and every
 * closed one, is left alone.
 */
export function withoutOpenChartFence(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const fence = FENCE.exec(lines[index]);
    if (!fence) continue;
    const close = new RegExp(`^\\s*${fence[1]}\\s*$`);
    let end = index + 1;
    while (end < lines.length && !close.test(lines[end])) end += 1;
    if (end < lines.length) {
      index = end;
      continue;
    }
    const lastLine = index === lines.length - 1;
    const drop = isChartLanguage(fence[2]) || (lastLine && mayBecomeChart(fence[2]));
    return drop ? lines.slice(0, index).join('\n').trimEnd() : source;
  }
  return source;
}
