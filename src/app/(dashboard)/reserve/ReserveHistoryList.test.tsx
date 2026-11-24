import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { AppLocaleContext } from '@/components/i18n/AppLocaleContext';
import messages from '@/messages/en.json';
import type { ReserveActivity } from '@/lib/calculations/ownerReserve';
import { ReserveHistoryList } from './ReserveHistoryList';

const purchase = (overrides: Partial<Extract<ReserveActivity, { kind: 'purchase' }>>): ReserveActivity => ({
  kind: 'purchase', id: 'p1', date: '2026-11-24', source: 'game_club', amount: 3_000_000, method: 'cash',
  note: null, createdAt: '2026-11-24T10:00:00Z', category: 'equipment', ...overrides,
});

function render(activity: ReserveActivity[]) {
  return renderToStaticMarkup(
    <AppLocaleContext.Provider value={{ locale: 'en', setLocale: () => undefined }}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <ReserveHistoryList activity={activity} methodLabel={(method) => method} busyId={null} disabled={false} onDelete={() => undefined} />
      </NextIntlClientProvider>
    </AppLocaleContext.Provider>,
  );
}

describe('ReserveHistoryList', () => {
  it('leads a USD-account purchase with its dollars, the sums they count as under them', () => {
    const html = render([purchase({ id: 'game', method: 'usd', amount: 1_082_003, dollars: { amount: 90, rate: 12_022.26 } })]);
    expect(html).toContain('−$90');
    expect(html).toContain('1 082 003 UZS');
    // The sums are what the dollars cost, never a sums amount read as dollars.
    expect(html).not.toContain('$1 082 003');
  });

  it('shows a sums purchase in sums', () => {
    const html = render([purchase({})]);
    expect(html).toContain('−3 000 000');
    expect(html).not.toContain('$');
  });
});
