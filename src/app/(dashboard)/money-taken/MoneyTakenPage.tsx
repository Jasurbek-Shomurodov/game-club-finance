'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, CalendarArrowUp, HandCoins, Layers, PiggyBank, Target, TriangleAlert, TrendingUp, Undo2, Wallet, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useClub } from '@/components/layout/DashboardShell';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  Button,
  Card,
  CardHeader,
  CurrencyInput,
  DataTable,
  Field,
  FormSkeleton,
  InlineAlert,
  Input,
  LoadErrorAlert,
  Modal,
  MonthPicker,
  NoteField,
  PageHeader,
  SectionHeading,
  SegmentedControl,
  Skeleton,
  TableSkeleton,
  metricToneClassName,
  toneForAmount,
  useConfirm,
  useEntryNoteGuard,
  useToast,
  type DataTableColumn,
} from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { EMPTY_OWNER_MONEY, fetchOwnerMoney, type OwnerMoneyData } from '@/lib/supabase/ownerMoney';
import {
  availableForPaymentMethod,
  carryoversForMonth,
  gameClubWithdrawalsByMethod,
} from '@/lib/calculations/ownerProfitSnapshot';
import { isNoteRequiredError } from '@/lib/entryNote';
import { clampWithdrawalInput } from '@/lib/withdrawalInput';
import { isMissingDatabaseFunction } from '@/lib/supabase/errors';
import { emptyMoneyLeftByPaymentMethod } from '@/lib/calculations/dashboardMetrics';
import { dollarsForMonth } from '@/lib/calculations/moneyExchanges';
import {
  formatCurrency,
  formatCurrencyInput,
  formatUnitCurrency,
  parseCurrencyInput,
  formatYearMonth,
} from '@/lib/formatters';
import { monthRange, nextYearMonth } from '@/lib/utils';
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
import { METHOD_ICONS, SOURCE_ICONS, SOURCE_TINTS } from './profitIcons';
import { WithdrawalHistory, historyCreatedAt, type HistoryRow } from './WithdrawalHistory';
import { CashShortagesSection } from './CashShortagesSection';
import { ReserveSection } from './ReserveSection';
import { reserveActivity, reserveBalances, reserveForMonth, reservedNet, type ReserveActivity } from '@/lib/calculations/ownerReserve';
import {
  deleteReserveEntry,
  depositToReserve,
  returnFromReserve,
  setReserveGoal,
  type ReserveErrorCode,
} from '@/lib/supabase/ownerReserve';
import { CashShortageForm } from '@/components/cash-shortages/CashShortageForm';
import {
  EMPTY_CASH_SHORTAGES,
  deleteCashShortage,
  fetchCashShortages,
  recoverCashShortage,
  type CashShortageData,
  type ShortageErrorCode,
} from '@/lib/supabase/cashShortages';
import {
  cashShortageTotalsForMonth,
  recoverableAmount,
  summarizeCashShortages,
  type CashShortageSummary,
} from '@/lib/calculations/cashShortages';

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
  /** Net money put into the owner reserve this month. */
  reserved: number;
  withdrawn: number;
  available: number | null;
  nested?: boolean;
  hint?: string;
  icon?: LucideIcon;
}

const emptyForm = (month: string) => ({
  month,
  source: 'game_club' as MoneySource,
  paymentMethod: '' as OwnerWithdrawalPaymentMethod | '',
  comment: '',
  amount: '',
});

