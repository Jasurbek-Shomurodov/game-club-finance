'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import MoneyDetailsPage, { inRangeQuery } from '@/components/money-details/MoneyDetailsPage';
import {
  buildBarMoneyDetailRows,
  type MoneyDetailExpenseRow,
  type MoneyDetailPurchaseRow,
  type MoneyDetailStockRow,
} from '@/lib/calculations/moneyDetails';
import { fetchFinanceReportSnapshot } from '@/lib/supabase/financeReportSnapshot';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { createClient } from '@/lib/supabase/client';

interface FallbackPurchaseRow extends Omit<MoneyDetailPurchaseRow, 'product_name'> {
  products?: { name: string } | { name: string }[] | null;
}

export default function BarMoneyDetailsPage({ requestedFrom, requestedTo }: { requestedFrom?: string; requestedTo?: string }) {
  const t = useTranslations('dashboard');

  // Rows carry keys, not translated text, so switching language never refetches.
  const loadRows = useCallback(async (clubId: string, from: string, to: string) => {
    const supabase = createClient();
    const snapshotResult = await fetchFinanceReportSnapshot(supabase, clubId, from, to, ['stock_totals', 'purchases', 'expenses']);
    if (snapshotResult.error) throw new Error(snapshotResult.error.message);

    if (snapshotResult.data) {
      return buildBarMoneyDetailRows(
        snapshotResult.data.stockTotalRows,
        snapshotResult.data.purchaseRows,
        snapshotResult.data.expenseRows,
      );
    }

    // Compatibility path while migration 049 is being deployed.
    const [stockRes, purchaseRes, expenseRes] = await Promise.all([
      fetchAllRows<MoneyDetailStockRow>(() => inRangeQuery(
        supabase.from('daily_stock_counts').select('date,bar_income').eq('club_id', clubId).order('date', { ascending: true }).order('id', { ascending: true }),
        from,
        to,
      )),
      fetchAllRows<FallbackPurchaseRow>(() => inRangeQuery(
        supabase.from('stock_purchases').select('date,quantity,cost_price,comment,products(name)').eq('club_id', clubId).order('date', { ascending: true }).order('id', { ascending: true }),
        from,
        to,
      )),
      fetchAllRows<MoneyDetailExpenseRow>(() => inRangeQuery(
        supabase.from('expenses').select('date,amount,category,payment_source,comment').eq('club_id', clubId).order('date', { ascending: true }).order('id', { ascending: true }),
        from,
        to,
      )),
    ]);
    const firstError = [stockRes.error, purchaseRes.error, expenseRes.error].find(Boolean);
    if (firstError) throw new Error(firstError.message);
    return buildBarMoneyDetailRows(
      stockRes.data ?? [],
      (purchaseRes.data ?? []).map(({ products, ...row }) => ({
        ...row,
        product_name: (Array.isArray(products) ? products[0] : products)?.name ?? null,
      })),
      expenseRes.data ?? [],
    );
  }, []);

  return (
    <MoneyDetailsPage
      variant="bar"
      requestedFrom={requestedFrom}
      requestedTo={requestedTo}
      loadRows={loadRows}
      labels={{
        title: t('barMoneyCalculation'),
        resultLabel: t('barMoneyLeft'),
        resultDescription: t('barMoneyLeftDesc'),
        collectedLabel: t('barSales'),
        deductionsLabel: t('totalDeductions'),
        deductionsHint: `${t('stockPurchases')} + ${t('expenses')}`,
        emptyLabel: t('noBarMoneyData'),
      }}
    />
  );
}
