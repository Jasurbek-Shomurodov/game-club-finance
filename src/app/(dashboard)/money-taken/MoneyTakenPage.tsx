'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, CalendarArrowUp, HandCoins, Layers, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
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
  LoadErrorAlert,
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
  formatUnitCurrency,
  parseCurrencyInput,
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
import { METHOD_ICONS, SOURCE_ICONS, SOURCE_TINTS } from './profitIcons';
import { WithdrawalHistory, historyCreatedAt, type HistoryRow } from './WithdrawalHistory';

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

  const loadOwnerMoney = useCallback(async (isCurrent: () => boolean): Promise<OwnerMoneyData> => (
    selectedClubId ? fetchOwnerMoney(createClient(), selectedClubId, businessToday, isCurrent) : EMPTY_OWNER_MONEY
  ), [businessToday, selectedClubId]);
  const ownerMoney = useClubQuery(loadOwnerMoney, EMPTY_OWNER_MONEY);
  const {
    balancesByMonth,
    paymentMethodBalancesByMonth,
    withdrawals,
    carryovers,
    exchangeRows,
    investments,
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
  const monthDollars = useMemo(() => dollarsForMonth(exchangeRows, form.month), [exchangeRows, form.month]);
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
      withdrawn: monthlyBalance?.gameClub.withdrawn ?? 0,
      available: monthlyBalance?.gameClub.available ?? 0,
    },
    ...methodBreakdown.methods.map((row) => ({
      key: `method:${row.method}`,
      label: methodLabel(row.method),
      icon: METHOD_ICONS[row.method],
      earned: row.earned,
      carried: row.carried,
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p id="owner-profit-headline" className="flex items-center gap-2 text-[13px] font-medium text-gray-500">
                  <Wallet size={15} aria-hidden="true" />
                  {t('monthlyRemaining')} · {t('overallProfit')} · {formatYearMonth(form.month, locale)}
                </p>
                {loading ? (
                  <Skeleton className="mt-3 h-10 w-56 max-w-full" />
                ) : (
                  <p className={cn('mt-3 break-words text-3xl font-bold leading-none tracking-tight tabular-nums sm:text-4xl', metricToneClassName[toneForAmount(overall.available)])}>
                    {formatCurrency(overall.available)}
                    <span className="ml-2 text-base font-medium tracking-normal text-gray-500">{tc('currency')}</span>
                  </p>
                )}
              </div>
              {!loading && (
                <dl className="grid gap-2 text-sm sm:grid-cols-2 sm:gap-6">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={15} aria-hidden="true" className="shrink-0 text-gray-400" />
                    <dt className="text-gray-500">{t('earnedBeforeWithdrawals')}</dt>
                    <dd className="ml-auto font-semibold tabular-nums text-gray-900 sm:ml-0">{formatCurrency(overall.earned)}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <HandCoins size={15} aria-hidden="true" className="shrink-0 text-gray-400" />
                    <dt className="text-gray-500">{t('monthlyWithdrawn')}</dt>
                    <dd className="ml-auto font-semibold tabular-nums text-gray-900 sm:ml-0">{formatCurrency(overall.withdrawn)}</dd>
                  </div>
                </dl>
              )}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {headlineSources.map((side) => {
                const SourceIcon = SOURCE_ICONS[side.source];
                // How much of what the month earned has already been taken out.
                const withdrawnShare = side.earned > 0 ? Math.min(100, Math.round((side.withdrawn / side.earned) * 100)) : 0;
                return (
                  <div key={side.source} className="min-w-0 rounded-2xl border border-gray-100 bg-gray-50/40 p-4 sm:p-5">
                    <div className="flex items-center gap-2.5">
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', SOURCE_TINTS[side.source].bubble)}>
                        <SourceIcon size={18} aria-hidden="true" />
                      </span>
                      <p className="text-sm font-semibold text-gray-900">{t(`sources.${side.source}`)}</p>
                    </div>
                    {loading ? (
                      <div className="mt-4 space-y-2" role="status" aria-label={tc('loading')}>
                        <Skeleton className="h-10 w-48 max-w-full" />
                        <Skeleton className="h-3 w-40 bg-gray-100" />
                      </div>
                    ) : (
                      <>
                        <p className={cn('mt-4 break-words text-3xl font-bold leading-none tracking-tight tabular-nums sm:text-4xl', metricToneClassName[toneForAmount(side.available)])}>
                          {formatCurrency(side.available)}
                          <span className="ml-2 text-base font-medium tracking-normal text-gray-500">{tc('currency')}</span>
                        </p>
                        {side.earned > 0 ? (
                          <div className="mt-4">
                            <div
                              className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={withdrawnShare}
                              aria-label={t('withdrawnShare', { percent: withdrawnShare })}
                            >
                              <div className={cn('h-full rounded-full transition-[width] duration-700', SOURCE_TINTS[side.source].bar)} style={{ width: `${withdrawnShare}%` }} />
                            </div>
                            <p className="mt-1.5 text-xs text-gray-500">{t('withdrawnShare', { percent: withdrawnShare })}</p>
                          </div>
                        ) : null}
                        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                          <div className="flex items-center gap-2">
                            <TrendingUp size={15} aria-hidden="true" className="shrink-0 text-gray-400" />
                            <dt className="text-gray-500">{t('earnedBeforeWithdrawals')}</dt>
                            <dd className="ml-auto font-semibold tabular-nums text-gray-900 sm:ml-0">{formatCurrency(side.earned)}</dd>
                          </div>
                          <div className="flex items-center gap-2">
                            <HandCoins size={15} aria-hidden="true" className="shrink-0 text-gray-400" />
                            <dt className="text-gray-500">{t('monthlyWithdrawn')}</dt>
                            <dd className="ml-auto font-semibold tabular-nums text-gray-900 sm:ml-0">{formatCurrency(side.withdrawn)}</dd>
                          </div>
                          {monthHasCarryovers ? (
                            <div className="flex items-center gap-2">
                              <CalendarArrowUp size={15} aria-hidden="true" className="shrink-0 text-gray-400" />
                              <dt className="text-gray-500">{t('carriedColumn')}</dt>
                              <dd className="ml-auto font-semibold sm:ml-0">{carriedCell(side.carried)}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </>
                    )}
                  </div>
                );
              })}
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
                      <CurrencyInput
                        id="withdrawal-amount"
                        required
                        value={form.amount}
                        invalid={Boolean(form.amount) && !amountValid}
                        onValueChange={(value) => setField('amount', clampWithdrawalInput(value, withdrawable))}
                      />
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
            </div>
          )}
        </>
      )}

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
