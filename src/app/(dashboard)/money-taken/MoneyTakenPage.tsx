'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, CalendarArrowUp, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useClub } from '@/components/layout/DashboardShell';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CurrencyInput,
  DataTable,
  EmptyState,
  Field,
  FormSkeleton,
  IconButton,
  Input,
  LoadErrorAlert,
  MonthPicker,
  PageHeader,
  SectionHeading,
  SegmentedControl,
  Skeleton,
  TableSkeleton,
  metricToneClassName,
  toneForAmount,
  useConfirm,
  useToast,
  type DataTableColumn,
  type DataTableGroup,
} from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { createClient } from '@/lib/supabase/client';
import { fetchMoneyExchanges } from '@/lib/supabase/moneyExchanges';
import { withExchangesByMonth } from '@/lib/calculations/moneyExchanges';
import {
  calculateAvailableMoneyByMonth,
  type AvailableMoneyByMonth,
} from '@/lib/calculations/availableMoney';
import {
  applyOwnerProfitCarryovers,
  availableForPaymentMethod,
  buildOwnerProfitSnapshot,
  carryoversForMonth,
  gameClubMoneyLeftByPaymentMethodByMonth,
  gameClubWithdrawalsByMethod,
  withdrawnBySourceForMonth,
  type OwnerProfitSnapshotPayload,
} from '@/lib/calculations/ownerProfitSnapshot';
import type { StockPurchaseCostRow } from '@/lib/calculations/barMoney';
import { clampWithdrawalInput } from '@/lib/withdrawalInput';
import { isMissingDatabaseColumn, isMissingDatabaseFunction, isMissingDatabaseTable } from '@/lib/supabase/errors';
import {
  DailyCashRow,
  DebtPaymentValueRow,
  emptyMoneyLeftByPaymentMethod,
  ExpenseRow,
  type MoneyLeftByPaymentMethod,
  StockCountRow,
} from '@/lib/calculations/dashboardMetrics';
import {
  capitalizeFirst,
  formatCurrency,
  parseCurrencyInput,
  formatDateTime,
  formatYearMonth,
} from '@/lib/formatters';
import { nextYearMonth } from '@/lib/utils';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessRollover } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import {
  OWNER_WITHDRAWAL_PAYMENT_METHODS,
  OWNER_WITHDRAWAL_SOURCES,
  type OwnerProfitCarryover,
  type OwnerWithdrawal,
  type OwnerWithdrawalPaymentMethod,
  type OwnerWithdrawalSource,
} from '@/types';

type MoneySource = OwnerWithdrawalSource | 'all';

const PROFIT_SOURCES: readonly MoneySource[] = ['all', ...OWNER_WITHDRAWAL_SOURCES];

/** One line of the breakdown table: a profit source, or a payment method under the club. */
interface BreakdownRow {
  key: string;
  label: string;
  /** null when the row has no earnings of its own (withdrawals without a method). */
  earned: number | null;
  /** Net money carried in from the previous month (+) or on to the next (−). */
  carried: number;
  withdrawn: number;
  available: number | null;
  nested?: boolean;
  hint?: string;
}

interface WithdrawalMethodRow {
  id: string;
  payment_method: OwnerWithdrawalPaymentMethod;
}

type HistoryRow =
  | { kind: 'withdrawal'; id: string; month: string; withdrawal: OwnerWithdrawal }
  | { kind: 'carryover'; id: string; month: string; carryover: OwnerProfitCarryover };

interface OwnerMoneyData {
  balancesByMonth: AvailableMoneyByMonth;
  paymentMethodBalancesByMonth: Record<string, MoneyLeftByPaymentMethod>;
  withdrawals: OwnerWithdrawal[];
  carryovers: OwnerProfitCarryover[];
  /** Migration 071 is applied: unwithdrawn profit can be moved to the next month. */
  carryoversSupported: boolean;
  /** Migration 066 is applied: Game Club withdrawals record a payment method. */
  methodsSupported: boolean;
}

const EMPTY_OWNER_MONEY: OwnerMoneyData = {
  balancesByMonth: {},
  paymentMethodBalancesByMonth: {},
  withdrawals: [],
  carryovers: [],
  carryoversSupported: false,
  methodsSupported: false,
};

const emptyForm = (month: string) => ({
  month,
  source: 'game_club' as MoneySource,
  paymentMethod: '' as OwnerWithdrawalPaymentMethod | '',
  comment: '',
  amount: '',
});

function historyCreatedAt(row: HistoryRow): string {
  return row.kind === 'withdrawal' ? row.withdrawal.created_at : row.carryover.created_at;
}

