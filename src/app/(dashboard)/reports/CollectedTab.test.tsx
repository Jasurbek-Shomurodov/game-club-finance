import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { AppLocaleContext } from '@/components/i18n/AppLocaleContext';
import messages from '@/messages/en.json';
import { summarizeCollectedMoney, type CollectedMoneyMove } from '@/lib/calculations/collectedMoney';
import CollectedTab from './CollectedTab';

const move = (values: Partial<CollectedMoneyMove>): CollectedMoneyMove => ({
  kind: 'collect',
  id: 'r1',
  date: '2026-11-03',
  method: 'cash',
  amount: 0,
  comment: null,
  createdBy: 'u1',
  createdAt: '2026-11-03T10:00:00Z',
  ...values,
});

const moves = [
  move({ id: 'r1', date: '2026-11-02', method: 'cash', amount: 2_000_000, comment: 'for 3 days' }),
  move({ id: 'r1', date: '2026-11-02', method: 'playstation', amount: 500_000 }),
  move({ kind: 'expense', id: 'e1', date: '2026-11-03', method: 'cash', amount: -1_500_000, createdBy: 'u2' }),
  move({ id: 'r2', date: '2026-11-04', method: 'terminal', amount: 1_000_000, createdBy: null }),
  move({ kind: 'reserve', id: 'v1', date: '2026-11-05', method: 'terminal', amount: -200_000 }),
];

function render(props: { moves?: CollectedMoneyMove[]; isOwner?: boolean; loading?: boolean } = {}) {
  const list = props.moves ?? moves;
  return renderToStaticMarkup(
    <AppLocaleContext.Provider value={{ locale: 'en', setLocale: () => undefined }}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <CollectedTab
          summary={summarizeCollectedMoney(list)}
          moves={list}
          collectorNames={new Map([['u1', 'Dilya'], ['u2', 'Aziz']])}
          enabledPaymentMethods={['cash', 'terminal']}
          loading={props.loading ?? false}
          isOwner={props.isOwner ?? true}
          businessToday="2026-11-19"
          onUndo={() => undefined}
          onMoveToReserve={async () => null}
        />
      </NextIntlClientProvider>
    </AppLocaleContext.Provider>,
  );
}

describe('CollectedTab', () => {
  it('shows what is still held, each collector and every collection', () => {
    const html = render();
    expect(html).toContain('Still with the collector');
    expect(html).toContain('By collector');
    expect(html).toContain('Dilya');
    // A collection with no known collector is listed under the fallback name.
    expect(html).toContain(messages.reports.unknownCreator);
    expect(html).toContain('for 3 days');
    // PlayStation is not enabled but carries collected money, so it keeps its column.
    expect(html).toContain('PlayStation');
    expect(html).toContain('Collections (2)');
    expect(html).toContain('All movements (4)');
    expect(html).toContain('Give back to the kassa');
    expect(html).toContain('Move to reserve');
  });

  it('hides owner actions from a collector', () => {
    const html = render({ isOwner: false });
    expect(html).not.toContain('Give back to the kassa');
    expect(html).not.toContain('Move to reserve');
  });

  it('shows the empty state and no collector list without collections', () => {
    const html = render({ moves: [] });
    expect(html).toContain(messages.reports.collectedEmpty);
    expect(html).not.toContain('By collector');
    expect(html).toContain('Nothing left to pay out or move to the reserve');
  });

  it('shows skeletons while loading', () => {
    const html = render({ loading: true });
    expect(html).not.toContain('By collector');
    expect(html).not.toContain('for 3 days');
  });
});