export default function MoneyTakenPage() {
  const t = useTranslations('moneyTaken');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { selectedClubId, role, businessDayStartHour, enabledPaymentMethods } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const note = useEntryNoteGuard();
  const businessToday = useBusinessToday(businessDayStartHour);
  const currentMonth = businessToday.slice(0, 7);
  const [saving, setSaving] = useState<'withdraw' | 'carry' | 'reserve' | null>(null);
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

  const loadOwnerMoney = useCallback(async (isCurrent: () => boolean): Promise<OwnerMoneyData> => (
    selectedClubId ? fetchOwnerMoney(createClient(), selectedClubId, businessToday, isCurrent) : EMPTY_OWNER_MONEY
  ), [businessToday, selectedClubId]);
  const ownerMoney = useClubQuery(loadOwnerMoney, EMPTY_OWNER_MONEY);
  // Shortages are owner-only (RLS); other roles never load them.
  const loadShortages = useCallback(async (): Promise<CashShortageData> => (
    selectedClubId && isOwner ? fetchCashShortages(createClient(), selectedClubId) : EMPTY_CASH_SHORTAGES
  ), [isOwner, selectedClubId]);
  const shortageQuery = useClubQuery(loadShortages, EMPTY_CASH_SHORTAGES);
  const tsh = useTranslations('cashShortages');
  const tr = useTranslations('ownerReserve');
  const [returnTarget, setReturnTarget] = useState<OwnerWithdrawalSource | null>(null);
  const [returnMethod, setReturnMethod] = useState<OwnerWithdrawalPaymentMethod>('cash');
  const [returnInput, setReturnInput] = useState('');
  const [goalTarget, setGoalTarget] = useState<OwnerWithdrawalSource | null>(null);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [reserveError, setReserveError] = useState<ReserveErrorCode | null>(null);
  const [reserveBusy, setReserveBusy] = useState<string | null>(null);
  const reserveRequestId = useRef<string | null>(null);
  const [shortageFormOpen, setShortageFormOpen] = useState(false);
  const [recoverTarget, setRecoverTarget] = useState<CashShortageSummary | null>(null);
  const [recoverInput, setRecoverInput] = useState('');
  const [recoverError, setRecoverError] = useState<ShortageErrorCode | null>(null);
  const [shortageBusy, setShortageBusy] = useState<string | null>(null);
  const recoverRequestId = useRef<string | null>(null);
  const {
    balancesByMonth,
    paymentMethodBalancesByMonth,
    withdrawals,
    carryovers,
    exchangeRows,
    dollarExpenses,
    investments,
    carryoversSupported,
    methodsSupported,
    reserveEntries,
    reserveExpenses,
    reserveGoals,
    reserveSupported,
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
  const monthReserve = useMemo(
    () => reserveForMonth(reserveEntries, reserveExpenses, form.month),
    [reserveEntries, reserveExpenses, form.month],
  );
  const monthHasReserve = [monthReserve.bySource.game_club, monthReserve.bySource.bar]
    .some((flow) => flow.deposited !== 0 || flow.returned !== 0 || flow.spent !== 0);
  const methodBreakdown = useMemo(
    () => gameClubWithdrawalsByMethod(paymentMethodBalances, withdrawals, form.month, carryovers, monthReserve),
    [paymentMethodBalances, withdrawals, form.month, carryovers, monthReserve],
  );
  const monthDollars = useMemo(
    () => dollarsForMonth(exchangeRows, form.month, dollarExpenses),
    [exchangeRows, form.month, dollarExpenses],
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
  // Owner Profit alone also shows their total, at the owner's request.
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
  const overall = headlineSources.reduce(
    (sum, side) => ({ earned: sum.earned + side.earned, withdrawn: sum.withdrawn + side.withdrawn, available: sum.available + side.available }),
    { earned: 0, withdrawn: 0, available: 0 },
  );
  const amountValue = parseCurrencyInput(form.amount);
  const amountValid = Number.isFinite(amountValue) && amountValue > 0 && amountValue <= withdrawable;
  // Carryovers move money between months of one source (and one Game Club method).
  const carrySourceSelected = form.source !== 'all' && (form.source !== 'game_club' || Boolean(form.paymentMethod));
  const canCarry = carryoversSupported && carrySourceSelected && amountValid;
  // The reserve keeps money per source (and Game Club method), like carryovers.
  const canReserve = reserveSupported && carrySourceSelected && amountValid;

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
    if (!note.check(form.comment)) return;

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
        if (isNoteRequiredError(insertError)) {
          note.reject(form.comment);
          return;
        }
        showToast(isMissingDatabaseFunction(insertError, rpcName)
          ? t(usesPaymentMethod ? 'methodMigrationRequired' : 'migrationRequired')
          : insertError.code === '23514' ? t('exceedsAvailable') : t('saveError'), 'error');
        await loadData({ silent: true });
        return;
      }

      setForm((current) => ({ ...current, comment: '', amount: '' }));
      note.reset();
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

  /** Sets the entered amount aside in the reserve instead of withdrawing it. */
  async function handleReserve() {
    if (mutationPending.current || loading || error || !canReserve || form.source === 'all') return;
    if (!selectedClubId || !isOwner) {
      showToast(t('ownerOnly'), 'error');
      return;
    }
    const amount = parseCurrencyInput(form.amount);
    const operationLoad = currentLoad.current;
    mutationPending.current = true;
    setSaving('reserve');
    try {
      const failure = await depositToReserve(createClient(), selectedClubId, {
        id: crypto.randomUUID(),
        month: form.month,
        source: form.source,
        method: form.source === 'game_club' ? (form.paymentMethod || null) : null,
        amount,
        comment: form.comment,
      });
      if (operationLoad !== currentLoad.current) return;
      if (failure) {
        showToast(tr(`errors.${failure}`), 'error');
        await loadData({ silent: true });
        return;
      }
      setForm((current) => ({ ...current, comment: '', amount: '' }));
      note.reset();
      showToast(tr('depositedToast'), 'success');
      await loadData({ silent: true });
    } catch {
      if (operationLoad === currentLoad.current) showToast(tr('errors.failed'), 'error');
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
  const sourceOptions = PROFIT_SOURCES.map((source) => {
    const Icon = source === 'all' ? Layers : SOURCE_ICONS[source];
    return { value: source, label: t(`sources.${source}`), icon: <Icon size={16} aria-hidden="true" /> };
  });

  const breakdownRows: BreakdownRow[] = [
    {
      key: 'game_club',
      label: t('sources.game_club'),
      icon: SOURCE_ICONS.game_club,
      earned: monthlyBalance?.gameClub.earned ?? 0,
      carried: monthCarried.bySource.game_club,
      reserved: reservedNet(monthReserve.bySource.game_club),
      withdrawn: monthlyBalance?.gameClub.withdrawn ?? 0,
      available: monthlyBalance?.gameClub.available ?? 0,
    },
    ...methodBreakdown.methods.map((row) => ({
      key: `method:${row.method}`,
      label: methodLabel(row.method),
      icon: METHOD_ICONS[row.method],
      earned: row.earned,
      carried: row.carried,
      reserved: row.reserved,
      withdrawn: row.withdrawn,
      available: row.available,
      nested: true,
    })),
    ...(methodBreakdown.unassignedWithdrawn > 0 ? [{
      key: 'method:unassigned',
      label: t('unassignedMethod'),
      icon: METHOD_ICONS.unassigned,
      earned: null,
      carried: 0,
      reserved: 0,
      withdrawn: methodBreakdown.unassignedWithdrawn,
      available: null,
      nested: true,
      hint: t('unassignedMethodHint'),
    }] : []),
    // Dollars stay inside Game Club profit but left the methods; they cannot be withdrawn.
    ...(monthDollars.usd !== 0 || monthDollars.heldUsd !== 0 ? [{
      key: 'method:usd',
      label: t('dollars'),
      icon: METHOD_ICONS.usd,
      earned: monthDollars.uzs,
      carried: 0,
      reserved: 0,
      withdrawn: 0,
      available: monthDollars.uzs,
      nested: true,
      hint: t('dollarsHint', {
        held: `${monthDollars.heldUsd < 0 ? '−' : ''}$${formatUnitCurrency(Math.abs(monthDollars.heldUsd))}`,
      }),
    }] : []),
    {
      key: 'bar',
      label: t('sources.bar'),
      icon: SOURCE_ICONS.bar,
      earned: monthlyBalance?.bar.earned ?? 0,
      carried: monthCarried.bySource.bar,
      reserved: reservedNet(monthReserve.bySource.bar),
      withdrawn: monthlyBalance?.bar.withdrawn ?? 0,
      available: monthlyBalance?.bar.available ?? 0,
    },
  ];

  const emptyCell = <span className="text-gray-300">—</span>;
  const amountCell = (amount: number, className: string) => (
    <span className={cn('whitespace-nowrap tabular-nums', className)}>{formatCurrency(amount)}</span>
  );
  const carriedCell = (amount: number, className?: string) => (amount === 0
    ? <span className="tabular-nums text-gray-400">0</span>
    : (
      <span className={cn('whitespace-nowrap tabular-nums', amount > 0 ? 'text-success-600' : 'text-gray-600', className)}>
        {amount > 0 ? '+' : '−'}{formatCurrency(Math.abs(amount))}
      </span>
    ));
  // Fixed widths keep the money columns aligned between source and method rows.
  const extraColumns = Number(monthHasCarryovers) + Number(monthHasReserve);
  const moneyColumnClassName = extraColumns === 2 ? 'w-[13%]' : extraColumns === 1 ? 'w-[16.5%]' : 'w-[22%]';

  const breakdownColumns: DataTableColumn<BreakdownRow>[] = [
    {
      key: 'label',
      header: t('source'),
      className: 'w-[34%]',
      render: (row) => (row.nested ? (
        <span className="flex items-center gap-2 pl-4 text-gray-600">
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-gray-200" />
          {row.icon ? <row.icon size={15} aria-hidden="true" className="shrink-0 text-gray-400" /> : null}
          <span className="min-w-0">
            <span className="block">{row.label}</span>
            {row.hint ? <span className="block text-xs leading-5 text-gray-400">{row.hint}</span> : null}
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-2.5 font-semibold text-gray-900">
          {row.icon ? (
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', SOURCE_TINTS[row.key === 'bar' ? 'bar' : 'game_club'].bubble)}>
              <row.icon size={15} aria-hidden="true" />
            </span>
          ) : null}
          {row.label}
        </span>
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
    ...(monthHasReserve ? [{
      key: 'reserved',
      header: tr('reservedColumn'),
      align: 'right' as const,
      className: moneyColumnClassName,
      render: (row: BreakdownRow) => (row.earned === null ? emptyCell : amountCell(row.reserved, cn(
        !row.nested && 'font-semibold',
        row.reserved !== 0 ? 'text-primary-600' : 'text-gray-400',
      ))),
    }] : []),
    {
      key: 'withdrawn',
      header: t('monthlyWithdrawn'),
      align: 'right',
      className: moneyColumnClassName,
      render: (row) => amountCell(row.withdrawn, cn(
        !row.nested && 'font-semibold',
        row.withdrawn > 0 ? 'text-gray-900' : 'text-gray-400',
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

  const reserveHeld = reserveBalances(reserveEntries, reserveExpenses);
  const reserveRows = reserveActivity(reserveEntries, reserveExpenses);
  const reserveActionsDisabled = loading || !!error || reserveBusy !== null || saving !== null;
  const returnMax = returnTarget === 'game_club' ? reserveHeld.game_club.byMethod[returnMethod] : returnTarget === 'bar' ? reserveHeld.bar.held : 0;
  const returnValue = parseCurrencyInput(returnInput);
  const returnValid = Number.isFinite(returnValue) && returnValue > 0 && returnValue <= returnMax;
  const goalValue = goalInput ? parseCurrencyInput(goalInput) : 0;
  const goalValid = goalTitle.trim().length > 0 && Number.isFinite(goalValue) && goalValue > 0;

  function openReturn(source: OwnerWithdrawalSource) {
    reserveRequestId.current = null;
    setReserveError(null);
    const method = OWNER_WITHDRAWAL_PAYMENT_METHODS.find((value) => reserveHeld.game_club.byMethod[value] > 0) ?? 'cash';
    setReturnMethod(method);
    setReturnInput('');
    setReturnTarget(source);
  }

  async function handleReturn(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedClubId || !returnTarget || !returnValid || reserveBusy) return;
    const operationLoad = currentLoad.current;
    reserveRequestId.current ??= crypto.randomUUID();
    setReserveBusy('return');
    setReserveError(null);
    try {
      const failure = await returnFromReserve(createClient(), selectedClubId, {
        id: reserveRequestId.current,
        month: form.month,
        source: returnTarget,
        method: returnTarget === 'game_club' ? returnMethod : null,
        amount: Math.round(returnValue),
        comment: '',
      });
      if (operationLoad !== currentLoad.current) return;
      if (failure) {
        reserveRequestId.current = null;
        setReserveError(failure);
        return;
      }
      setReturnTarget(null);
      showToast(tr('returnedToast'), 'success');
      await loadData({ silent: true });
    } catch {
      setReserveError('failed');
    } finally {
      setReserveBusy(null);
    }
  }

  function openGoal(source: OwnerWithdrawalSource) {
    const goal = reserveGoals.find((row) => row.source === source);
    setReserveError(null);
    setGoalTitle(goal?.title ?? '');
    setGoalInput(goal ? formatCurrencyInput(goal.target_amount) : '');
    setGoalTarget(source);
  }

  async function saveGoal(remove: boolean) {
    if (!selectedClubId || !goalTarget || reserveBusy || (!remove && !goalValid)) return;
    setReserveBusy('goal');
    setReserveError(null);
    try {
      const failure = await setReserveGoal(createClient(), selectedClubId, goalTarget, remove ? null : goalTitle.trim(), remove ? null : Math.round(goalValue));
      if (failure) {
        setReserveError(failure);
        return;
      }
      setGoalTarget(null);
      showToast(remove ? tr('goalRemovedToast') : tr('goalSavedToast'), 'success');
      await loadData({ silent: true });
    } catch {
      setReserveError('failed');
    } finally {
      setReserveBusy(null);
    }
  }

  async function handleDeleteReserve(row: Extract<ReserveActivity, { kind: 'deposit' | 'return' }>) {
    if (!selectedClubId || reserveBusy) return;
    const loadBeforeConfirm = currentLoad.current;
    const confirmed = await confirm({
      title: tc('delete'),
      description: tr(row.kind === 'deposit' ? 'deleteDepositConfirm' : 'deleteReturnConfirm', { amount: currency(row.amount) }),
      confirmLabel: tc('delete'),
    });
    if (!confirmed || loadBeforeConfirm !== currentLoad.current) return;
    setReserveBusy(row.id);
    try {
      const failure = await deleteReserveEntry(createClient(), selectedClubId, row.id);
      if (loadBeforeConfirm !== currentLoad.current) return;
      showToast(failure ? tr(`errors.${failure}`) : tr('deletedToast'), failure ? 'error' : 'success');
      await loadData({ silent: true });
    } catch {
      showToast(tr('errors.failed'), 'error');
    } finally {
      setReserveBusy(null);
    }
  }

  const shortages = shortageQuery.data;
  const shortageSummaries = summarizeCashShortages(shortages.shortages, shortages.recoveries);
  const monthShortages = cashShortageTotalsForMonth(shortageSummaries, form.month);
  const employeeNames = Object.fromEntries(shortages.employees.map((employee) => [employee.id, employee.name]));
  const shortageActionsDisabled = loading || !!error || shortageQuery.loading || shortageBusy !== null || saving !== null;
  const recoverValue = parseCurrencyInput(recoverInput);
  const recoverMax = recoverTarget ? recoverableAmount(recoverTarget) : 0;
  const recoverValid = Number.isFinite(recoverValue) && recoverValue > 0 && recoverValue <= recoverMax;

  /** A shortage is an expense in every balance: reload both. */
  async function reloadAfterShortage() {
    await Promise.all([loadData({ silent: true }), shortageQuery.reload({ silent: true })]);
  }

  function openRecover(summary: CashShortageSummary) {
    recoverRequestId.current = null;
    setRecoverError(null);
    setRecoverInput(formatCurrencyInput(recoverableAmount(summary)));
    setRecoverTarget(summary);
  }

  async function handleRecover(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedClubId || !recoverTarget || !recoverValid || shortageBusy) return;
    const operationLoad = currentLoad.current;
    recoverRequestId.current ??= crypto.randomUUID();
    setShortageBusy(recoverTarget.shortage.id);
    setRecoverError(null);
    try {
      const failure = await recoverCashShortage(createClient(), selectedClubId, recoverTarget.shortage.id, recoverRequestId.current, Math.round(recoverValue));
      if (operationLoad !== currentLoad.current) return;
      if (failure) {
        recoverRequestId.current = null;
        setRecoverError(failure);
        return;
      }
      setRecoverTarget(null);
      showToast(tsh('recoveredToast'), 'success');
      await reloadAfterShortage();
    } catch {
      setRecoverError('failed');
    } finally {
      setShortageBusy(null);
    }
  }

  async function handleDeleteShortage(summary: CashShortageSummary) {
    if (!selectedClubId || shortageBusy) return;
    if (summary.recovered > 0) {
      showToast(tsh('errors.has_recoveries'), 'error');
      return;
    }
    const loadBeforeConfirm = currentLoad.current;
    const confirmed = await confirm({
      title: tc('delete'),
      description: tsh('deleteConfirm', {
        amount: currency(Number(summary.shortage.amount)),
        reason: tsh(`reasons.${summary.shortage.reason}`),
      }),
      confirmLabel: tc('delete'),
    });
    if (!confirmed || loadBeforeConfirm !== currentLoad.current) return;
    setShortageBusy(summary.shortage.id);
    try {
      const failure = await deleteCashShortage(createClient(), selectedClubId, summary.shortage.id);
      if (loadBeforeConfirm !== currentLoad.current) return;
      if (failure) {
        showToast(tsh(`errors.${failure}`), 'error');
        await reloadAfterShortage();
        return;
      }
      showToast(tsh('deletedToast'), 'success');
      await reloadAfterShortage();
    } catch {
      showToast(tsh('errors.failed'), 'error');
    } finally {
      setShortageBusy(null);
    }
  }

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

      {/* After a failed load the balances are unknown, not zero: show only the error. */}
      {!error && (
        <>
          {/* What the owner can still take out this month: both businesses together, then each one. */}
          <Card as="section" padding="lg" aria-labelledby="owner-profit-headline">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
              <div className="min-w-0">
                <p id="owner-profit-headline" className="flex items-center gap-2 text-[13px] font-medium text-gray-500">
                  <Wallet size={15} aria-hidden="true" className="shrink-0" />
                  <span>{t('monthlyRemaining')} · {t('overallProfit')}</span>
                </p>
                {loading ? (
                  <div className="mt-3 space-y-3" role="status" aria-label={tc('loading')}>
                    <Skeleton className="h-12 w-64 max-w-full" />
                    <Skeleton className="h-4 w-72 max-w-full bg-gray-100" />
                  </div>
                ) : (
                  <>
                    <p className={cn('mt-3 break-words text-4xl font-bold leading-none tracking-tight tabular-nums sm:text-5xl', metricToneClassName[toneForAmount(overall.available)])}>
                      {formatCurrency(overall.available)}
                      <span className="ml-2 text-base font-medium tracking-normal text-gray-500">{tc('currency')}</span>
                    </p>
                    <dl className="mt-4 flex flex-wrap gap-2 text-[13px]">
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1">
                        <TrendingUp size={14} aria-hidden="true" className="shrink-0 text-gray-400" />
                        <dt className="text-gray-500">{t('earnedBeforeWithdrawals')}</dt>
                        <dd className="font-semibold tabular-nums text-gray-900">{formatCurrency(overall.earned)}</dd>
                      </div>
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1">
                        <HandCoins size={14} aria-hidden="true" className="shrink-0 text-gray-400" />
                        <dt className="text-gray-500">{t('monthlyWithdrawn')}</dt>
                        <dd className="font-semibold tabular-nums text-gray-900">{formatCurrency(overall.withdrawn)}</dd>
                      </div>
                    </dl>
                  </>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {headlineSources.map((side) => {
                  const SourceIcon = SOURCE_ICONS[side.source];
                  // How much of what the month earned has already been taken out.
                  const withdrawnShare = side.earned > 0 ? Math.min(100, Math.round((side.withdrawn / side.earned) * 100)) : 0;
                  return (
                    <div key={side.source} className="min-w-0 rounded-2xl border border-gray-100 bg-gray-50/40 p-4">
                      <div className="flex items-center gap-2.5">
                        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', SOURCE_TINTS[side.source].bubble)}>
                          <SourceIcon size={16} aria-hidden="true" />
                        </span>
                        <p className="text-sm font-semibold text-gray-900">{t(`sources.${side.source}`)}</p>
                      </div>
                      {loading ? (
                        <div className="mt-3 space-y-2" role="status" aria-label={tc('loading')}>
                          <Skeleton className="h-8 w-40 max-w-full" />
                          <Skeleton className="h-2 w-full bg-gray-100" />
                        </div>
                      ) : (
                        <>
                          <p className={cn('mt-3 break-words text-2xl font-bold leading-none tracking-tight tabular-nums sm:text-[1.75rem]', metricToneClassName[toneForAmount(side.available)])}>
                            {formatCurrency(side.available)}
                            <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{tc('currency')}</span>
                          </p>
                          <div
                            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={withdrawnShare}
                            aria-label={t('withdrawnShare', { percent: withdrawnShare })}
                          >
                            <div className={cn('h-full rounded-full transition-[width] duration-700', SOURCE_TINTS[side.source].bar)} style={{ width: `${withdrawnShare}%` }} />
                          </div>
                          <p className="mt-2 text-xs leading-5 text-gray-500">
                            {t('withdrawnOfEarned', {
                              withdrawn: formatCurrency(side.withdrawn),
                              earned: formatCurrency(side.earned),
                            })}
                          </p>
                          {reservedNet(monthReserve.bySource[side.source]) !== 0 ? (
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                              <PiggyBank size={13} aria-hidden="true" className="shrink-0 text-primary-500" />
                              <span>{tr('heroReserved')}</span>
                              <span className="whitespace-nowrap font-semibold tabular-nums text-primary-600">
                                {formatCurrency(reservedNet(monthReserve.bySource[side.source]))}
                              </span>
                            </p>
                          ) : null}
                          {monthShortages[side.source].amount > 0 ? (
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                              <TriangleAlert size={13} aria-hidden="true" className="shrink-0 text-danger-500" />
                              <span>{tsh('heroLost')}</span>
                              <span className="whitespace-nowrap font-semibold tabular-nums text-danger-600">
                                {formatCurrency(monthShortages[side.source].lost)}
                              </span>
                            </p>
                          ) : null}
                          {monthHasCarryovers && side.carried !== 0 ? (
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                              <CalendarArrowUp size={13} aria-hidden="true" className="shrink-0 text-gray-400" />
                              {t('carriedColumn')}: {carriedCell(side.carried, 'font-semibold')}
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          <div className={cn('grid gap-5', isOwner && 'xl:grid-cols-[minmax(0,1fr)_32rem] 2xl:grid-cols-[minmax(0,1fr)_42rem] xl:items-start')}>
            {/* The withdrawal form comes first on small screens and sits in a sticky side column on wide ones. */}
            {isOwner ? (
              loading ? (
                <FormSkeleton className="xl:col-start-2 xl:row-start-1" />
              ) : (
                <Card as="form" onSubmit={handleSubmit} className="h-fit xl:sticky xl:top-20 xl:col-start-2 xl:row-start-1">
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
                          className={cn('grid-cols-2 sm:grid-cols-4 xl:grid-cols-2', pickerMethods.length === 3 ? '2xl:grid-cols-3' : pickerMethods.length >= 4 && '2xl:grid-cols-4')}
                          value={form.paymentMethod}
                          onChange={(paymentMethod) => setField('paymentMethod', paymentMethod)}
                          disabled={loading}
                          options={pickerMethods.map((method) => ({
                            value: method,
                            disabled: methodWithdrawable[method] <= 0,
                            label: (
                              <span className="flex flex-col items-center py-1 leading-tight">
                                <span className="inline-flex items-center gap-1.5">
                                  <MethodPickerIcon method={method} />
                                  {methodLabel(method)}
                                </span>
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
                      <div className="flex gap-2">
                        <CurrencyInput
                          id="withdrawal-amount"
                          required
                          controlSize="lg"
                          className="flex-1"
                          value={form.amount}
                          invalid={Boolean(form.amount) && !amountValid}
                          onValueChange={(value) => setField('amount', clampWithdrawalInput(value, withdrawable))}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="lg"
                          className="min-h-14 shrink-0"
                          disabled={withdrawable <= 0}
                          aria-label={t('takeAllLabel', { amount: currency(withdrawable) })}
                          onClick={() => setField('amount', formatCurrencyInput(withdrawable))}
                        >
                          {t('takeAll')}
                        </Button>
                      </div>
                    </Field>

                    <NoteField
                      guard={note}
                      id="withdrawal-comment"
                      label={t('comment')}
                      value={form.comment}
                      onChange={(value) => setField('comment', value)}
                      placeholder={t('commentPlaceholder')}
                      maxLength={250}
                    />

                    <div className="space-y-2">
                      <Button
                        type="submit"
                        fullWidth
                        disabled={loading || !!error || deletingId !== null || (saving !== null && saving !== 'withdraw') || !amountValid}
                        loading={saving === 'withdraw'}
                        loadingLabel={tc('saving')}
                        icon={<ArrowDownToLine size={18} aria-hidden="true" />}
                      >
                        {amountValid ? t('recordButtonAmount', { amount: currency(amountValue) }) : t('recordButton')}
                      </Button>
                      {carryoversSupported ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            fullWidth
                            disabled={loading || !!error || deletingId !== null || (saving !== null && saving !== 'carry') || !canCarry}
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
                      {reserveSupported ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            fullWidth
                            disabled={loading || !!error || deletingId !== null || (saving !== null && saving !== 'reserve') || !canReserve}
                            loading={saving === 'reserve'}
                            loadingLabel={tc('saving')}
                            icon={<PiggyBank size={18} aria-hidden="true" />}
                            onClick={() => void handleReserve()}
                          >
                            {canReserve ? tr('depositButtonAmount', { amount: currency(amountValue) }) : tr('depositButton')}
                          </Button>
                          <p className="text-xs leading-5 text-gray-500">
                            {form.source === 'all' ? tr('depositChooseSource') : tr('depositHint')}
                          </p>
                        </>
                      ) : null}
                    </div>
                  </div>
                </Card>
              )
            ) : null}

            <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-1">
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
                    minWidth={560}
                    columns={breakdownColumns}
                    data={breakdownRows}
                    keyExtractor={(row) => row.key}
                    rowClassName={(row) => (row.nested ? 'bg-gray-50/40' : undefined)}
                  />
                )}
              </Card>

              {isOwner && reserveSupported && !loading ? (
                <Card as="section" padding="none" className="overflow-hidden">
                  <ReserveSection
                    balances={reserveHeld}
                    goals={reserveGoals}
                    activity={reserveRows}
                    methodLabel={methodLabel}
                    busyId={reserveBusy}
                    disabled={reserveActionsDisabled}
                    onReturn={openReturn}
                    onGoal={openGoal}
                    onDelete={(row) => void handleDeleteReserve(row)}
                  />
                </Card>
              ) : null}

              {isOwner && shortages.supported && !loading ? (
                <Card as="section" padding="none" className="overflow-hidden">
                  <CashShortagesSection
                    month={form.month}
                    summaries={shortageSummaries}
                    employeeNames={employeeNames}
                    busyId={shortageBusy}
                    disabled={shortageActionsDisabled}
                    onRecord={() => setShortageFormOpen(true)}
                    onRecover={openRecover}
                    onDelete={(summary) => void handleDeleteShortage(summary)}
                  />
                </Card>
              ) : null}

              {loading ? (
                <TableSkeleton rows={5} columns={4} />
              ) : (
                <Card as="section" padding="none" className="h-fit overflow-hidden">
                  <WithdrawalHistory
                    rows={historyRows}
                    currentMonth={currentMonth}
                    withdrawals={withdrawals}
                    investments={investments}
                    isOwner={isOwner}
                    deletingId={deletingId}
                    deleteDisabled={loading || !!error || saving !== null || deletingId !== null}
                    methodLabel={methodLabel}
                    deleteLabel={(row) => {
                      const entry = row.kind === 'withdrawal' ? row.withdrawal : row.carryover;
                      return `${withdrawalSourceLabel(entry)} · ${currency(entry.amount)}`;
                    }}
                    onDelete={(row) => void (row.kind === 'withdrawal' ? handleDelete(row.withdrawal) : handleDeleteCarryover(row.carryover))}
                  />
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {isOwner && selectedClubId ? (
        <Modal
          open={shortageFormOpen}
          onClose={() => setShortageFormOpen(false)}
          title={tsh('title')}
          description={tsh('description')}
          size="xl"
        >
          <CashShortageForm
            key={form.month}
            clubId={selectedClubId}
            // Inside the month on the page: today in the current month, else its last day.
            defaultDate={form.month === currentMonth ? businessToday : monthRange(form.month).to}
            maxDate={businessToday}
            enabledPaymentMethods={enabledPaymentMethods}
            employees={shortages.employees.filter((employee) => !employee.hidden)}
            onCancel={() => setShortageFormOpen(false)}
            onSaved={async () => {
              setShortageFormOpen(false);
              showToast(tsh('savedToast'), 'success');
              await reloadAfterShortage();
            }}
          />
        </Modal>
      ) : null}

      <Modal
        open={recoverTarget !== null}
        onClose={() => (shortageBusy ? undefined : setRecoverTarget(null))}
        locked={shortageBusy !== null}
        title={tsh('recoverTitle')}
        description={recoverTarget?.shortage.employee_id
          ? tsh('recoverDescription', { name: employeeNames[recoverTarget.shortage.employee_id] ?? tsh('removedEmployee') })
          : undefined}
        size="md"
      >
        <form onSubmit={handleRecover} className="space-y-4">
          <Field
            label={`${tsh('recoverAmount')} (${tc('currency')})`}
            htmlFor="shortage-recover-amount"
            required
            hint={tsh('recoverLeft', { amount: currency(recoverMax) })}
            error={recoverInput && !recoverValid ? tsh('recoverTooLarge', { amount: formatCurrency(recoverMax) }) : undefined}
          >
            <CurrencyInput
              id="shortage-recover-amount"
              controlSize="lg"
              value={recoverInput}
              invalid={Boolean(recoverInput) && !recoverValid}
              onValueChange={setRecoverInput}
            />
          </Field>
          {recoverError ? <InlineAlert variant="danger">{tsh(`errors.${recoverError}`)}</InlineAlert> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={shortageBusy !== null} onClick={() => setRecoverTarget(null)}>{tc('cancel')}</Button>
            <Button type="submit" disabled={!recoverValid} loading={shortageBusy !== null} loadingLabel={tc('saving')} icon={<Undo2 size={17} aria-hidden="true" />}>
              {tsh('recoverSave')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={returnTarget !== null}
        onClose={() => (reserveBusy ? undefined : setReturnTarget(null))}
        locked={reserveBusy !== null}
        title={tr('returnTitle')}
        description={tr('returnDescription', { month: formatYearMonth(form.month, locale) })}
        size="md"
      >
        <form onSubmit={handleReturn} className="space-y-4">
          {returnTarget === 'game_club' ? (
            <Field label={t('paymentMethod')} required>
              <SegmentedControl
                label={t('paymentMethod')}
                columns="auto"
                className="grid-cols-2"
                value={returnMethod}
                onChange={(method) => {
                  setReturnMethod(method);
                  setReturnInput('');
                }}
                options={OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => ({
                  value: method,
                  disabled: reserveHeld.game_club.byMethod[method] <= 0,
                  label: (
                    <span className="flex flex-col items-center py-1 leading-tight">
                      <span className="inline-flex items-center gap-1.5"><MethodPickerIcon method={method} />{methodLabel(method)}</span>
                      <span className="mt-0.5 text-[11px] font-normal tabular-nums opacity-80">{formatCurrency(reserveHeld.game_club.byMethod[method])}</span>
                    </span>
                  ),
                }))}
              />
            </Field>
          ) : null}
          <Field
            label={`${tr('returnAmount')} (${tc('currency')})`}
            htmlFor="reserve-return-amount"
            required
            hint={tr('returnLeft', { amount: currency(Math.max(0, returnMax)) })}
            error={returnInput && !returnValid ? tr('returnTooLarge', { amount: formatCurrency(Math.max(0, returnMax)) }) : undefined}
          >
            <div className="flex gap-2">
              <CurrencyInput
                id="reserve-return-amount"
                controlSize="lg"
                className="flex-1"
                value={returnInput}
                invalid={Boolean(returnInput) && !returnValid}
                onValueChange={setReturnInput}
              />
              <Button type="button" variant="secondary" size="lg" className="min-h-14 shrink-0" disabled={returnMax <= 0} onClick={() => setReturnInput(formatCurrencyInput(returnMax))}>
                {t('takeAll')}
              </Button>
            </div>
          </Field>
          {reserveError ? <InlineAlert variant="danger">{tr(`errors.${reserveError}`)}</InlineAlert> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={reserveBusy !== null} onClick={() => setReturnTarget(null)}>{tc('cancel')}</Button>
            <Button type="submit" disabled={!returnValid} loading={reserveBusy === 'return'} loadingLabel={tc('saving')} icon={<Undo2 size={17} aria-hidden="true" />}>
              {tr('returnSave')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={goalTarget !== null}
        onClose={() => (reserveBusy ? undefined : setGoalTarget(null))}
        locked={reserveBusy !== null}
        title={goalTarget ? tr('goalTitle', { source: tr(`sources.${goalTarget}`) }) : undefined}
        description={tr('goalDescription')}
        size="md"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveGoal(false);
          }}
          className="space-y-4"
        >
          <Field label={tr('goalName')} htmlFor="reserve-goal-title" required>
            <Input
              id="reserve-goal-title"
              value={goalTitle}
              maxLength={120}
              placeholder={tr('goalNamePlaceholder')}
              onChange={(event) => setGoalTitle(event.target.value)}
            />
          </Field>
          <Field label={`${tr('goalAmount')} (${tc('currency')})`} htmlFor="reserve-goal-amount" required>
            <CurrencyInput id="reserve-goal-amount" controlSize="lg" value={goalInput} onValueChange={setGoalInput} />
          </Field>
          {reserveError ? <InlineAlert variant="danger">{tr(`errors.${reserveError}`)}</InlineAlert> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {goalTarget && reserveGoals.some((goal) => goal.source === goalTarget) ? (
              <Button type="button" variant="dangerOutline" disabled={reserveBusy !== null} onClick={() => void saveGoal(true)}>{tr('goalRemove')}</Button>
            ) : <span />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" disabled={reserveBusy !== null} onClick={() => setGoalTarget(null)}>{tc('cancel')}</Button>
              <Button type="submit" disabled={!goalValid} loading={reserveBusy === 'goal'} loadingLabel={tc('saving')} icon={<Target size={17} aria-hidden="true" />}>
                {tr('goalSave')}
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {toastElement}
      {confirmDialog}
      {note.dialog}
    </div>
  );
}

function MethodPickerIcon({ method }: { method: OwnerWithdrawalPaymentMethod }) {
  const Icon = METHOD_ICONS[method];
  return <Icon size={14} aria-hidden="true" />;
}
