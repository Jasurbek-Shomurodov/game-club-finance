import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { AppLocaleContext } from '@/components/i18n/AppLocaleContext';
import messages from '@/messages/en.json';
import type { MoneyReportActivity } from '@/lib/calculations/moneyReport';
import { entryReserveActions } from '@/lib/calculations/entryReserve';
import { EntryDetailsBody, EntryDetailsFooter, type EntryDetailsProps } from './EntryDetailsSheet';

const income: MoneyReportActivity = {
  id: 'd1',
  source: 'daily_cash',
  kind: 'income',
  category: null,
  amount: 1_700_000,
  paymentMethod: null,
  comment: 'Long evening\nfull house',
  createdAt: '2026-11-20T10:00:00Z',
  createdByName: 'Dilya',
  paymentBreakdown: { cash: 1_200_000, terminal: 500_000, card: 0, playstation: 0 },
};

const expense: MoneyReportActivity = {
  id: 'e1', source: 'expense', kind: 'expense', category: 'cleaning', amount: -100_000,
  paymentMethod: 'cash', paymentSource: 'game_club', comment: 'Mops', createdAt: '2026-11-20T11:00:00Z',
};

const METHOD_LABELS: Record<string, string> = { cash: 'Cash', terminal: 'Terminal', card: 'Card', playstation: 'PlayStation', usd: 'US dollars' };

function render(props: Partial<Omit<EntryDetailsProps, 'entry' | 'onClose'>> & { activity?: MoneyReportActivity } = {}) {
  const { activity = income, ...rest } = props;
  return renderToStaticMarkup(
    <AppLocaleContext.Provider value={{ locale: 'en', setLocale: () => undefined }}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <EntryDetailsBody
          entry={{ activity, date: '2026-11-20' }}
          error=""
          closedBy={null}
          canCorrectExpense={false}
          canCorrectPaymentMethod={false}
          saving={false}
          businessToday="2026-11-24"
          categoryOptions={[]}
          paymentMethodOptions={[]}
          activityTypeLabel={(item) => (item.kind === 'income' ? 'Income' : 'Expense')}
          categoryLabel={(item) => (item.kind === 'income' ? 'Daily club income' : 'Cleaning')}
          expenseCategoryLabel={(category) => category}
          paymentLabel={(method) => (method ? METHOD_LABELS[method] ?? method : '')}
          exchangeAmountLabel={() => ''}
          onCorrect={() => undefined}
          canMoveToReserve
          reservedThatDay={0}
          onMoveToReserve={() => undefined}
          {...rest}
        />
      </NextIntlClientProvider>
    </AppLocaleContext.Provider>,
  );
}

describe('EntryDetailsBody', () => {
  it('lists an income entry by method, and gives an owner a reserve action on each method that brought money in', () => {
    const html = render();
    expect(html).toContain(messages.reports.entryReserve.methodsTitle);
    expect(html).toContain('Cash');
    expect(html).toContain('1 200 000');
    expect(html).toContain('Move Cash to reserve');
    expect(html).toContain('Move Terminal to reserve');
    // A method that moved nothing is not listed.
    expect(html).not.toContain('Move Card to reserve');
    expect(html).not.toContain('>Card<');
    // The description reads as text under the facts.
    expect(html).toContain('Long evening\nfull house');
  });

  it('gives a non-owner no reserve actions', () => {
    const html = render({ canMoveToReserve: false, reservedThatDay: 300_000 });
    expect(html).toContain('Cash');
    expect(html).not.toContain('to reserve');
    expect(html).not.toContain(messages.reports.entryReserve.reservedThatDay);
  });

  it('gives an expense no reserve actions and keeps its payment method', () => {
    const html = render({ activity: expense });
    expect(html).not.toContain('to reserve');
    expect(html).not.toContain(messages.reports.entryReserve.methodsTitle);
    expect(html).toContain(messages.reports.paymentMethod);
    expect(html).toContain('Mops');
  });

  it('keeps the reserve actions on a closed day: closing moves no money, the form caps at the till', () => {
    const html = render({ closedBy: 'Aziz' });
    expect(html).toContain(messages.reports.dayClosed);
    expect(html).toContain('Move Cash to reserve');
    expect(html).toContain('Move Terminal to reserve');
    expect(html).not.toContain('view=collected');
  });

  it('links what went into the reserve that day to the reserve history', () => {
    const html = render({ reservedThatDay: 300_000 });
    expect(html).toContain(messages.reports.entryReserve.reservedThatDay);
    expect(html).toContain('300 000');
    expect(html).toContain('href="/reserve?view=history"');
    expect(render()).not.toContain(messages.reports.entryReserve.reservedThatDay);
  });
});

describe('EntryDetailsFooter', () => {
  it('moves every method the entry brought in', () => {
    const actions = entryReserveActions({ canMoveToReserve: true, activity: income });
    if (actions.kind !== 'open') throw new Error('expected actions');
    expect(actions.all).toEqual({ cash: 1_200_000, terminal: 500_000 });
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages}>
        <EntryDetailsFooter actions={actions} onMoveToReserve={() => undefined} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain(messages.reports.entryReserve.moveAll);
  });
});
