'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import MoneyDetailsPage, { inRangeQuery, type MoneyDetailRow } from '@/components/money-details/MoneyDetailsPage';
import { STOCK_PURCHASE_DEDUCTION_START_DATE } from '@/lib/calculations/barMoney';
import { fetchFinanceReportSnapshot } from '@/lib/supabase/financeReportSnapshot';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { createClient } from '@/lib/supabase/client';

interface StockRow {
  date: string;
  bar_income: number;
}

interface PurchaseRow {
  date: string;
  quantity: number;
  cost_price: number;
  comment: string | null;
  products?: { name: string } | { name: string }[] | null;
}

interface ExpenseRow {
  date: string;
  amount: number;
  category: string;
  payment_source: 'game_club' | 'bar' | null;
  comment: string | null;
}

function buildRows(
  stockRows: StockRow[],
  purchaseRows: PurchaseRow[],
  expenseRows: ExpenseRow[],
): MoneyDetailRow[] {
  const rowsByDate = new Map<string, MoneyDetailRow>();
  const rowFor = (date: string) => {
    const existing = rowsByDate.get(date);
    if (existing) return existing;
    const row: MoneyDetailRow = {
      date,
      collected: [{ key: 'barSales', amount: 0 }],
      collectedTotal: 0,
      deductions: [],
      deductionsTotal: 0,
      moneyLeft: 0,
    };
    rowsByDate.set(date, row);
    return row;
  };

  for (const stockRow of stockRows) {
    const row = rowFor(stockRow.date);
    row.collected[0].amount += Number(stockRow.bar_income ?? 0);
  }
  for (const purchaseRow of purchaseRows) {
    const row = rowFor(purchaseRow.date);
    if (purchaseRow.date < STOCK_PURCHASE_DEDUCTION_START_DATE) continue;
    const amount = Number(purchaseRow.quantity ?? 0) * Number(purchaseRow.cost_price ?? 0);
    const product = Array.isArray(purchaseRow.products) ? purchaseRow.products[0] : purchaseRow.products;
    row.deductions.push({
      kind: 'purchase',
      name: product?.name ?? purchaseRow.comment ?? null,
      quantity: Number(purchaseRow.quantity ?? 0),
      amount,
    });
  }
  for (const expenseRow of expenseRows) {
    if (expenseRow.payment_source !== 'bar') continue;
    const row = rowFor(expenseRow.date);
    row.deductions.push({
      kind: 'expense',
      category: expenseRow.category,
      comment: expenseRow.comment,
      amount: Number(expenseRow.amount ?? 0),
    });
  }

  return Array.from(rowsByDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => {
      const collectedTotal = row.collected.reduce((sum, item) => sum + item.amount, 0);
      const deductionsTotal = row.deductions.reduce((sum, item) => sum + item.amount, 0);
      return { ...row, collectedTotal, deductionsTotal, moneyLeft: collectedTotal - deductionsTotal };
    });
}

export default function BarMoneyDetailsPage({ requestedFrom, requestedTo }: { requestedFrom?: string; requestedTo?: string }) {
  const t = useTranslations('dashboard');

  // Rows carry keys, not translated text, so switching language never refetches.
  const loadRows = useCallback(async (clubId: string, from: string, to: string) => {
    const supabase = createClient();
    const snapshotResult = await fetchFinanceReportSnapshot(supabase, clubId, from, to, ['stock_totals', 'purchases', 'expenses']);
    if (snapshotResult.error) throw new Error(snapshotResult.error.message);

    if (snapshotResult.data) {
      return buildRows(
        snapshotResult.data.stockTotalRows,
        snapshotResult.data.purchaseRows.map((row) => ({ ...row, products: row.product_name ? { name: row.product_name } : null })),
        snapshotResult.data.expenseRows,
      );
    }

    // Compatibility path while migration 049 is being deployed.
    const [stockRes, purchaseRes, expenseRes] = await Promise.all([
      fetchAllRows<StockRow>(() => inRangeQuery(
        supabase.from('daily_stock_counts').select('date,bar_income').eq('club_id', clubId).order('date', { ascending: true }),
        from,
        to,
      )),
      fetchAllRows<PurchaseRow>(() => inRangeQuery(
        supabase.from('stock_purchases').select('date,quantity,cost_price,comment,products(name)').eq('club_id', clubId).order('date', { ascending: true }),
        from,
        to,
      )),
      fetchAllRows<ExpenseRow>(() => inRangeQuery(
        supabase.from('expenses').select('date,amount,category,payment_source,comment').eq('club_id', clubId).order('date', { ascending: true }),
        from,
        to,
      )),
    ]);
    const firstError = [stockRes.error, purchaseRes.error, expenseRes.error].find(Boolean);
    if (firstError) throw new Error(firstError.message);
    return buildRows(stockRes.data ?? [], purchaseRes.data ?? [], expenseRes.data ?? []);
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
