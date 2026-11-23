import { describe, expect, it } from 'vitest';
import {
  CHART_MAX_POINTS,
  isChartLanguage,
  parseChartSpec,
  withoutOpenChartFence,
} from './chartSpec';

const valid = {
  type: 'line',
  title: 'Game club income by day',
  unit: 'money',
  labels: ['01.11', '02.11', '03.11'],
  series: [{ name: 'Game club', values: [1_000_000, 1_250_000, 900_000] }],
};
const json = (value: unknown) => JSON.stringify(value);

describe('parseChartSpec', () => {
  it('accepts a valid line or bar spec, with or without a title', () => {
    expect(parseChartSpec(json(valid))).toEqual(valid);
    const bar = { type: 'bar', unit: 'percent', labels: ['Rent', 'Salary'], series: [{ name: 'Share', values: [42.5, 30] }, { name: 'Last month', values: [40, 31] }] };
    expect(parseChartSpec(json(bar))).toEqual(bar);
  });

  it('rejects text that is not JSON, including a spec still streaming', () => {
    expect(parseChartSpec('')).toBeNull();
    expect(parseChartSpec('{"type":"line","unit":"money","labels":["a","b"')).toBeNull();
    expect(parseChartSpec('<script>alert(1)</script>')).toBeNull();
  });

  it('rejects an unknown type or unit', () => {
    expect(parseChartSpec(json({ ...valid, type: 'pie' }))).toBeNull();
    expect(parseChartSpec(json({ ...valid, unit: 'usd' }))).toBeNull();
  });

  it('limits the title, labels and points', () => {
    expect(parseChartSpec(json({ ...valid, title: 'x'.repeat(80) }))).not.toBeNull();
    expect(parseChartSpec(json({ ...valid, title: 'x'.repeat(81) }))).toBeNull();
    expect(parseChartSpec(json({ ...valid, labels: ['x'.repeat(25), 'b', 'c'] }))).toBeNull();
    expect(parseChartSpec(json({ ...valid, labels: ['a'], series: [{ name: 'A', values: [1] }] }))).toBeNull();
    const many = Array.from({ length: CHART_MAX_POINTS + 1 }, (_, index) => String(index));
    expect(parseChartSpec(json({ ...valid, labels: many, series: [{ name: 'A', values: many.map(Number) }] }))).toBeNull();
    const most = many.slice(0, CHART_MAX_POINTS);
    expect(parseChartSpec(json({ ...valid, labels: most, series: [{ name: 'A', values: most.map(Number) }] }))).not.toBeNull();
  });

  it('needs one or two named series, each with one finite number per label', () => {
    expect(parseChartSpec(json({ ...valid, series: [] }))).toBeNull();
    const three = Array.from({ length: 3 }, (_, index) => ({ name: `S${index}`, values: [1, 2, 3] }));
    expect(parseChartSpec(json({ ...valid, series: three }))).toBeNull();
    expect(parseChartSpec(json({ ...valid, series: [{ name: '', values: [1, 2, 3] }] }))).toBeNull();
    expect(parseChartSpec(json({ ...valid, series: [{ name: 'x'.repeat(41), values: [1, 2, 3] }] }))).toBeNull();
    expect(parseChartSpec(json({ ...valid, series: [{ name: 'A', values: [1, 2] }] }))).toBeNull();
    expect(parseChartSpec(json({ ...valid, series: [{ name: 'A', values: [1, '2', 3] }] }))).toBeNull();
    expect(parseChartSpec(json({ ...valid, series: [{ name: 'A', values: [1, null, 3] }] }))).toBeNull();
    expect(parseChartSpec('{"type":"line","unit":"number","labels":["a","b"],"series":[{"name":"A","values":[1,1e999]}]}')).toBeNull();
  });

  it('caps every value at 1e15 either way', () => {
    expect(parseChartSpec(json({ ...valid, series: [{ name: 'A', values: [1e15, -1e15, 0] }] }))).not.toBeNull();
    expect(parseChartSpec(json({ ...valid, series: [{ name: 'A', values: [1e15 + 1e3, 0, 0] }] }))).toBeNull();
    expect(parseChartSpec(json({ ...valid, series: [{ name: 'A', values: [0, -2e15, 0] }] }))).toBeNull();
  });
});

describe('isChartLanguage', () => {
  it('matches the chart fence language only', () => {
    expect(isChartLanguage('chart')).toBe(true);
    expect(isChartLanguage('Chart')).toBe(true);
    expect(isChartLanguage('json')).toBe(false);
    expect(isChartLanguage(undefined)).toBe(false);
  });
});

describe('withoutOpenChartFence', () => {
  it('drops a chart block whose closing fence has not arrived', () => {
    expect(withoutOpenChartFence('Income rose.\n\n```chart\n{"type":"line",')).toBe('Income rose.');
    expect(withoutOpenChartFence('```chart')).toBe('');
  });

  it('keeps closed chart blocks and open blocks of other languages', () => {
    const closed = 'Income rose.\n\n```chart\n{}\n```\n\nMore text';
    expect(withoutOpenChartFence(closed)).toBe(closed);
    expect(withoutOpenChartFence('Text\n```json\n{"a":')).toBe('Text\n```json\n{"a":');
    const then = 'A\n```chart\n{}\n```\nB\n```chart\n{"type"';
    expect(withoutOpenChartFence(then)).toBe('A\n```chart\n{}\n```\nB');
  });

  it('matches a block closed with the same fence it opened with', () => {
    expect(withoutOpenChartFence('~~~chart\n{}\n```')).toBe('');
    expect(withoutOpenChartFence('~~~chart\n{}\n~~~')).toBe('~~~chart\n{}\n~~~');
  });

  it('drops a bare fence at the very end while its language could still become chart', () => {
    expect(withoutOpenChartFence('Income rose.\n\n```')).toBe('Income rose.');
    expect(withoutOpenChartFence('Income rose.\n\n```c')).toBe('Income rose.');
    expect(withoutOpenChartFence('Income rose.\n\n```cha')).toBe('Income rose.');
    expect(withoutOpenChartFence('Income rose.\n\n```CHA')).toBe('Income rose.');
    expect(withoutOpenChartFence('Income rose.\n\n```chart\n{')).toBe('Income rose.');
  });

  it('leaves closed blocks and open blocks of other languages alone', () => {
    const closedJs = 'Code:\n```js\nconst a = 1;\n```';
    expect(withoutOpenChartFence(closedJs)).toBe(closedJs);
    expect(withoutOpenChartFence('Code:\n```js\nconst a')).toBe('Code:\n```js\nconst a');
    expect(withoutOpenChartFence('Code:\n```js')).toBe('Code:\n```js');
    // An empty-language block with content is a code block, not a chart in the making.
    expect(withoutOpenChartFence('Code:\n```\nnpm test')).toBe('Code:\n```\nnpm test');
  });
});
