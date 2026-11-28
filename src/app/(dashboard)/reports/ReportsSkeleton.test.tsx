import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '@/messages/en.json';
import { ReportsSkeleton } from './ReportsSkeleton';

function render(tallMethodTiles?: boolean): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ReportsSkeleton tallMethodTiles={tallMethodTiles} />
    </NextIntlClientProvider>,
  );
}

/** Tall tiles (a label with a second line) in the rendered skeleton. */
function tallTiles(html: string): number {
  return html.match(/\bh-20\b/g)?.length ?? 0;
}

describe('ReportsSkeleton', () => {
  it('draws the where-the-money tiles tall and the money-left tiles short by default', () => {
    expect(tallTiles(render())).toBe(3);
  });

  it('draws the money-left tiles tall when the period has an opening', () => {
    expect(tallTiles(render(true))).toBe(7);
  });
});
