// Route: /test-checklist (owner diagnostic; not linked from navigation)

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Badge, ButtonLink, Card, EmptyState, InlineAlert, PageHeader } from '@/components/PresentationFoundation';
import { calculateGameClubIncome } from '@/lib/calculations/dailyCash';
import { calculateBarMoney } from '@/lib/calculations/barMoney';
import { calculateRemainingDebt } from '@/lib/calculations/debt';
import { todayIso } from '@/lib/utils';
import { formatNumber } from '@/lib/formatters';

interface CheckResult {
  name: string;
  pass: boolean;
  explanation: string;
  link: string;
}

const SELECTED_CLUB_COOKIE = 'game-club-finance-selected-club-id';

export default async function TestChecklistPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const t = await getTranslations('testChecklist');

  const { data: memberships } = await supabase
    .from('club_memberships')
    .select('club_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  const ownerMemberships = (memberships ?? []).filter((membership) => membership.role === 'owner');
  const preferredClubId = (await cookies()).get(SELECTED_CLUB_COOKIE)?.value;
  const clubId = ownerMemberships.find((membership) => membership.club_id === preferredClubId)?.club_id
    ?? ownerMemberships[0]?.club_id;

  if (!clubId) {
    redirect('/');
  }

  const { data: club } = await supabase
    .from('clubs')
    .select('business_day_start_hour')
    .eq('id', clubId)
    .maybeSingle();

  const today = todayIso(new Date(), club?.business_day_start_hour ?? 0);

  const [cashRes, stockRes, purchaseRes, expenseRes, debtRes] = await Promise.all([
    supabase.from('daily_cash_entries').select('*').eq('club_id', clubId).eq('date', today).maybeSingle(),
    supabase.from('daily_stock_counts').select('*').eq('club_id', clubId).eq('date', today),
    supabase.from('stock_purchases').select('date,quantity,cost_price').eq('club_id', clubId).eq('date', today),
    supabase.from('expenses').select('*').eq('club_id', clubId).eq('date', today),
    supabase.from('new_debts').select('*').eq('club_id', clubId).neq('status', 'paid'),
  ]);

  const queryError = cashRes.error ?? stockRes.error ?? purchaseRes.error ?? expenseRes.error ?? debtRes.error;
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

  const cashEntry = cashRes.data;
  const stockRows = stockRes.data ?? [];
  const purchaseRows = purchaseRes.data ?? [];
  const expenseRows = expenseRes.data ?? [];
  const activeDebts = debtRes.data ?? [];
  const n = (value: number) => formatNumber(value);

  const checks: CheckResult[] = [];

  if (cashEntry) {
    const total = calculateGameClubIncome({
      cashIncome: cashEntry.cash_income,
      terminalIncome: cashEntry.terminal_income,
      cardIncome: cashEntry.card_income ?? 0,
      playstationIncome: cashEntry.playstation_income ?? 0,
    });
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

  if (cashEntry) {
    const gameClub = calculateGameClubIncome({
      cashIncome: cashEntry.cash_income,
      terminalIncome: cashEntry.terminal_income,
      cardIncome: cashEntry.card_income ?? 0,
      playstationIncome: cashEntry.playstation_income ?? 0,
    });
    const { barMoney: barIncome, stockPurchaseCost } = calculateBarMoney(stockRows, purchaseRows);
    const totalExpenses = expenseRows.reduce((s, r) => s + (r.amount ?? 0), 0);
    const netProfit = gameClub + barIncome - totalExpenses;
    checks.push({
      name: t('netProfit'),
      pass: Number.isFinite(netProfit),
      explanation: t('netProfitDetail', { gameClub: n(gameClub), bar: n(barIncome), purchases: n(stockPurchaseCost), expenses: n(totalExpenses), net: n(netProfit) }),
      link: '/daily-report',
    });
  }

  const negDebts = activeDebts.filter((d) => calculateRemainingDebt(d.amount, d.paid_amount ?? 0) < 0);
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
