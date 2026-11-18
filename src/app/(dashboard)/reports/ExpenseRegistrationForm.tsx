'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, PiggyBank, Save } from 'lucide-react';
import { SIDE_ICONS } from '@/components/sideIcons';
import { PAYMENT_METHOD_ICONS } from '@/components/paymentMethodIcons';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  CurrencyInput,
  DatePicker,
  DecimalInput,
  Field,
  InlineAlert,
  LoadErrorAlert,
  NoteField,
  SegmentedControl,
  Skeleton,
  Select,
  useEntryNoteGuard,
} from '@/components/PresentationFoundation';
import { formatCurrency, formatCurrencyInput, formatUnitCurrency, parseDecimalInput } from '@/lib/formatters';
import { MANUAL_EXPENSE_CATEGORIES } from '@/lib/expenseCategories';
import { createClient, mutateFinanceRequest } from '@/lib/supabase/client';
import { fetchExpensePresets } from '@/lib/supabase/expensePresets';
import { fetchExpenseMethodBalances, type ExpenseMethodBalances } from '@/lib/supabase/expenseBalances';
import { fetchReserveHoldings, type ReserveHoldings } from '@/lib/supabase/ownerReserve';
import { expenseAmountFromInput, type ExpensePreset } from '@/lib/calculations/expensePlans';
import { useClubQuery } from '@/lib/useClubQuery';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessRollover } from '@/lib/useBusinessPeriod';
import { useCollectedDay } from '@/lib/useCollectedDay';
import { defaultPaymentMethod, dollarExpenseAmount, expensePaymentMethods } from '@/lib/paymentMethods';
import { cn } from '@/lib/utils';
import type { ExpensePaymentMethod } from '@/types';

// The reserve is the owner's own money, apart from Game Club and Bar: it holds sums and dollars only (155).
const PAYMENT_SOURCES = ['game_club', 'bar', 'reserve'] as const;
type PaymentSource = (typeof PAYMENT_SOURCES)[number];
/** The reserve's sums in the method picker; the API stores them in cash, since the reserve has no methods. */
const RESERVE_SUMS: ExpensePaymentMethod = 'cash';

const SOURCE_ICONS: Record<PaymentSource, React.ReactNode> = {
  // The app-wide business icons: the club's PCs and the bar's bag.
  game_club: <SIDE_ICONS.gameClub size={16} aria-hidden="true" />,
  bar: <SIDE_ICONS.bar size={16} aria-hidden="true" />,
  reserve: <PiggyBank size={16} aria-hidden="true" />,
};

interface ExpenseRegistrationFormProps {
  onSaved?: () => void | Promise<void>;
  /** Start on "Paid From: Reserve". */
  defaultFromReserve?: boolean;
}

const EXPENSE_ERROR_KEYS: Record<string, string> = {
  UNAUTHORIZED: 'unauthorized',
  INVALID_REQUEST: 'invalidRequest',
  FORBIDDEN: 'forbidden',
  PAYMENT_METHOD_DISABLED: 'paymentMethodDisabled',
  CHECK_FAILED: 'checkFailed',
  REQUEST_CONFLICT: 'requestConflict',
  INVALID_VALUES: 'invalidValues',
  NOT_FOUND: 'notFound',
  PRESET_UNAVAILABLE: 'presetUnavailable',
  DAY_COLLECTED: 'dayCollected',
  INSUFFICIENT_BALANCE: 'insufficientBalance',
  RESERVE_INSUFFICIENT: 'reserveInsufficient',
  SERVER_ERROR: 'serverError',
};

