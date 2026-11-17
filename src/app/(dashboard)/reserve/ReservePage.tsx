'use client';

// Route: /reserve (owners only): the owner reserve (jamg'arma), its charts and its history.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDownToLine, ArrowUpFromLine, ShoppingCart } from 'lucide-react';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import { ChartCard, ChartEmpty } from '@/components/dashboard/ChartCard';
import {
  ButtonLink,
  Card,
  ChartSkeleton,
  EmptyState,
  LoadErrorAlert,
  MetricGridSkeleton,
  PageHeader,
  SegmentedControl,
  StatTile,
  TableSkeleton,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { dollarsForMonth } from '@/lib/calculations/moneyExchanges';
import { reserveActivity, reserveBalances, reserveMonthlySeries } from '@/lib/calculations/ownerReserve';
import { formatCurrency, formatUnitCurrency } from '@/lib/formatters';
import { createClient } from '@/lib/supabase/client';
import { EMPTY_OWNER_MONEY, fetchOwnerMoney } from '@/lib/supabase/ownerMoney';
import { deleteReserveEntry } from '@/lib/supabase/ownerReserve';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { cn } from '@/lib/utils';
import { OWNER_RESERVE_METHODS, type OwnerReserveMethod } from '@/types';
import { METHOD_ICONS, SOURCE_ICONS, SOURCE_TINTS } from '../money-taken/profitIcons';
import { ReserveHistoryList, type DeletableReserveActivity } from './ReserveHistoryList';

function ChartLoading() {
  return <ChartSkeleton />;
}
const loadCharts = () => import('./ReserveCharts');
const ReserveBalanceChart = dynamic(() => loadCharts().then((module) => module.ReserveBalanceChart), { ssr: false, loading: ChartLoading });
const ReserveFlowChart = dynamic(() => loadCharts().then((module) => module.ReserveFlowChart), { ssr: false, loading: ChartLoading });

type ReserveView = 'overview' | 'history';

export default function ReservePage() {
  const t = useTranslations('reservePage');
  const tr = useTranslations('ownerReserve');
  const tm = useTranslations('moneyTaken');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { selectedClubId, role, businessDayStartHour } = useClub();
  const businessToday = useBusinessToday(businessDayStartHour);
  const currentMonth = businessToday.slice(0, 7);
  const isOwner = role === 'owner';
  const { showToast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [view, setView] = useState<ReserveView>(() => (searchParams.get('view') === 'history' ? 'history' : 'overview'));
  const [busyId, setBusyId] = useState<string | null>(null);

  // Keep the tab shareable.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === 'history') params.set('view', 'history');
    else params.delete('view');
    const nextQuery = params.toString();
    if (nextQuery !== searchParams.toString()) {
      window.history.replaceState(null, '', nextQuery ? `${pathname}?${nextQuery}` : pathname);
    }
  }, [pathname, searchParams, view]);

  const load = useCallback(async (isCurrent: () => boolean) => (
    selectedClubId && isOwner ? fetchOwnerMoney(createClient(), selectedClubId, businessToday, isCurrent) : EMPTY_OWNER_MONEY
  ), [businessToday, isOwner, selectedClubId]);
  const query = useClubQuery(load, EMPTY_OWNER_MONEY);
  const { reserveEntries, reserveExpenses, exchangeRows, dollarExpenses, reserveSupported } = query.data;
  // A club switch or business-day rollover replaces the loader; a delete confirmed under the old one is stale.
  const currentLoad = useRef(load);
  useEffect(() => { currentLoad.current = load; }, [load]);

  const balances = useMemo(() => reserveBalances(reserveEntries, reserveExpenses), [reserveEntries, reserveExpenses]);
  const activity = useMemo(() => reserveActivity(reserveEntries, reserveExpenses), [reserveEntries, reserveExpenses]);
  const series = useMemo(() => reserveMonthlySeries(reserveEntries, reserveExpenses, currentMonth), [reserveEntries, reserveExpenses, currentMonth]);
  const dollarsHeld = useMemo(() => dollarsForMonth(exchangeRows, currentMonth, dollarExpenses).heldUsd, [exchangeRows, currentMonth, dollarExpenses]);

  const currency = tc('currency');
  const total = balances.game_club.held + balances.bar.held;
  const totals = {
    deposited: balances.game_club.deposited + balances.bar.deposited,
    returned: balances.game_club.returned + balances.bar.returned,
    spent: balances.game_club.spent + balances.bar.spent,
  };
  const methodLabel = (method: OwnerReserveMethod) => (
    method === 'playstation' ? tm('playstation') : method === 'usd' ? tm('dollars') : tc(`paymentMethods.${method}`)
  );
  const dollars = `${dollarsHeld < 0 ? '−' : ''}$${formatUnitCurrency(Math.abs(dollarsHeld))}`;
  // Where the money is: each Game Club method, then the Bar.
  const holdings = [
    ...OWNER_RESERVE_METHODS
      .filter((method) => balances.game_club.byMethod[method] !== 0 || (method === 'usd' && dollarsHeld !== 0))
      .map((method) => ({
        key: method,
        label: methodLabel(method),
        icon: METHOD_ICONS[method],
        amount: balances.game_club.byMethod[method],
        note: method === 'usd' ? dollars : null,
        tint: SOURCE_TINTS.game_club,
      })),
    ...(balances.bar.held !== 0 ? [{
      key: 'bar', label: tr('sources.bar'), icon: SOURCE_ICONS.bar, amount: balances.bar.held, note: null, tint: SOURCE_TINTS.bar,
    }] : []),
  ];
  const largest = Math.max(1, ...holdings.map((row) => Math.abs(row.amount)));

  async function handleDelete(row: DeletableReserveActivity) {
    if (!selectedClubId || busyId) return;
    const loadBeforeConfirm = currentLoad.current;
    const confirmed = await confirm({
      title: tc('delete'),
      description: tr(row.kind === 'deposit' ? 'deleteDepositConfirm' : 'deleteReturnConfirm', { amount: `${formatCurrency(row.amount)} ${currency}` }),
      confirmLabel: tc('delete'),
    });
    if (!confirmed || loadBeforeConfirm !== currentLoad.current) return;
    setBusyId(row.id);
    try {
      const failure = await deleteReserveEntry(createClient(), selectedClubId, row.id);
      if (loadBeforeConfirm !== currentLoad.current) return;
      showToast(failure ? tr(`errors.${failure}`) : tr('deletedToast'), failure ? 'error' : 'success');
      await query.reload({ silent: true });
    } catch {
      showToast(tr('errors.failed'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <PageHeader
      title={t('title')}
      className="mb-0"
      tabs={(
        <SegmentedControl
          variant="tabs"
          label={t('viewSwitcher')}
          options={[
            { value: 'overview', label: t('overview') },
            { value: 'history', label: t('history', { count: activity.length }) },
          ]}
          value={view}
          onChange={setView}
        />
      )}
      action={<ButtonLink href="/money-taken" variant="outline" size="sm">{t('manage')}</ButtonLink>}
    />
  );

  if (query.error) {
    return (
      <div className="space-y-6">
        {header}
        <LoadErrorAlert retrying={query.loading} onRetry={() => void query.reload()}>{t('loadError')}</LoadErrorAlert>
      </div>
    );
  }

  if (!query.loading && !reserveSupported) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title={tr('errors.migration_required')} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {view === 'overview' ? (
        query.loading ? (
          <>
            <MetricGridSkeleton />
            <ChartSkeleton />
          </>
        ) : (
          <>
            <Card as="section" aria-labelledby="reserve-total">
              <p id="reserve-total" className="text-xs font-medium text-gray-500">{t('totalHeld')}</p>
              <p className="mt-1 break-words text-3xl font-bold leading-none tracking-tight tabular-nums text-gray-950 sm:text-4xl">
                {formatCurrency(total)}
                <span className="ml-1.5 text-base font-medium tracking-normal text-gray-500">{currency}</span>
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatTile variant="soft" icon={SOURCE_ICONS.game_club} label={t('gameClubInSoums')} value={formatCurrency(balances.game_club.held - balances.game_club.byMethod.usd)} unit={currency} />
                <StatTile variant="soft" icon={METHOD_ICONS.usd} label={t('inDollars')} value={dollars} unit={`${formatCurrency(balances.game_club.byMethod.usd)} ${currency}`} />
                <StatTile variant="soft" icon={SOURCE_ICONS.bar} label={t('bar')} value={formatCurrency(balances.bar.held)} unit={currency} />
              </div>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title={t('whereTitle')} description={t('whereDescription')}>
                {holdings.length === 0 ? <ChartEmpty title={tr('empty')} /> : (
                  <ul className="mt-4 space-y-3">
                    {holdings.map((row) => {
                      const Icon = row.icon;
                      return (
                        <li key={row.key}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex min-w-0 items-center gap-2 font-medium text-gray-800">
                              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', row.tint.bubble)}>
                                <Icon size={15} aria-hidden="true" />
                              </span>
                              <span className="truncate">{row.label}</span>
                            </span>
                            <span className="shrink-0 text-right tabular-nums">
                              <span className="font-semibold text-gray-950">{formatCurrency(row.amount)}</span>
                              <span className="ml-1 text-xs text-gray-500">{currency}</span>
                              {row.note ? <span className="block text-xs text-gray-500">{row.note}</span> : null}
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                            <div className={cn('h-full rounded-full', row.tint.bar)} style={{ width: `${Math.max(0, row.amount) / largest * 100}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ChartCard>

              <ChartCard title={t('allTimeTitle')} description={t('allTimeDescription')}>
                <div className="mt-4 grid gap-3">
                  <StatTile icon={ArrowDownToLine} label={t('putIn')} value={formatCurrency(totals.deposited)} unit={currency} tone="success" />
                  <StatTile icon={ArrowUpFromLine} label={t('returned')} value={formatCurrency(totals.returned)} unit={currency} />
                  <StatTile icon={ShoppingCart} label={t('spent')} value={formatCurrency(totals.spent)} unit={currency} />
                </div>
              </ChartCard>
            </div>

            <ChartCard title={t('balanceTitle')} description={t('balanceDescription')}>
              {series.length === 0 ? <ChartEmpty title={tr('empty')} /> : <ReserveBalanceChart rows={series} locale={locale} currency={currency} />}
            </ChartCard>
            <ChartCard title={t('flowTitle')} description={t('flowDescription')}>
              {series.length === 0 ? <ChartEmpty title={tr('empty')} /> : <ReserveFlowChart rows={series} locale={locale} currency={currency} />}
            </ChartCard>
          </>
        )
      ) : query.loading ? (
        <TableSkeleton rows={6} columns={3} />
      ) : (
        <Card as="section" padding="none" className="max-w-4xl overflow-hidden" aria-label={tr('activityLabel')}>
          {activity.length === 0 ? (
            <div className="p-4 sm:p-5"><EmptyState compact title={tr('empty')} description={tr('emptyHint')} /></div>
          ) : (
            <ReserveHistoryList
              activity={activity}
              methodLabel={methodLabel}
              busyId={busyId}
              disabled={busyId !== null || query.loading}
              onDelete={(row) => void handleDelete(row)}
            />
          )}
        </Card>
      )}
      {confirmDialog}
    </div>
  );
}
