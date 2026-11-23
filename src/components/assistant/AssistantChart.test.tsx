import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '@/messages/en.json';
import { AppLocaleContext } from '@/components/i18n/AppLocaleContext';
import type { ChartSpec } from '@/lib/assistant/chartSpec';
import AssistantChart from './AssistantChart';

const render = (spec: ChartSpec) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}>
    <AppLocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      <AssistantChart spec={spec} />
    </AppLocaleContext.Provider>
  </NextIntlClientProvider>,
);

describe('AssistantChart', () => {
  it('names the chart by its title and shows model text only as text', () => {
    const html = render({
      type: 'bar',
      title: '<img src=x onerror=alert(1)>',
      unit: 'money',
      labels: ['Oct', 'Nov'],
      series: [{ name: '<b>Game club</b>', values: [1, 2] }, { name: 'Bar', values: [3, 4] }],
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // Two series get a legend that shows or hides each one.
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('&lt;b&gt;Game club&lt;/b&gt;');
  });

  it('falls back to a generic name without a title and skips the legend for one series', () => {
    const html = render({ type: 'line', unit: 'percent', labels: ['a', 'b'], series: [{ name: 'Margin', values: [10, 12.5] }] });
    expect(html).toContain('aria-label="Chart"');
    expect(html).not.toContain('<figcaption');
    expect(html).not.toContain('aria-pressed');
  });
});