export default function ExpenseRegistrationForm({ onSaved, defaultFromReserve = false }: ExpenseRegistrationFormProps) {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods, role } = useClub();
  const isOwner = role === 'owner';
  const businessToday = useBusinessToday(businessDayStartHour);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const note = useEntryNoteGuard();
  // Blocks a second submit before the `saving` state re-renders the button.
  const submitPending = useRef(false);
  // One id per expense being entered: a retry after a lost response reuses it,
  // so the server stores the expense once. A fresh id after each success.
  const requestId = useRef<string | null>(null);
  const emptyForm = useCallback(() => ({
    date: businessToday,
    amount: '',
    category: '',
    payment_method: defaultPaymentMethod(enabledPaymentMethods) as ExpensePaymentMethod,
    payment_source: (defaultFromReserve ? 'reserve' : 'game_club') as PaymentSource,
    comment: '',
    preset_id: '',
    usd_rate: '',
  }), [businessToday, defaultFromReserve, enabledPaymentMethods]);
  const [form, setForm] = useState(emptyForm);
  // A date whose money was collected is closed (097); say so before saving.
  const dayClosed = useCollectedDay(selectedClubId, form.date);

  // The club's planned expenses: picking one fills its category and money
  // source; the amount is still entered by hand. Hidden before migration 091.
  const loadPresets = useCallback(async (): Promise<ExpensePreset[]> => {
    if (!selectedClubId) return [];
    const { presets } = await fetchExpensePresets(createClient(), selectedClubId);
    return presets.filter((preset) => !preset.archived_at);
  }, [selectedClubId]);
  const presetQuery = useClubQuery<ExpensePreset[]>(loadPresets, []);
  const presets = presetQuery.data;
  const selectedPreset = presets.find((preset) => preset.id === form.preset_id) ?? null;

  // What each method still holds for the expense's month (125): the same
  // "left" as the Reports cards; dollars are every dollar still held. Only
  // Game Club money is limited, and before the migration (null) nothing is.
  const loadBalances = useCallback(async (): Promise<ExpenseMethodBalances | null> => (
    selectedClubId ? fetchExpenseMethodBalances(createClient(), selectedClubId, form.date) : null
  ), [form.date, selectedClubId]);
  const balanceQuery = useClubQuery<ExpenseMethodBalances | null>(loadBalances, null);
  // Owners can spend the reserve's sums (136, one pot since 155); its dollars are anyone's dollar expenses (143).
  const loadReserve = useCallback(async (): Promise<ReserveHoldings | null> => (
    selectedClubId && isOwner ? fetchReserveHoldings(createClient(), selectedClubId) : null
  ), [isOwner, selectedClubId]);
  const reserveQuery = useClubQuery<ReserveHoldings | null>(loadReserve, null);
  const reserve = reserveQuery.data;
  const onReserve = form.payment_source === 'reserve';
  // Dollars are shown wherever the club has them, but always as the reserve's.
  const dollarsHeld = balanceQuery.data?.balances.usd ?? null;

  /** What the source offers: the reserve holds sums (owners) and dollars; PlayStation money is Game Club's. */
  const methodsFor = useCallback((source: PaymentSource): ExpensePaymentMethod[] => (source === 'reserve'
    ? [...(isOwner ? [RESERVE_SUMS] : []), 'usd']
    : expensePaymentMethods(enabledPaymentMethods, source).filter((method) => method !== 'usd')
  ), [enabledPaymentMethods, isOwner]);
  const paymentMethods = methodsFor(form.payment_source);

  /** What each offered method still holds, or null when it is not limited (Bar money, or before migration 125). */
  function heldBy(method: ExpensePaymentMethod): number | null {
    if (onReserve) return method === 'usd' ? dollarsHeld : reserve?.sums ?? null;
    return form.payment_source === 'game_club' ? balanceQuery.data?.balances[method] ?? null : null;
  }
  const showsBalances = paymentMethods.some((method) => heldBy(method) !== null);

  // Paid from the club's dollars: the amount is in dollars and a rate converts it to sums.
  const paysInDollars = onReserve && form.payment_method === 'usd';
  const fromReserve = onReserve && !paysInDollars;
  // A chosen plan's monthly amount is the amount's placeholder and its value when left empty.
  // It is in sums, so it does not apply to dollars.
  const plannedAmount = !paysInDollars && selectedPreset && selectedPreset.monthly_amount > 0 ? selectedPreset.monthly_amount : null;
  const usdAmount = paysInDollars ? parseDecimalInput(form.amount) : 0;
  const usdRate = paysInDollars ? parseDecimalInput(form.usd_rate) : 0;
  const dollarAmount = paysInDollars ? dollarExpenseAmount(usdAmount, usdRate) : null;
  const available = heldBy(form.payment_method);
  const enteredAmount = paysInDollars ? usdAmount : expenseAmountFromInput(form.amount, plannedAmount) ?? 0;
  const overBalance = available !== null && enteredAmount > 0 && enteredAmount > available;

  function methodMoney(method: ExpensePaymentMethod, amount: number): string {
    return method === 'usd'
      ? `${amount < 0 ? '−' : ''}$${formatUnitCurrency(Math.abs(amount))}`
      : `${formatCurrency(amount)} ${tc('currency')}`;
  }

  // When the business day rolls over, a date still on the old day moves to the
  // new one; a date the user picked deliberately is kept.
  useBusinessRollover(businessToday, (previousToday, nextToday) => {
    // A moved date is a different expense, not a retry of the last attempt.
    if (form.date === previousToday) requestId.current = null;
    setForm((current) => (current.date === previousToday ? { ...current, date: nextToday } : current));
  });

  // A payment method the source does not offer falls back to the source's first one.
  useEffect(() => {
    setForm((current) => {
      const offered = methodsFor(current.payment_source);
      return offered.includes(current.payment_method) || offered.length === 0
        ? current
        : { ...current, payment_method: offered[0] };
    });
  }, [methodsFor, form.payment_source]);

  // A half-filled form belongs to the club it was started for: clear it when
  // the user switches clubs so it cannot be saved into the new club.
  const previousClubId = useRef(selectedClubId);
  useEffect(() => {
    if (previousClubId.current === selectedClubId) return;
    previousClubId.current = selectedClubId;
    setError('');
    setForm(emptyForm());
  }, [emptyForm, selectedClubId]);

  // Stable API error codes → translated text; anything unknown is a generic save error.
  function expenseErrorMessage(code: string | null): string {
    const key = code ? EXPENSE_ERROR_KEYS[code] : undefined;
    return key ? t(`errors.${key}`) : t('saveError');
  }

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    // Edited values are a different expense, not a retry of the last attempt.
    requestId.current = null;
    setError('');
    const lastRate = balanceQuery.data?.usdRate ?? null;
    setForm((current) => {
      const next = { ...current, [field]: value };
      // A new source starts on its own first method, so the reserve opens on its sums.
      if (field === 'payment_source' && value !== current.payment_source) {
        const offered = methodsFor(next.payment_source);
        if (!offered.includes(next.payment_method) || next.payment_source === 'reserve') next.payment_method = offered[0] ?? next.payment_method;
      }
      // Leaving dollars for sums: sum amounts are whole, so show what will be saved.
      if (current.payment_method === 'usd' && next.payment_method !== 'usd') next.amount = formatCurrencyInput(current.amount);
      // Paying in dollars starts from the club's latest dollar rate.
      if (next.payment_method === 'usd' && current.payment_method !== 'usd' && !current.usd_rate && lastRate) {
        next.usd_rate = String(lastRate);
      }
      return next;
    });
  }

  function choosePreset(presetId: string) {
    requestId.current = null;
    const preset = presets.find((item) => item.id === presetId);
    setForm((current) => (preset
      ? {
        ...current,
        preset_id: preset.id,
        category: preset.category,
        // A plan paid from the reserve stays on the reserve; its side is still the plan's.
        payment_source: current.payment_source === 'reserve' ? 'reserve' : preset.payment_source,
        // The plan's usual method is a default the person can still change.
        ...(preset.payment_method && enabledPaymentMethods.includes(preset.payment_method)
          ? { payment_method: preset.payment_method }
          : {}),
      }
      : { ...current, preset_id: '' }));
  }

  function categoryLabel(category: string): string {
    return t(`categories.${category}`);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitPending.current) return;
    const amount = paysInDollars ? dollarAmount : expenseAmountFromInput(form.amount, plannedAmount);
    const category = form.category;

    if (!selectedClubId) {
      setError(tc('error'));
      return;
    }
    if (paysInDollars && usdAmount > 0 && !(usdRate > 0)) {
      setError(t('usdRateRequired'));
      return;
    }
    if (!amount || amount <= 0) {
      setError(tc('invalidAmount'));
      return;
    }
    if (overBalance) {
      setError(t('errors.insufficientBalance'));
      return;
    }
    if (!category) {
      setError(tc('required'));
      return;
    }
    if (!paymentMethods.includes(form.payment_method)) {
      setError(t('paymentMethodUnavailable'));
      return;
    }
    if (form.date > businessToday) {
      setError(t('futureDateError'));
      return;
    }
    if (dayClosed) {
      setError(tc('dayClosed'));
      return;
    }
    if (!note.check(form.comment)) {
      setError('');
      return;
    }

    submitPending.current = true;
    setSaving(true);
    setError('');

    let saved = false;
    try {
      const response = await mutateFinanceRequest('/api/expenses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: (requestId.current ??= crypto.randomUUID()),
          clubId: selectedClubId,
          date: form.date,
          amount,
          category,
          paymentMethod: form.payment_method,
          // The row still lives on a side: the plan's, or Game Club's. The reserve pays it either way.
          paymentSource: onReserve ? selectedPreset?.payment_source ?? 'game_club' : form.payment_source,
          comment: form.comment.trim() || null,
          presetId: selectedPreset?.id ?? null,
          ...(paysInDollars ? { usdAmount, usdRate } : {}),
          ...(fromReserve ? { fromReserve: true } : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: unknown } | null;
        const code = typeof body?.code === 'string' ? body.code : null;
        if (code === 'NOTE_REQUIRED') {
          note.reject(form.comment);
          return;
        }
        setError(expenseErrorMessage(code));
        // Money was spent meanwhile: show what is left now.
        if (code === 'INSUFFICIENT_BALANCE') void balanceQuery.reload({ silent: true });
        if (code === 'RESERVE_INSUFFICIENT') void reserveQuery.reload({ silent: true });
        // The plan was archived or changed meanwhile: drop it and show the current list.
        if (code === 'PRESET_UNAVAILABLE') {
          requestId.current = null;
          setForm((current) => ({ ...current, preset_id: '' }));
          void presetQuery.reload({ silent: true });
        }
        return;
      }

      saved = true;
      requestId.current = null;
      note.reset();
      // The inline form stays mounted between expenses; keep its plans and balances current.
      void presetQuery.reload({ silent: true });
      void balanceQuery.reload({ silent: true });
      void reserveQuery.reload({ silent: true });
      setForm(emptyForm());
    } catch {
      setError(t('saveError'));
    } finally {
      submitPending.current = false;
      setSaving(false);
    }
    if (saved) await onSaved?.();
  }

  const methodIcon = (method: ExpensePaymentMethod) => {
    if (onReserve && method !== 'usd') return <Banknote size={16} aria-hidden="true" />;
    const Icon = PAYMENT_METHOD_ICONS[method];
    return <Icon size={16} aria-hidden="true" />;
  };

  /** A method's name, with what it still holds underneath when the source is limited. */
  function methodLabel(method: ExpensePaymentMethod) {
    const name = onReserve ? t(method === 'usd' ? 'reserveMethods.usd' : 'reserveMethods.sums') : tc(`paymentMethods.${method}`);
    const balance = heldBy(method);
    if (balance === null) return name;
    return (
      <span className="flex flex-col items-start leading-tight">
        <span>{name}</span>
        <span className={cn('text-xs font-normal tabular-nums', balance <= 0 ? 'text-danger-600' : 'opacity-80')}>
          {methodMoney(method, balance)}
        </span>
      </span>
    );
  }

  const availableAddon = available === null ? null : (
    <span className={cn('ml-auto text-xs font-normal tabular-nums', overBalance || available <= 0 ? 'font-semibold text-danger-600' : 'text-gray-500')}>
      {t('availableAmount', { amount: methodMoney(form.payment_method, available) })}
    </span>
  );
  const overBalanceError = overBalance && available !== null
    ? t('overBalance', { amount: methodMoney(form.payment_method, available) })
    : undefined;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <InlineAlert variant="danger">{error}</InlineAlert>}
      {enabledPaymentMethods.length === 0 && <InlineAlert variant="warning">{t('paymentMethodUnavailable')}</InlineAlert>}

      {presetQuery.loading && presets.length === 0 && (
        <div role="status" aria-label={tc('loading')} aria-busy="true" className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <div className="flex flex-wrap gap-2">
            {['w-32', 'w-20', 'w-24', 'w-20'].map((width, index) => (
              <Skeleton key={index} className={`h-10 rounded-full ${width}`} />
            ))}
          </div>
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      )}

      {/* Without this the plans just vanish, and a payment saved now can never be linked to one. */}
      {presetQuery.error && (
        <LoadErrorAlert retrying={presetQuery.loading} onRetry={() => void presetQuery.reload()}>
          {t('presetLoadError')}
        </LoadErrorAlert>
      )}

      {presets.length > 0 && (
        <Field label={t('preset')} hint={selectedPreset
          ? t('presetPlanned', { amount: formatCurrency(selectedPreset.monthly_amount), currency: tc('currency') })
          : t('presetHelp')}
        >
          <SegmentedControl
            variant="chips"
            label={t('preset')}
            value={form.preset_id}
            onChange={choosePreset}
            options={[
              { value: '', label: t('presetNone') },
              ...presets.map((preset) => ({ value: preset.id, label: preset.name })),
            ]}
          />
        </Field>
      )}

      {/* Where the money comes from decides what can be spent, so it is chosen before the amount. */}
      <Field
        label={t('paymentSource')}
        hint={onReserve ? (isOwner && reserve && reserve.sums <= 0 ? t('reserveEmptyHint') : t('reserveHint')) : undefined}
      >
        <SegmentedControl
          variant="soft"
          label={t('paymentSource')}
          value={form.payment_source}
          onChange={(source) => set('payment_source', source)}
          columns={3}
          options={PAYMENT_SOURCES.map((source) => ({
            value: source,
            label: t(`paymentSources.${source}`),
            icon: SOURCE_ICONS[source],
            // A plan keeps its own side, but the reserve can still pay it.
            disabled: selectedPreset !== null && source !== 'reserve' && source !== selectedPreset.payment_source,
          }))}
        />
      </Field>

      <Field label={t('paymentMethod')} hint={form.payment_source === 'game_club' && showsBalances ? t('balancesHelp') : undefined}>
        {balanceQuery.error && form.payment_source !== 'bar' && (
          <LoadErrorAlert className="mb-2" retrying={balanceQuery.loading} onRetry={() => void balanceQuery.reload()}>
            {t('balancesLoadError')}
          </LoadErrorAlert>
        )}
        <SegmentedControl
          label={t('paymentMethod')}
          value={form.payment_method}
          onChange={(method) => set('payment_method', method)}
          // Three or more labels do not fit one row on a phone.
          columns={paymentMethods.length > 2 ? 2 : undefined}
          className={showsBalances ? '[&>button]:min-h-14 [&>button]:justify-start [&>button]:px-3' : undefined}
          options={paymentMethods.map((method) => ({
            value: method,
            label: methodLabel(method),
            icon: methodIcon(method),
          }))}
        />
      </Field>

      {paysInDollars ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('usdAmount')} htmlFor="expense-amount" required labelAddon={availableAddon} error={overBalanceError}>
            <DecimalInput
              id="expense-amount"
              controlSize="lg"
              autoFocus
              required
              value={form.amount}
              onValueChange={(value) => set('amount', value)}
              trailingAddon="$"
              className="text-gray-950 placeholder:text-gray-300"
            />
          </Field>
          <Field
            label={t('usdRate')}
            htmlFor="expense-usd-rate"
            required
            hint={dollarAmount === null
              ? t('usdRateHint')
              : t('usdInSums', { amount: formatCurrency(dollarAmount), currency: tc('currency') })}
          >
            <DecimalInput
              id="expense-usd-rate"
              controlSize="lg"
              required
              value={form.usd_rate}
              onValueChange={(value) => set('usd_rate', value)}
              trailingAddon={tc('currency')}
            />
          </Field>
        </div>
      ) : (
        <Field label={t('amount')} htmlFor="expense-amount" required={plannedAmount === null} labelAddon={availableAddon} error={overBalanceError}>
          <CurrencyInput
            id="expense-amount"
            controlSize="lg"
            autoFocus
            required={plannedAmount === null}
            placeholder={plannedAmount === null ? undefined : formatCurrency(plannedAmount)}
            value={form.amount}
            onValueChange={(value) => set('amount', value)}
            trailingAddon={tc('currency')}
            className="text-gray-950 placeholder:text-gray-300"
          />
        </Field>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('date')} error={dayClosed ? tc('dayClosed') : undefined}>
          <DatePicker ariaLabel={t('date')} value={form.date} max={businessToday} onChange={(value) => set('date', value)} />
        </Field>
        <Field label={t('category')} htmlFor="expense-category">
          <Select id="expense-category" required disabled={selectedPreset !== null} value={form.category} onChange={(event) => set('category', event.target.value)}>
            <option value="" disabled>{t('selectCategory')}</option>
            {/* A chosen plan always shows its own category. */}
            {[...new Set([...MANUAL_EXPENSE_CATEGORIES, ...(selectedPreset ? [selectedPreset.category] : [])])].map((category) => (
              <option key={category} value={category}>{categoryLabel(category)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <NoteField
        guard={note}
        id="expense-comment"
        label={t('comment')}
        value={form.comment}
        onChange={(value) => set('comment', value)}
        placeholder={t('commentPlaceholder')}
        maxLength={300}
      />

      <Button
        type="submit"
        size="lg"
        fullWidth
        disabled={enabledPaymentMethods.length === 0 || dayClosed || overBalance}
        loading={saving}
        loadingLabel={tc('saving')}
        icon={<Save size={18} aria-hidden="true" />}
      >
        {t('submit')}
      </Button>
      {note.dialog}
    </form>
  );
}