export default function MoneyTakenPage() {
  const t = useTranslations('moneyTaken');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { selectedClubId, role, businessDayStartHour, enabledPaymentMethods } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const businessToday = useBusinessToday(businessDayStartHour);
  const currentMonth = businessToday.slice(0, 7);
  const [saving, setSaving] = useState<'withdraw' | 'carry' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(() => emptyForm(currentMonth));
  // A club switch starts a fresh form on the current business month.
  const [formClubId, setFormClubId] = useState(selectedClubId);
  if (formClubId !== selectedClubId) {
    setFormClubId(selectedClubId);
    setForm(emptyForm(currentMonth));
  }
  const mutationPending = useRef(false);
  const isOwner = role === 'owner';

  // A month the user picked is kept on rollover; the default month follows the business month.
  useBusinessRollover(currentMonth, (previousMonth, nextMonth) => {
    setForm((current) => (current.month === previousMonth ? { ...current, month: nextMonth } : current));
  });

  const loadOwnerMoney = useCallback(async (isCurrent: () => boolean): Promise<OwnerMoneyData> => {
    if (!selectedClubId) return EMPTY_OWNER_MONEY;

    const supabase = createClient();
    const snapshotArgs = { p_club_id: selectedClubId, p_through_date: businessToday };
    const [snapshotWithMethods, carryoverRes, exchangeRows] = await Promise.all([
      // Migration 076: the snapshot's withdrawal rows carry their payment method.
      supabase.rpc('get_owner_profit_snapshot_with_methods', snapshotArgs),
      fetchAllRows<OwnerProfitCarryover>(() => supabase
        .from('owner_profit_carryovers')
        .select('id,club_id,from_month,to_month,source,payment_method,amount,comment,created_by,created_at')
        .eq('club_id', selectedClubId)
        .lte('from_month', `${currentMonth}-01`)
        .order('id')),
      // Exchanges move money between methods (092); neither balance source includes them.
      fetchMoneyExchanges(supabase, selectedClubId, '2000-01-01', businessToday),
    ]);

    // A superseded load stops early; useClubQuery discards whatever it returns.
    if (!isCurrent()) return EMPTY_OWNER_MONEY;

    // Before migration 076, read the 050 snapshot and the withdrawal methods separately.
    const snapshotHasMethods = !isMissingDatabaseFunction(snapshotWithMethods.error, 'get_owner_profit_snapshot_with_methods');
    const [snapshotResult, methodRes] = snapshotHasMethods
      ? [snapshotWithMethods, null]
      : await Promise.all([
        supabase.rpc('get_owner_profit_snapshot', snapshotArgs),
        fetchAllRows<WithdrawalMethodRow>(() => supabase
          .from('owner_withdrawals')
          .select('id,payment_method')
          .eq('club_id', selectedClubId)
          .not('payment_method', 'is', null)
          .order('id')),
      ]);
    if (!isCurrent()) return EMPTY_OWNER_MONEY;

    // Before migration 071 there is nothing to carry: balances stay per month.
    const carryoversMissing = isMissingDatabaseTable(carryoverRes.error as { code?: string; message?: string } | null, 'owner_profit_carryovers');
    if (carryoverRes.error && !carryoversMissing) throw new Error(carryoverRes.error.message);
    const carryovers = (carryoverRes.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
    const withCarryovers = (byMonth: AvailableMoneyByMonth) => applyOwnerProfitCarryovers(byMonth, carryovers, currentMonth);

    // Before migration 066 there is no payment_method column: keep every
    // withdrawal unassigned and record new ones by source only.
    const methodsMissing = isMissingDatabaseColumn(methodRes?.error as { code?: string; message?: string } | null, 'payment_method');
    if (methodRes?.error && !methodsMissing) throw new Error(methodRes.error.message);
    const methodById = methodRes
      ? new Map((methodRes.data ?? []).map((row) => [row.id, row.payment_method]))
      : null;
    const withMethods = (rows: OwnerWithdrawal[]) => rows.map((row) => ({
      ...row,
      payment_method: (methodById ? methodById.get(row.id) : row.payment_method) ?? null,
    }));
    const supported = { carryoversSupported: !carryoversMissing, methodsSupported: !methodsMissing };

    if (!snapshotResult.error && snapshotResult.data?.paymentMethodBalancesByMonth) {
      const snapshot = buildOwnerProfitSnapshot(snapshotResult.data as OwnerProfitSnapshotPayload);
      return {
        balancesByMonth: withCarryovers(snapshot.byMonth),
        paymentMethodBalancesByMonth: withExchangesByMonth(snapshot.paymentMethodBalancesByMonth, exchangeRows),
        withdrawals: withMethods(snapshot.withdrawals),
        carryovers,
        ...supported,
      };
    }

    if (snapshotResult.error && (snapshotHasMethods || !isMissingDatabaseFunction(snapshotResult.error, 'get_owner_profit_snapshot'))) {
      throw new Error(snapshotResult.error.message);
    }

    // Compatibility fallback while the application and migration are deployed separately.
    const [cashRes, stockRes, purchaseRes, expenseRes, debtPaymentRes, withdrawalRes] = await Promise.all([
      fetchAllRows<DailyCashRow>(() => supabase
        .from('daily_cash_entries')
        .select('date,cash_income,terminal_income,card_income,playstation_income')
        .eq('club_id', selectedClubId)
        .lte('date', businessToday)
        .order('id')),
      fetchAllRows<StockCountRow>(() => supabase
        .from('daily_stock_counts')
        .select('date,bar_income,bar_profit,bar_cost,sold_quantity')
        .eq('club_id', selectedClubId)
        .lte('date', businessToday)
        .order('id')),
      fetchAllRows<StockPurchaseCostRow>(() => supabase
        .from('stock_purchases')
        .select('date,quantity,cost_price')
        .eq('club_id', selectedClubId)
        .lte('date', businessToday)
        .order('id')),
      fetchAllRows<ExpenseRow>(() => supabase
        .from('expenses')
        .select('id,date,amount,category,payment_method,payment_source,comment,created_at')
        .eq('club_id', selectedClubId)
        .lte('date', businessToday)
        .order('id')),
      fetchAllRows<DebtPaymentValueRow>(() => supabase
        .from('debt_payments')
        .select('date,amount,payment_method')
        .eq('club_id', selectedClubId)
        .lte('date', businessToday)
        .order('id')),
      fetchAllRows<OwnerWithdrawal>(() => supabase
        .from('owner_withdrawals')
        .select('id,club_id,period_month,source,amount,comment,created_by,created_at,updated_at')
        .eq('club_id', selectedClubId)
        .lte('period_month', `${currentMonth}-01`)
        .order('period_month', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id')),
    ]);
    const firstError = [
      cashRes.error,
      stockRes.error,
      purchaseRes.error,
      expenseRes.error,
      debtPaymentRes.error,
      withdrawalRes.error,
    ].find(Boolean);
    if (firstError) throw new Error(firstError.message);

    const withdrawalRows = withdrawalRes.data ?? [];
    const nextLedgerRows = {
      cashRows: cashRes.data ?? [],
      stockRows: stockRes.data ?? [],
      purchaseRows: purchaseRes.data ?? [],
      expenseRows: expenseRes.data ?? [],
      debtPaymentRows: debtPaymentRes.data ?? [],
      withdrawalRows,
    };
    return {
      balancesByMonth: withCarryovers(calculateAvailableMoneyByMonth({
        ...nextLedgerRows,
        throughDate: businessToday,
      })),
      paymentMethodBalancesByMonth: withExchangesByMonth(gameClubMoneyLeftByPaymentMethodByMonth(
        nextLedgerRows.cashRows,
        nextLedgerRows.expenseRows,
        nextLedgerRows.debtPaymentRows,
      ), exchangeRows),
      withdrawals: withMethods(withdrawalRows),
      carryovers,
      ...supported,
    };
  }, [businessToday, currentMonth, selectedClubId]);
  const ownerMoney = useClubQuery(loadOwnerMoney, EMPTY_OWNER_MONEY);
  const {
    balancesByMonth,
    paymentMethodBalancesByMonth,
    withdrawals,
    carryovers,
    carryoversSupported,
    methodsSupported,
  } = ownerMoney.data;
  /** Balances failed to load; mutations stay disabled until a successful reload. */
  const { loading, error, reload: loadData } = ownerMoney;
  // A club switch or business-day rollover replaces the loader; a mutation or
  // confirm dialog that started under the previous one is stale.
  const currentLoad = useRef(loadOwnerMoney);
  useEffect(() => {
    currentLoad.current = loadOwnerMoney;
  }, [loadOwnerMoney]);

  const withdrawalMonths = useMemo(() => {
    const groups = new Map<string, OwnerWithdrawal[]>();
    for (const withdrawal of withdrawals) {
      const month = withdrawal.period_month.slice(0, 7);
      const rows = groups.get(month) ?? [];
      rows.push(withdrawal);
      groups.set(month, rows);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [withdrawals]);

  const sourceAvailable = useMemo(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.month)) return 0;

    const availableForMonth = balancesByMonth[form.month];
    if (!availableForMonth) return 0;
    const gameClubAvailable = Math.max(0, availableForMonth.gameClub.available);
    const barAvailable = Math.max(0, availableForMonth.bar.available);
    // "All" is one RPC call that takes Game Club first, then Bar, never overdrawing
    // either: its cap is the sum of the two independent positive balances. This is
    // a withdrawal limit only, not a combined club + bar figure shown to anyone.
    const sourceBalance = form.source === 'all'
      ? gameClubAvailable + barAvailable
      : form.source === 'bar'
        ? barAvailable
        : gameClubAvailable;

    return Math.max(0, sourceBalance);
  }, [balancesByMonth, form.month, form.source]);

  const paymentMethodBalances = paymentMethodBalancesByMonth[form.month] ?? emptyMoneyLeftByPaymentMethod;
  const monthlyBalance = balancesByMonth[form.month];
  const methodBreakdown = useMemo(
    () => gameClubWithdrawalsByMethod(paymentMethodBalances, withdrawals, form.month, carryovers),
    [paymentMethodBalances, withdrawals, form.month, carryovers],
  );
  const monthCarried = useMemo(() => carryoversForMonth(carryovers, form.month), [carryovers, form.month]);
  const monthHasCarryovers = carryovers.some((row) => (
    row.from_month.slice(0, 7) === form.month || row.to_month.slice(0, 7) === form.month
  ));
  const usesPaymentMethod = methodsSupported && form.source === 'game_club';
  /** Per method: its own balance, capped by what is left of Game Club profit this month. */
  const methodWithdrawable = useMemo(() => {
    const gameClubAvailable = Math.max(0, monthlyBalance?.gameClub.available ?? 0);
    return Object.fromEntries(methodBreakdown.methods.map((row) => [
      row.method,
      availableForPaymentMethod(row.available, gameClubAvailable),
    ])) as Record<OwnerWithdrawalPaymentMethod, number>;
  }, [methodBreakdown, monthlyBalance]);
  // Methods switched off for the club stay selectable only while they still hold money.
  const pickerMethods = OWNER_WITHDRAWAL_PAYMENT_METHODS.filter((method) => (
    method === 'playstation'
    || (enabledPaymentMethods as readonly string[]).includes(method)
    || methodWithdrawable[method] > 0
  ));
  const withdrawable = usesPaymentMethod
    ? (form.paymentMethod ? methodWithdrawable[form.paymentMethod] : 0)
    : sourceAvailable;

  useEffect(() => {
    if (!usesPaymentMethod) return;
    setForm((current) => {
      if (current.paymentMethod && methodWithdrawable[current.paymentMethod] > 0) return current;
      const next = OWNER_WITHDRAWAL_PAYMENT_METHODS.find((method) => methodWithdrawable[method] > 0) ?? '';
      return next === current.paymentMethod ? current : { ...current, paymentMethod: next };
    });
  }, [methodWithdrawable, usesPaymentMethod]);

  useEffect(() => {
    setForm((current) => {
      const amount = clampWithdrawalInput(current.amount, withdrawable);
      return amount === current.amount ? current : { ...current, amount };
    });
  }, [withdrawable]);

  // The game club and the bar are separate businesses: each shows its own figures.
  const headlineSources = (['game_club', 'bar'] as const).map((source) => {
    const balance = source === 'game_club' ? monthlyBalance?.gameClub : monthlyBalance?.bar;
    return {
      source,
      earned: balance?.earned ?? 0,
      withdrawn: balance?.withdrawn ?? 0,
      available: balance?.available ?? 0,
      carried: monthCarried.bySource[source],
    };
  });
  const amountValue = parseCurrencyInput(form.amount);
  const amountValid = Number.isFinite(amountValue) && amountValue > 0 && amountValue <= withdrawable;
  // Carryovers move money between months of one source (and one Game Club method).
  const carrySourceSelected = form.source !== 'all' && (form.source !== 'game_club' || Boolean(form.paymentMethod));
  const canCarry = carryoversSupported && carrySourceSelected && amountValid;

  function setField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mutationPending.current || loading || error) return;
    const amount = parseCurrencyInput(form.amount);

    if (!selectedClubId || !isOwner) {
      showToast(t('ownerOnly'), 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > withdrawable || (usesPaymentMethod && !form.paymentMethod)) {
      showToast(t('exceedsAvailable'), 'error');
      return;
    }

    const operationLoad = currentLoad.current;
    mutationPending.current = true;
    setSaving('withdraw');
    try {
      const supabase = createClient();
      const rpcName = usesPaymentMethod ? 'withdraw_owner_game_club_money_by_method' : 'withdraw_owner_money_for_month';
      const { error: insertError } = usesPaymentMethod
        ? await supabase.rpc(rpcName, {
          p_club_id: selectedClubId,
          p_period_month: `${form.month}-01`,
          p_payment_method: form.paymentMethod,
          p_amount: amount,
          p_comment: form.comment.trim() || null,
        })
        : await supabase.rpc(rpcName, {
          p_club_id: selectedClubId,
          p_period_month: `${form.month}-01`,
          p_source: form.source,
          p_amount: amount,
          p_comment: form.comment.trim() || null,
        });

      if (operationLoad !== currentLoad.current) return;
      if (insertError) {
        showToast(isMissingDatabaseFunction(insertError, rpcName)
          ? t(usesPaymentMethod ? 'methodMigrationRequired' : 'migrationRequired')
          : insertError.code === '23514' ? t('exceedsAvailable') : t('saveError'), 'error');
        await loadData({ silent: true });
        return;
      }

      setForm((current) => ({ ...current, comment: '', amount: '' }));
      showToast(t('saved'), 'success');
      await loadData({ silent: true });
    } catch {
      if (operationLoad !== currentLoad.current) return;
      showToast(t('saveError'), 'error');
      await loadData({ silent: true });
    } finally {
      mutationPending.current = false;
      setSaving(null);
    }
  }

  async function handleCarry() {
    if (mutationPending.current || loading || error || !canCarry) return;
    const amount = parseCurrencyInput(form.amount);

    if (!selectedClubId || !isOwner) {
      showToast(t('ownerOnly'), 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > withdrawable) {
      showToast(t('exceedsAvailable'), 'error');
      return;
    }

    const loadBeforeConfirm = currentLoad.current;
    const confirmed = await confirm({
      title: t('carryTitle'),
      description: t('carryConfirm', {
        amount: currency(amount),
        source: formSourceLabel,
        from: formatYearMonth(form.month, locale),
        to: formatYearMonth(nextYearMonth(form.month), locale),
      }),
      confirmLabel: t('carryButton'),
      tone: 'primary',
    });
    if (!confirmed || loadBeforeConfirm !== currentLoad.current || mutationPending.current) return;

    const operationLoad = currentLoad.current;
    mutationPending.current = true;
    setSaving('carry');
    try {
      const supabase = createClient();
      const { error: carryError } = await supabase.rpc('carry_owner_profit_to_next_month', {
        p_club_id: selectedClubId,
        p_from_month: `${form.month}-01`,
        p_source: form.source,
        p_payment_method: form.source === 'game_club' ? form.paymentMethod : null,
        p_amount: amount,
        p_comment: form.comment.trim() || null,
      });

      if (operationLoad !== currentLoad.current) return;
      if (carryError) {
        showToast(isMissingDatabaseFunction(carryError, 'carry_owner_profit_to_next_month')
          ? t('carryMigrationRequired')
          : carryError.code === '23514' ? t('exceedsAvailable') : t('carryError'), 'error');
        await loadData({ silent: true });
        return;
      }

      setForm((current) => ({ ...current, comment: '', amount: '' }));
      showToast(t('carried'), 'success');
      await loadData({ silent: true });
    } catch {
      if (operationLoad !== currentLoad.current) return;
      showToast(t('carryError'), 'error');
      await loadData({ silent: true });
    } finally {
      mutationPending.current = false;
      setSaving(null);
    }
  }

  async function handleDeleteCarryover(row: OwnerProfitCarryover) {
    if (mutationPending.current || loading || error || row.club_id !== selectedClubId) return;
    if (!selectedClubId || !isOwner) return;
    const loadBeforeConfirm = currentLoad.current;
    const confirmed = await confirm({
      title: tc('delete'),
      description: t('carryDeleteConfirm', {
        amount: currency(row.amount),
        source: carryoverSourceLabel(row),
        from: formatYearMonth(row.from_month.slice(0, 7), locale),
        to: formatYearMonth(row.to_month.slice(0, 7), locale),
      }),
      confirmLabel: tc('delete'),
    });
    if (!confirmed || loadBeforeConfirm !== currentLoad.current || mutationPending.current) return;

    const operationLoad = currentLoad.current;
    mutationPending.current = true;
    setDeletingId(row.id);
    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase.rpc('delete_owner_profit_carryover', {
        p_club_id: selectedClubId,
        p_carryover_id: row.id,
      });

      if (operationLoad !== currentLoad.current) return;
      if (deleteError) {
        showToast(deleteError.code === '23514' ? t('carryDeleteUsed') : t('deleteError'), 'error');
        await loadData({ silent: true });
        return;
      }

      showToast(t('carryDeleted'), 'success');
      await loadData({ silent: true });
    } catch {
      if (operationLoad !== currentLoad.current) return;
      showToast(t('deleteError'), 'error');
      await loadData({ silent: true });
    } finally {
      mutationPending.current = false;
      setDeletingId(null);
    }
  }

  async function handleDelete(row: OwnerWithdrawal) {
    if (mutationPending.current || loading || error || row.club_id !== selectedClubId) return;
    if (!selectedClubId || !isOwner) return;
    const loadBeforeConfirm = currentLoad.current;
    const confirmed = await confirm({
      title: tc('delete'),
      description: t('deleteConfirmDetailed', {
        amount: currency(row.amount),
        source: withdrawalSourceLabel(row),
        month: formatYearMonth(row.period_month.slice(0, 7), locale),
      }),
      confirmLabel: tc('delete'),
    });
    // A club switch or reload while the dialog was open makes `row` stale.
    if (!confirmed || loadBeforeConfirm !== currentLoad.current || mutationPending.current) return;

    const operationLoad = currentLoad.current;
    mutationPending.current = true;
    setDeletingId(row.id);
    try {
      const supabase = createClient();
      const { data: deletedRows, error: deleteError } = await supabase
        .from('owner_withdrawals')
        .delete()
        .eq('club_id', selectedClubId)
        .eq('id', row.id)
        .select('id');

      if (operationLoad !== currentLoad.current) return;
      // RLS hides a refused delete as zero affected rows, not as an error.
      if (deleteError || !deletedRows?.length) {
        showToast(t('deleteError'), 'error');
        await loadData({ silent: true });
        return;
      }

      showToast(t('deleted'), 'success');
      await loadData({ silent: true });
    } catch {
      if (operationLoad !== currentLoad.current) return;
      showToast(t('deleteError'), 'error');
      await loadData({ silent: true });
    } finally {
      mutationPending.current = false;
      setDeletingId(null);
    }
  }

  const currency = (amount: number) => `${formatCurrency(amount)} ${tc('currency')}`;
  const methodLabel = (method: OwnerWithdrawalPaymentMethod) => (
    method === 'playstation' ? t('playstation') : tc(`paymentMethods.${method}`)
  );
  function withdrawalSourceLabel(row: Pick<OwnerWithdrawal, 'source' | 'payment_method'>) {
    const source = t(`sources.${row.source}`);
    return row.payment_method ? `${source} · ${methodLabel(row.payment_method)}` : source;
  }
  const carryoverSourceLabel = (row: OwnerProfitCarryover) => withdrawalSourceLabel(row);
  const formSourceLabel = withdrawalSourceLabel({
    source: form.source === 'all' ? 'game_club' : form.source,
    payment_method: form.source === 'game_club' && form.paymentMethod ? form.paymentMethod : null,
  });
  const sourceOptions = PROFIT_SOURCES.map((source) => ({ value: source, label: t(`sources.${source}`) }));

  const breakdownRows: BreakdownRow[] = [
    {
      key: 'game_club',
      label: t('sources.game_club'),
      earned: monthlyBalance?.gameClub.earned ?? 0,
      carried: monthCarried.bySource.game_club,
      withdrawn: monthlyBalance?.gameClub.withdrawn ?? 0,
      available: monthlyBalance?.gameClub.available ?? 0,
    },
    ...methodBreakdown.methods.map((row) => ({
      key: `method:${row.method}`,
      label: methodLabel(row.method),
      earned: row.earned,
      carried: row.carried,
      withdrawn: row.withdrawn,
      available: row.available,
      nested: true,
    })),
    ...(methodBreakdown.unassignedWithdrawn > 0 ? [{
      key: 'method:unassigned',
      label: t('unassignedMethod'),
      earned: null,
      carried: 0,
      withdrawn: methodBreakdown.unassignedWithdrawn,
      available: null,
      nested: true,
      hint: t('unassignedMethodHint'),
    }] : []),
    {
      key: 'bar',
      label: t('sources.bar'),
      earned: monthlyBalance?.bar.earned ?? 0,
      carried: monthCarried.bySource.bar,
      withdrawn: monthlyBalance?.bar.withdrawn ?? 0,
      available: monthlyBalance?.bar.available ?? 0,
    },
  ];

  const emptyCell = <span className="text-gray-300">—</span>;
  const amountCell = (amount: number, className: string) => (
    <span className={cn('tabular-nums', className)}>{formatCurrency(amount)}</span>
  );
  const carriedCell = (amount: number, className?: string) => (amount === 0
    ? <span className="tabular-nums text-gray-400">0</span>
    : (
      <span className={cn('tabular-nums', amount > 0 ? 'text-success-600' : 'text-gray-600', className)}>
        {amount > 0 ? '+' : '−'}{formatCurrency(Math.abs(amount))}
      </span>
    ));
  // Fixed widths keep the money columns aligned between source and method rows.
  const moneyColumnClassName = monthHasCarryovers ? 'w-[16%] whitespace-nowrap' : 'w-[22%] whitespace-nowrap';

  const breakdownColumns: DataTableColumn<BreakdownRow>[] = [
    {
      key: 'label',
      header: t('source'),
      className: 'w-[34%]',
      render: (row) => (row.nested ? (
        <span className="flex items-center gap-2 pl-4 text-gray-600">
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-gray-200" />
          <span className="min-w-0">
            <span className="block">{row.label}</span>
            {row.hint ? <span className="block text-xs leading-5 text-gray-400">{row.hint}</span> : null}
          </span>
        </span>
      ) : (
        <span className="font-semibold text-gray-900">{row.label}</span>
      )),
    },
    {
      key: 'earned',
      header: t('earnedBeforeWithdrawals'),
      align: 'right',
      className: moneyColumnClassName,
      render: (row) => (row.earned === null
        ? emptyCell
        : amountCell(row.earned, cn(
          row.nested ? 'text-gray-700' : 'font-semibold',
          metricToneClassName[toneForAmount(row.earned, row.nested ? 'muted' : 'default')],
        ))),
    },
    ...(monthHasCarryovers ? [{
      key: 'carried',
      header: t('carriedColumn'),
      align: 'right' as const,
      className: moneyColumnClassName,
      render: (row: BreakdownRow) => (row.earned === null ? emptyCell : carriedCell(row.carried, row.nested ? undefined : 'font-semibold')),
    }] : []),
    {
      key: 'withdrawn',
      header: t('monthlyWithdrawn'),
      align: 'right',
      className: moneyColumnClassName,
      render: (row) => amountCell(row.withdrawn, cn(
        !row.nested && 'font-semibold',
        row.withdrawn > 0 ? 'text-danger-600' : 'text-gray-400',
      )),
    },
    {
      key: 'available',
      header: t('monthlyRemaining'),
      align: 'right',
      className: moneyColumnClassName,
      render: (row) => (row.available === null
        ? emptyCell
        : amountCell(row.available, cn(
          !row.nested && 'font-semibold',
          metricToneClassName[toneForAmount(row.available)],
        ))),
    },
  ];

  const historyRows: HistoryRow[] = [
    ...withdrawalMonths.flatMap(([month, rows]) => rows.map((withdrawal) => ({
      kind: 'withdrawal' as const, id: withdrawal.id, month, withdrawal,
    }))),
    ...carryovers.map((carryover) => ({
      kind: 'carryover' as const, id: carryover.id, month: carryover.from_month.slice(0, 7), carryover,
    })),
  ].sort((a, b) => b.month.localeCompare(a.month) || historyCreatedAt(b).localeCompare(historyCreatedAt(a)));

  /**
   * The month's name, its overall withdrawn total, then each side's share.
   * The overall total is the one owner-requested club + bar figure (see
   * docs/agents/domain-finance.md, "Owner available money").
   */
  function historyMonthHeader(month: string) {
    const totals = withdrawnBySourceForMonth(withdrawals, month);
    const sides = (['game_club', 'bar'] as const).filter((source) => totals[source] > 0);
    return (
      <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>{capitalizeFirst(formatYearMonth(month, locale), locale)}</span>
        {sides.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-normal text-gray-500">
            <span className="whitespace-nowrap text-gray-700">
              {t('historyMonthTotal')}:{' '}
              <span className="font-bold tabular-nums text-danger-600">-{formatCurrency(totals.game_club + totals.bar)}</span>
            </span>
            {sides.map((source) => (
              <span key={source} className="whitespace-nowrap">
                {t(`sources.${source}`)}:{' '}
                <span className="font-semibold tabular-nums text-danger-600">-{formatCurrency(totals[source])}</span>
              </span>
            ))}
          </span>
        )}
      </span>
    );
  }

  // Rows are already newest month first, so each month becomes one titled section.
  const historyGroups = historyRows.reduce<DataTableGroup<HistoryRow>[]>((groups, row) => {
    const last = groups.at(-1);
    if (last?.key === row.month) last.rows.push(row);
    else groups.push({ key: row.month, header: historyMonthHeader(row.month), rows: [row] });
    return groups;
  }, []);

  const historyColumns: DataTableColumn<HistoryRow>[] = [
    {
      key: 'source',
      header: t('source'),
      className: 'whitespace-nowrap',
      render: (row) => {
        const entry = row.kind === 'withdrawal' ? row.withdrawal : row.carryover;
        return (
          <span className="flex flex-col items-start gap-1">
            <Badge variant="neutral">{t(`sources.${entry.source}`)}</Badge>
            {entry.source === 'game_club' ? (
              <span className={cn('text-xs', entry.payment_method ? 'text-gray-600' : 'text-gray-400')}>
                {entry.payment_method ? methodLabel(entry.payment_method) : t('unassignedMethod')}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: t('amount'),
      align: 'right',
      className: 'whitespace-nowrap',
      render: (row) => (row.kind === 'withdrawal'
        ? <span className="font-semibold text-danger-600">−{formatCurrency(row.withdrawal.amount)}</span>
        : (
          <span className="flex flex-col items-end gap-1">
            <span className="font-semibold text-gray-700">{formatCurrency(row.carryover.amount)}</span>
            <Badge variant="info">{t('carriedTo', { month: formatYearMonth(row.carryover.to_month.slice(0, 7), locale) })}</Badge>
          </span>
        )),
    },
    {
      key: 'comment',
      header: t('comment'),
      className: 'min-w-[160px]',
      render: (row) => {
        const comment = row.kind === 'withdrawal' ? row.withdrawal.comment : row.carryover.comment;
        return comment ? <span className="break-words text-gray-600">{comment}</span> : emptyCell;
      },
    },
    {
      key: 'recorded',
      header: t('recordedColumn'),
      className: 'whitespace-nowrap',
      render: (row) => <span className="text-gray-500">{formatDateTime(historyCreatedAt(row), locale)}</span>,
    },
    ...(isOwner ? [{
      key: 'actions',
      header: <span className="sr-only">{tc('actions')}</span>,
      align: 'right' as const,
      className: 'w-14',
      render: (row: HistoryRow) => {
        const entry = row.kind === 'withdrawal' ? row.withdrawal : row.carryover;
        return (
          <IconButton
            variant="danger"
            size="sm"
            label={`${tc('delete')}: ${withdrawalSourceLabel(entry)} · ${currency(entry.amount)}`}
            icon={<Trash2 size={16} />}
            loading={deletingId === row.id}
            disabled={loading || !!error || saving !== null || deletingId !== null}
            onClick={() => (row.kind === 'withdrawal' ? handleDelete(row.withdrawal) : handleDeleteCarryover(row.carryover))}
          />
        );
      },
    }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        action={(
          <Field label={t('month')} className="sm:w-64">
            <MonthPicker value={form.month} max={currentMonth} onChange={(value) => setField('month', value)} />
          </Field>
        )}
      />

      {error ? (
        <LoadErrorAlert retrying={loading} onRetry={() => void loadData()}>
          {t('loadError')}
        </LoadErrorAlert>
      ) : null}

      {/* What the owner can still take out this month, per business: never added together. */}
      <Card as="section" padding="lg" aria-labelledby="owner-profit-headline">
        <p id="owner-profit-headline" className="text-[13px] font-medium text-gray-500">
          {t('monthlyRemaining')} · {formatYearMonth(form.month, locale)}
        </p>
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          {headlineSources.map((side) => (
            <div key={side.source} className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{t(`sources.${side.source}`)}</p>
              {loading ? (
                <div className="mt-3 space-y-2" role="status" aria-label={tc('loading')}>
                  <Skeleton className="h-10 w-48 max-w-full" />
                  <Skeleton className="h-3 w-40 bg-gray-100" />
                </div>
              ) : (
                <>
                  <p className={cn('mt-2 break-words text-3xl font-bold leading-none tracking-tight tabular-nums sm:text-4xl', metricToneClassName[toneForAmount(side.available)])}>
                    {formatCurrency(side.available)}
                    <span className="ml-2 text-base font-medium tracking-normal text-gray-500">{tc('currency')}</span>
                  </p>
                  <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    <div className="flex items-baseline gap-2">
                      <dt className="text-gray-500">{t('earnedBeforeWithdrawals')}</dt>
                      <dd className="font-semibold tabular-nums text-gray-900">{formatCurrency(side.earned)}</dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt className="text-gray-500">{t('monthlyWithdrawn')}</dt>
                      <dd className={cn('font-semibold tabular-nums', side.withdrawn > 0 ? 'text-danger-600' : 'text-gray-900')}>{formatCurrency(side.withdrawn)}</dd>
                    </div>
                    {monthHasCarryovers ? (
                      <div className="flex items-baseline gap-2">
                        <dt className="text-gray-500">{t('carriedColumn')}</dt>
                        <dd className="font-semibold">{carriedCell(side.carried)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card as="section" padding="none" className="overflow-hidden">
        <CardHeader>
          <SectionHeading title={t('breakdownTitle')} description={t('clubMethodsBeforeWithdrawals')} />
        </CardHeader>
        {loading ? (
          <TableSkeleton rows={6} columns={4} className="rounded-none border-0 shadow-none" />
        ) : (
          <DataTable
            bare
            dense
            label={t('breakdownTitle')}
            minWidth={640}
            columns={breakdownColumns}
            data={breakdownRows}
            keyExtractor={(row) => row.key}
            rowClassName={(row) => (row.nested ? 'bg-gray-50/40' : undefined)}
          />
        )}
      </Card>

      {loading ? (
        <div className={`grid gap-5 ${isOwner ? 'xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]' : ''}`}>
          {isOwner ? <FormSkeleton /> : null}
          <TableSkeleton rows={5} columns={4} />
        </div>
      ) : (
        <div className={`grid gap-5 ${isOwner ? 'xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]' : ''}`}>
          {isOwner ? (
            <Card as="form" onSubmit={handleSubmit} className="h-fit">
              <SectionHeading
                title={t('recordTitle')}
                description={t('notAnExpense')}
                className="mb-5"
              />

              <div className="space-y-4">
                <Field
                  label={t('source')}
                  hint={usesPaymentMethod ? undefined : (
                    <>
                      {t('availableForSource')}:{' '}
                      <span className="font-semibold tabular-nums text-success-600">{currency(sourceAvailable)}</span>
                    </>
                  )}
                >
                  <SegmentedControl label={t('source')} options={sourceOptions} value={form.source} onChange={(source) => setField('source', source)} disabled={loading} />
                </Field>

                {usesPaymentMethod ? (
                  <Field
                    label={t('paymentMethod')}
                    required
                    hint={form.paymentMethod ? (
                      <>
                        {t('availableForMethod', { method: methodLabel(form.paymentMethod) })}:{' '}
                        <span className="font-semibold tabular-nums text-success-600">{currency(withdrawable)}</span>
                      </>
                    ) : t('noMethodAvailable')}
                  >
                    <SegmentedControl
                      label={t('paymentMethod')}
                      columns="auto"
                      className="grid-cols-2 sm:grid-cols-4"
                      value={form.paymentMethod}
                      onChange={(paymentMethod) => setField('paymentMethod', paymentMethod)}
                      disabled={loading}
                      options={pickerMethods.map((method) => ({
                        value: method,
                        disabled: methodWithdrawable[method] <= 0,
                        label: (
                          <span className="flex flex-col items-center py-1 leading-tight">
                            <span>{methodLabel(method)}</span>
                            <span className="mt-0.5 text-[11px] font-normal tabular-nums opacity-80">{formatCurrency(methodWithdrawable[method])}</span>
                          </span>
                        ),
                      }))}
                    />
                  </Field>
                ) : null}

                <Field
                  label={`${t('amount')} (${tc('currency')})`}
                  htmlFor="withdrawal-amount"
                  required
                  hint={form.source === 'all' ? t(methodsSupported ? 'allAllocationUnassigned' : 'allAllocation') : undefined}
                  error={form.amount && !amountValid ? t('exceedsAvailable') : undefined}
                >
                  <CurrencyInput
                    id="withdrawal-amount"
                    required
                    value={form.amount}
                    invalid={Boolean(form.amount) && !amountValid}
                    onValueChange={(value) => setField('amount', clampWithdrawalInput(value, withdrawable))}
                  />
                </Field>

                <Field label={t('comment')} htmlFor="withdrawal-comment">
                  <Input
                    id="withdrawal-comment"
                    type="text"
                    value={form.comment}
                    onChange={(event) => setField('comment', event.target.value)}
                    placeholder={t('commentPlaceholder')}
                    maxLength={250}
                  />
                </Field>

                <div className="space-y-2">
                  <Button
                    type="submit"
                    fullWidth
                    disabled={loading || !!error || deletingId !== null || saving === 'carry' || !amountValid}
                    loading={saving === 'withdraw'}
                    loadingLabel={tc('saving')}
                    icon={<ArrowDownToLine size={18} aria-hidden="true" />}
                  >
                    {t('recordButton')}
                  </Button>
                  {carryoversSupported ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        fullWidth
                        disabled={loading || !!error || deletingId !== null || saving === 'withdraw' || !canCarry}
                        loading={saving === 'carry'}
                        loadingLabel={tc('saving')}
                        icon={<CalendarArrowUp size={18} aria-hidden="true" />}
                        onClick={() => void handleCarry()}
                      >
                        {t('carryButtonTo', { month: formatYearMonth(nextYearMonth(form.month), locale) })}
                      </Button>
                      <p className="text-xs leading-5 text-gray-500">
                        {form.source === 'all' ? t('carryChooseSource') : t('carryHint')}
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : null}

          <Card as="section" padding="none" className="h-fit overflow-hidden">
            <CardHeader>
              <SectionHeading title={t('historyTitle')} description={t('historyDescription')} />
            </CardHeader>
            {error && historyRows.length === 0 ? null : (
              <DataTable
                bare
                dense
                label={t('historyTitle')}
                minWidth={isOwner ? 600 : 520}
                columns={historyColumns}
                data={historyRows}
                groups={historyGroups}
                keyExtractor={(row) => `${row.kind}:${row.id}`}
                emptyState={<EmptyState compact title={t('noHistory')} />}
              />
            )}
          </Card>
        </div>
      )}

      {toastElement}
      {confirmDialog}
    </div>
  );
}
