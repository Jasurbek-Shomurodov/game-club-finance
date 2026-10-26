// Route: /test-checklist (owner diagnostic; not linked from navigation)

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getDashboardBootstrap } from '@/lib/supabase/dashboardBootstrap';
import { loadFinanceReportRows } from '@/lib/supabase/financeReportSnapshot';
import { relatedClub } from '@/lib/supabase/memberships';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { Badge, ButtonLink, Card, EmptyState, InlineAlert, PageHeader } from '@/components/PresentationFoundation';
import { calculateFinancialReportTotals, calculateManualIncome, type DailyCashEntry } from '@/lib/calculations/dailyReport';
import { normalizeBusinessDayStartHour, serverTodayIso } from '@/lib/utils';
import { formatNumber } from '@/lib/formatters';
import { DASHBOARD_PATH } from '@/lib/routes';

interface CheckResult {
  name: string;
  pass: boolean;
  explanation: string;
  link: string;
}

interface StockCheckRow {
  id: string;
  sold_quantity: number | null;
  sale_price: number | null;
  bar_income: number;
  bar_cost: number;
  bar_profit: number | null;
}

const sumAmounts = (rows: ReadonlyArray<{ amount: number }>) => rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

export default async function TestChecklistPage() {
  // Cached per request: the dashboard layout has already loaded it.
  const bootstrap = await getDashboardBootstrap();
  if (!bootstrap) redirect('/login');
  const t = await getTranslations('testChecklist');

  const ownerMemberships = bootstrap.initialMemberships.filter((membership) => (
    membership.role === 'owner' && relatedClub(membership.clubs)?.is_active !== false
  ));
  const membership = ownerMemberships.find((item) => item.club_id === bootstrap.initialSelectedClubId)
    ?? ownerMemberships[0];

  if (!membership) {
    redirect(DASHBOARD_PATH);
  }

  const clubId = membership.club_id;
  const businessDayStartHour = normalizeBusinessDayStartHour(relatedClub(membership.clubs)?.business_day_start_hour);
  const today = serverTodayIso(new Date(), businessDayStartHour);
  const supabase = await createClient();

  const [cashRes, stockRes, purchaseRes, expenseRes, todayDebtRes, debtRes, reportRes] = await Promise.all([
    supabase
      .from('daily_cash_entries')
      .select('cash_income,terminal_income,card_income,playstation_income')
      .eq('club_id', clubId)
      .eq('date', today)
      .maybeSingle(),
    fetchAllRows<StockCheckRow>(() => supabase
      .from('daily_stock_counts')
      .select('id,sold_quantity,sale_price,bar_income,bar_cost,bar_profit')
      .eq('club_id', clubId)
      .eq('date', today)
      .order('id')),
    fetchAllRows<{ id: string; date: string; quantity: number; cost_price: number }>(() => supabase
      .from('stock_purchases')
      .select('id,date,quantity,cost_price')
      .eq('club_id', clubId)
      .eq('date', today)
      .order('id')),
    fetchAllRows<{ id: string; amount: number; payment_source: 'game_club' | 'bar' | null }>(() => supabase
      .from('expenses')
      .select('id,amount,payment_source')
      .eq('club_id', clubId)
      .eq('date', today)
      .order('id')),
    fetchAllRows<{ id: string; amount: number }>(() => supabase
      .from('new_debts')
      .select('id,amount')
      .eq('club_id', clubId)
      .eq('date', today)
      .order('id')),
    fetchAllRows<{ id: string; amount: number; paid_amount: number | null }>(() => supabase
      .from('new_debts')
      .select('id,amount,paid_amount')
      .eq('club_id', clubId)
      .neq('status', 'paid')
      .order('id')),
    // The rows the daily report itself uses (snapshot RPC, or its fallback).
    loadFinanceReportRows(supabase, clubId, today, today, 'day'),
  ]);

  const queryError = cashRes.error ?? stockRes.error ?? purchaseRes.error ?? expenseRes.error ?? todayDebtRes.error ?? debtRes.error ?? reportRes.error;
  if (queryError) {
    // A failed query must not be reported as a failed check.
    console.error('Test checklist query failed', queryError);
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeader title={t('title')} className="mb-0" />
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title={t('loadErrorTitle')}
            description={t('loadErrorDescription')}
            action={<ButtonLink href="/test-checklist" variant="outline">{t('retry')}</ButtonLink>}
          />
        </Card>
      </div>
    );
  }

  const cashEntry = cashRes.data as DailyCashEntry | null;
  const stockRows = stockRes.data ?? [];
  const purchaseRows = purchaseRes.data ?? [];
  const expenseRows = expenseRes.data ?? [];
  const activeDebts = debtRes.data ?? [];
  const n = (value: number) => formatNumber(value);

  const checks: CheckResult[] = [];

  if (cashEntry) {
    const total = calculateManualIncome(cashEntry);
    checks.push({
      name: t('cashFields'),
      pass:
        cashEntry.cash_income >= 0 &&
        cashEntry.terminal_income >= 0 &&
        (cashEntry.card_income ?? 0) >= 0 &&
        (cashEntry.playstation_income ?? 0) >= 0,
      explanation: t('cashFieldsDetail', {
        cash: n(cashEntry.cash_income),
        terminal: n(cashEntry.terminal_income),
        card: n(cashEntry.card_income ?? 0),
        playstation: n(cashEntry.playstation_income ?? 0),
        total: n(total),
      }),
      link: '/daily-cash',
    });
  } else {
    checks.push({ name: t('cashMissing'), pass: false, explanation: t('cashMissingDetail'), link: '/daily-cash' });
  }

  const negSold = stockRows.filter((r) => (r.sold_quantity ?? 0) < 0);
  checks.push({
    name: t('negativeSold'),
    pass: negSold.length === 0,
    explanation: negSold.length === 0 ? t('negativeSoldOk', { count: stockRows.length }) : t('negativeSoldFail', { count: negSold.length }),
    link: '/closing-stock',
  });

  const incomeErrors = stockRows.filter((r) => Math.abs((r.bar_income ?? 0) - (r.sold_quantity ?? 0) * (r.sale_price ?? 0)) > 1);
  checks.push({
    name: t('barIncome'),
    pass: incomeErrors.length === 0,
    explanation: incomeErrors.length === 0 ? t('barIncomeOk') : t('barIncomeFail', { count: incomeErrors.length }),
    link: '/closing-stock',
  });

  const profitErrors = stockRows.filter((r) => Math.abs((r.bar_profit ?? 0) - ((r.bar_income ?? 0) - (r.bar_cost ?? 0))) > 1);
  checks.push({
    name: t('barProfit'),
    pass: profitErrors.length === 0,
    explanation: profitErrors.length === 0 ? t('barProfitOk') : t('barProfitFail', { count: profitErrors.length }),
    link: '/closing-stock',
  });

  // Accounting net profit from today's table rows must equal the figure the
  // daily report computes from its own snapshot rows.
  const directTotals = calculateFinancialReportTotals({
    manualIncome: cashEntry ? calculateManualIncome(cashEntry) : 0,
    debtIncome: sumAmounts(todayDebtRes.data ?? []),
    stockRows,
    purchaseRows,
    expenseRows,
  });
  const report = reportRes.data;
  const reportCash = report?.cashRows[0];
  const reportTotals = calculateFinancialReportTotals({
    manualIncome: reportCash ? calculateManualIncome(reportCash) : 0,
    debtIncome: sumAmounts(report?.debtRows ?? []),
    stockRows: report?.stockCountRows ?? [],
    purchaseRows: report?.purchaseRows ?? [],
    expenseRows: report?.expenseRows ?? [],
  });
  checks.push({
    name: t('netProfit'),
    pass: Math.abs(directTotals.gameClubProfit - reportTotals.gameClubProfit) <= 1
      && Math.abs(directTotals.barProfit - reportTotals.barProfit) <= 1,
    explanation: t('netProfitDetail', {
      gameClub: n(directTotals.gameClubProfit),
      gameClubReport: n(reportTotals.gameClubProfit),
      bar: n(directTotals.barProfit),
      barReport: n(reportTotals.barProfit),
    }),
    link: '/daily-report',
  });

  const negDebts = activeDebts.filter((d) => Number(d.paid_amount ?? 0) > Number(d.amount));
  checks.push({
    name: t('debts'),
    pass: negDebts.length === 0,
    explanation: negDebts.length === 0 ? t('debtsOk', { count: activeDebts.length }) : t('debtsFail', { count: negDebts.length }),
    link: '/debts',
  });

  const badExpenses = expenseRows.filter((e) => (e.amount ?? 0) <= 0);
  checks.push({
    name: t('expenses'),
    pass: badExpenses.length === 0,
    explanation: badExpenses.length === 0 ? t('expensesOk', { count: expenseRows.length }) : t('expensesFail', { count: badExpenses.length }),
    link: '/reports',
  });

  const passCount = checks.filter((c) => c.pass).length;
  const allPass = passCount === checks.length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title={t('title')} className="mb-0" />

      <InlineAlert variant={allPass ? 'success' : 'warning'}>
        {allPass ? t('allPassed', { count: checks.length }) : t('somePassed', { passed: passCount, count: checks.length })}
      </InlineAlert>

      <div className="space-y-3">
        {checks.map((check) => (
          <Card key={check.name} className={check.pass ? undefined : 'border-danger-500/30 bg-danger-50'}>
            <div className="flex items-start gap-3">
              {check.pass
                ? <CheckCircle size={20} className="mt-0.5 shrink-0 text-success-500" aria-hidden="true" />
                : <XCircle size={20} className="mt-0.5 shrink-0 text-danger-500" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`font-semibold ${check.pass ? 'text-gray-900' : 'text-danger-600'}`}>{check.name}</p>
                  <Badge variant={check.pass ? 'success' : 'danger'} size="sm">{check.pass ? t('passed') : t('failed')}</Badge>
                </div>
                <p className="mt-1 text-sm text-gray-600">{check.explanation}</p>
                <ButtonLink href={check.link} variant="ghost" size="sm" className="mt-2 -ml-3 text-primary-700">{t('goToPage')}</ButtonLink>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <InlineAlert variant="info">{t('note')}</InlineAlert>
    </div>
  );
}
