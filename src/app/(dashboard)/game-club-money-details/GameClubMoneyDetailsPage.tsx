'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import MoneyDetailsPage, { inRangeQuery } from '@/components/money-details/MoneyDetailsPage';
import { useClub } from '@/components/layout/DashboardShell';
import {
  buildGameClubMoneyDetailRows,
  type MoneyDetailCashRow,
  type MoneyDetailDebtPaymentRow,
  type MoneyDetailExpenseRow,
} from '@/lib/calculations/moneyDetails';
import { fetchFinanceReportSnapshot } from '@/lib/supabase/financeReportSnapshot';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { createClient } from '@/lib/supabase/client';

export default function GameClubMoneyDetailsPage({ requestedFrom, requestedTo }: { requestedFrom?: string; requestedTo?: string }) {
  const t = useTranslations('dashboard');
  const { enabledPaymentMethods } = useClub();

  // Rows carry keys, not translated text, so switching language never refetches.
  const loadRows = useCallback(async (clubId: string, from: string, to: string) => {
    const supabase = createClient();
    const snapshotResult = await fetchFinanceReportSnapshot(supabase, clubId, from, to, ['cash', 'debt_payments', 'expenses']);
    if (snapshotResult.error) throw new Error(snapshotResult.error.message);

    if (snapshotResult.data) {
      return buildGameClubMoneyDetailRows(
        snapshotResult.data.cashRows,
        snapshotResult.data.debtPaymentRows,
        snapshotResult.data.expenseRows,
        enabledPaymentMethods,
      );
    }

    // Compatibility path while migration 049 is being deployed.
    const [cashRes, debtRes, expenseRes] = await Promise.all([
      fetchAllRows<MoneyDetailCashRow>(() => inRangeQuery(
        supabase.from('daily_cash_entries').select('date,cash_income,terminal_income,card_income,playstation_income').eq('club_id', clubId).order('date', { ascending: true }).order('id', { ascending: true }),
        from,
        to,
      )),
      fetchAllRows<MoneyDetailDebtPaymentRow>(() => inRangeQuery(
        supabase.from('debt_payments').select('date,amount').eq('club_id', clubId).order('date', { ascending: true }).order('id', { ascending: true }),
        from,
        to,
      )),
      fetchAllRows<MoneyDetailExpenseRow>(() => inRangeQuery(
        supabase.from('expenses').select('date,amount,category,payment_source,comment').eq('club_id', clubId).order('date', { ascending: true }).order('id', { ascending: true }),
        from,
        to,
      )),
    ]);
    const firstError = [cashRes.error, debtRes.error, expenseRes.error].find(Boolean);
    if (firstError) throw new Error(firstError.message);
    return buildGameClubMoneyDetailRows(cashRes.data ?? [], debtRes.data ?? [], expenseRes.data ?? [], enabledPaymentMethods);
  }, [enabledPaymentMethods]);

  return (
    <MoneyDetailsPage
      variant="gameClub"
      requestedFrom={requestedFrom}
      requestedTo={requestedTo}
      loadRows={loadRows}
      labels={{
        title: t('gameClubMoneyCalculation'),
        resultLabel: t('totalMoneyLeft'),
        resultDescription: t('totalMoneyLeftDesc'),
        collectedLabel: t('totalCollected'),
        deductionsLabel: t('gameClubPaidExpenses'),
        emptyLabel: t('noGameClubMoneyData'),
      }}
    />
  );
}
