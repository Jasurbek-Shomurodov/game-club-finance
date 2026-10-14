'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import MoneyDetailsPage, { inRangeQuery, type MoneyDetailRow } from '@/components/money-details/MoneyDetailsPage';
import { useClub } from '@/components/layout/DashboardShell';
import { fetchFinanceReportSnapshot } from '@/lib/supabase/financeReportSnapshot';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { createClient } from '@/lib/supabase/client';
import type { EntryPaymentMethod } from '@/types';

interface CashRow {
  date: string;
  cash_income: number;
  terminal_income: number;
  card_income: number;
  playstation_income: number;
}

interface DebtPaymentRow {
  date: string;
  amount: number;
}

interface ExpenseRow {
  date: string;
  amount: number;
  category: string;
  payment_source: 'game_club' | 'bar' | null;
  comment: string | null;
}

function buildRows(
  cashRows: CashRow[],
  debtRows: DebtPaymentRow[],
  expenseRows: ExpenseRow[],
  enabledMethods: EntryPaymentMethod[],
): MoneyDetailRow[] {
  const sums = new Map<string, { cash: number; terminal: number; card: number; playstation: number; debtPayments: number; deductions: MoneyDetailRow['deductions'] }>();
  const bucketFor = (date: string) => {
    const existing = sums.get(date);
    if (existing) return existing;
    const bucket = { cash: 0, terminal: 0, card: 0, playstation: 0, debtPayments: 0, deductions: [] as MoneyDetailRow['deductions'] };
    sums.set(date, bucket);
    return bucket;
  };

  for (const cashRow of cashRows) {
    const bucket = bucketFor(cashRow.date);
    bucket.cash += Number(cashRow.cash_income ?? 0);
    bucket.terminal += Number(cashRow.terminal_income ?? 0);
    bucket.card += Number(cashRow.card_income ?? 0);
    bucket.playstation += Number(cashRow.playstation_income ?? 0);
  }
  for (const debtRow of debtRows) {
    bucketFor(debtRow.date).debtPayments += Number(debtRow.amount ?? 0);
  }
  for (const expenseRow of expenseRows) {
    if (expenseRow.payment_source === 'bar') continue;
    bucketFor(expenseRow.date).deductions.push({
      kind: 'expense',
      category: expenseRow.category,
      comment: expenseRow.comment,
      amount: Number(expenseRow.amount ?? 0),
    });
  }

  return Array.from(sums.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => {
      const collected = [
        { key: 'cash' as const, amount: bucket.cash },
        { key: 'terminal' as const, amount: bucket.terminal },
        { key: 'card' as const, amount: bucket.card },
        { key: 'playstation' as const, amount: bucket.playstation },
        { key: 'debtPayments' as const, amount: bucket.debtPayments },
      ].filter((item) => item.amount !== 0 || item.key === 'playstation' || item.key === 'debtPayments' || enabledMethods.includes(item.key));
      const collectedTotal = collected.reduce((sum, item) => sum + item.amount, 0);
      const deductionsTotal = bucket.deductions.reduce((sum, item) => sum + item.amount, 0);
      return {
        date,
        collected,
        collectedTotal,
        deductions: bucket.deductions,
        deductionsTotal,
        moneyLeft: collectedTotal - deductionsTotal,
      };
    });
}

export default function GameClubMoneyDetailsPage({ requestedFrom, requestedTo }: { requestedFrom?: string; requestedTo?: string }) {
  const t = useTranslations('dashboard');
  const { enabledPaymentMethods } = useClub();

  // Rows carry keys, not translated text, so switching language never refetches.
  const loadRows = useCallback(async (clubId: string, from: string, to: string) => {
    const supabase = createClient();
    const snapshotResult = await fetchFinanceReportSnapshot(supabase, clubId, from, to, ['cash', 'debt_payments', 'expenses']);
    if (snapshotResult.error) throw new Error(snapshotResult.error.message);

    if (snapshotResult.data) {
      return buildRows(snapshotResult.data.cashRows, snapshotResult.data.debtPaymentRows, snapshotResult.data.expenseRows, enabledPaymentMethods);
    }

    // Compatibility path while migration 049 is being deployed.
    const [cashRes, debtRes, expenseRes] = await Promise.all([
      fetchAllRows<CashRow>(() => inRangeQuery(
        supabase.from('daily_cash_entries').select('date,cash_income,terminal_income,card_income,playstation_income').eq('club_id', clubId).order('date', { ascending: true }).order('id', { ascending: true }),
        from,
        to,
      )),
      fetchAllRows<DebtPaymentRow>(() => inRangeQuery(
        supabase.from('debt_payments').select('date,amount').eq('club_id', clubId).order('date', { ascending: true }).order('id', { ascending: true }),
        from,
        to,
      )),
      fetchAllRows<ExpenseRow>(() => inRangeQuery(
        supabase.from('expenses').select('date,amount,category,payment_source,comment').eq('club_id', clubId).order('date', { ascending: true }).order('id', { ascending: true }),
        from,
        to,
      )),
    ]);
    const firstError = [cashRes.error, debtRes.error, expenseRes.error].find(Boolean);
    if (firstError) throw new Error(firstError.message);
    return buildRows(cashRes.data ?? [], debtRes.data ?? [], expenseRes.data ?? [], enabledPaymentMethods);
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
