import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { AppLocaleContext } from '@/components/i18n/AppLocaleContext';
import messages from '@/messages/en.json';
import type { OwnerReserveEntry, OwnerWithdrawal } from '@/types';
import type { InvestmentRow } from '@/lib/calculations/ownerProfitSnapshot';
import { WithdrawalHistory, type HistoryRow } from './WithdrawalHistory';

const withdrawal = (id: string, source: OwnerWithdrawal['source'], amount: number): OwnerWithdrawal => ({
  id, club_id: 'club', period_month: '2026-11-01', source, payment_method: source === 'game_club' ? 'cash' : null,
  amount, comment: null, created_by: 'u', created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-10T10:00:00Z',
});

const deposit = (id: string, source: OwnerReserveEntry['source'], amount: number): OwnerReserveEntry => ({
  id, club_id: 'club', kind: 'deposit', period_month: '2026-11-01', source, payment_method: source === 'game_club' ? 'cash' : null,
  amount, comment: null, collection_date: null, entry_date: '2026-11-12', created_by: 'u', created_at: '2026-11-12T10:00:00Z',
} as OwnerReserveEntry);

const withdrawals = [withdrawal('w1', 'game_club', 1_000_000), withdrawal('w2', 'bar', 400_000)];
const investments: InvestmentRow[] = [
  { date: '2026-11-05', amount: 300_000, payment_source: 'game_club' },
  { date: '2026-11-06', amount: 70_000, payment_source: 'bar' },
];
const reserveEntries = [deposit('r1', 'game_club', 250_000), deposit('r2', 'bar', 40_000)];
const rows: HistoryRow[] = withdrawals.map((item) => ({ kind: 'withdrawal', id: item.id, month: '2026-11', withdrawal: item }));

function render() {
  return renderToStaticMarkup(
    <AppLocaleContext.Provider value={{ locale: 'en', setLocale: () => undefined }}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <WithdrawalHistory
          rows={rows}
          currentMonth="2026-11"
          withdrawals={withdrawals}
          investments={investments}
          reserveEntries={reserveEntries}
          isOwner={false}
          deletingId={null}
          deleteDisabled={false}
          methodLabel={(method) => method}
          deleteLabel={(row) => row.id}
          onDelete={() => undefined}
        />
      </NextIntlClientProvider>
    </AppLocaleContext.Provider>,
  );
}

describe('WithdrawalHistory under "All"', () => {
  it('adds only what was withdrawn across Game Club and Bar; invested and reserved stay per side', () => {
    const html = render();
    // Withdrawn is the one combined figure.
    expect(html).toContain('1 400 000');
    // Each side's own invested and reserved figures.
    for (const figure of ['300 000', '70 000', '250 000', '40 000']) expect(html).toContain(figure);
    // Never the two sides added together.
    expect(html).not.toContain('370 000');
    expect(html).not.toContain('290 000');
  });
});
