'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, Building2, CreditCard, Save, WalletCards } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  CurrencyInput,
  DatePicker,
  Field,
  InlineAlert,
  SegmentedControl,
  Select,
  Textarea,
} from '@/components/PresentationFoundation';
import { formatCurrency, parseCurrencyInput } from '@/lib/formatters';
import { MANUAL_EXPENSE_CATEGORIES } from '@/lib/expenseCategories';
import { createClient, mutateFinanceRequest } from '@/lib/supabase/client';
import { fetchExpensePresets } from '@/lib/supabase/expensePresets';
import type { ExpensePreset } from '@/lib/calculations/expensePlans';
import { useClubQuery } from '@/lib/useClubQuery';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessRollover } from '@/lib/useBusinessPeriod';
import { defaultPaymentMethod } from '@/lib/paymentMethods';
import type { EntryPaymentMethod } from '@/types';

const PAYMENT_SOURCES = ['game_club', 'bar'] as const;
type PaymentSource = (typeof PAYMENT_SOURCES)[number];

interface ExpenseRegistrationFormProps {
  onSaved?: () => void | Promise<void>;
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
  SERVER_ERROR: 'serverError',
};

export default function ExpenseRegistrationForm({ onSaved }: ExpenseRegistrationFormProps) {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods } = useClub();
  const businessToday = useBusinessToday(businessDayStartHour);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Blocks a second submit before the `saving` state re-renders the button.
  const submitPending = useRef(false);
  // One id per expense being entered: a retry after a lost response reuses it,
  // so the server stores the expense once. A fresh id after each success.
  const requestId = useRef<string | null>(null);
  const [form, setForm] = useState({
    date: businessToday,
    amount: '',
    category: '',
    payment_method: defaultPaymentMethod(enabledPaymentMethods),
    payment_source: 'game_club' as PaymentSource,
    comment: '',
    preset_id: '',
  });

  // The club's planned expenses: picking one fills its category and money
  // source; the amount is still entered by hand. Hidden before migration 091.
  const loadPresets = useCallback(async (): Promise<ExpensePreset[]> => {
    if (!selectedClubId) return [];
    const { presets } = await fetchExpensePresets(createClient(), selectedClubId);
    return presets.filter((preset) => !preset.archived_at);
  }, [selectedClubId]);
  const presets = useClubQuery<ExpensePreset[]>(loadPresets, []).data;
  const selectedPreset = presets.find((preset) => preset.id === form.preset_id) ?? null;

  // When the business day rolls over, a date still on the old day moves to the
  // new one; a date the user picked deliberately is kept.
  useBusinessRollover(businessToday, (previousToday, nextToday) => {
    setForm((current) => (current.date === previousToday ? { ...current, date: nextToday } : current));
  });

  // A payment method the club no longer accepts falls back to its default.
  useEffect(() => {
    setForm((current) => (enabledPaymentMethods.some((method) => method === current.payment_method)
      ? current
      : { ...current, payment_method: defaultPaymentMethod(enabledPaymentMethods) }));
  }, [enabledPaymentMethods]);

  // A half-filled form belongs to the club it was started for: clear it when
  // the user switches clubs so it cannot be saved into the new club.
  const previousClubId = useRef(selectedClubId);
  useEffect(() => {
    if (previousClubId.current === selectedClubId) return;
    previousClubId.current = selectedClubId;
    setError('');
    setForm({
      date: businessToday,
      amount: '',
      category: '',
      payment_method: defaultPaymentMethod(enabledPaymentMethods),
      payment_source: 'game_club',
      comment: '',
      preset_id: '',
    });
  }, [businessToday, enabledPaymentMethods, selectedClubId]);

  // Stable API error codes → translated text; anything unknown is a generic save error.
  function expenseErrorMessage(code: string | null): string {
    const key = code ? EXPENSE_ERROR_KEYS[code] : undefined;
    return key ? t(`errors.${key}`) : t('saveError');
  }

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    // Edited values are a different expense, not a retry of the last attempt.
    requestId.current = null;
    setForm((current) => ({ ...current, [field]: value }));
  }

  function choosePreset(presetId: string) {
    requestId.current = null;
    const preset = presets.find((item) => item.id === presetId);
    setForm((current) => (preset
      ? { ...current, preset_id: preset.id, category: preset.category, payment_source: preset.payment_source }
      : { ...current, preset_id: '' }));
  }

  function categoryLabel(category: string): string {
    return t(`categories.${category}`);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitPending.current) return;
    const amount = parseCurrencyInput(form.amount);
    const category = form.category;

    if (!selectedClubId) {
      setError(tc('error'));
      return;
    }
    if (!amount || amount <= 0) {
      setError(tc('invalidAmount'));
      return;
    }
    if (!category) {
      setError(tc('required'));
      return;
    }
    if (!enabledPaymentMethods.includes(form.payment_method)) {
      setError(t('paymentMethodUnavailable'));
      return;
    }
    if (form.date > businessToday) {
      setError(t('futureDateError'));
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
          paymentSource: form.payment_source,
          comment: form.comment.trim() || null,
          presetId: selectedPreset?.id ?? null,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: unknown } | null;
        setError(expenseErrorMessage(typeof body?.code === 'string' ? body.code : null));
        return;
      }

      saved = true;
      requestId.current = null;
      setForm({
        date: businessToday,
        amount: '',
        category: '',
        payment_method: defaultPaymentMethod(enabledPaymentMethods),
        payment_source: 'game_club',
        comment: '',
        preset_id: '',
      });
    } catch {
      setError(t('saveError'));
    } finally {
      submitPending.current = false;
      setSaving(false);
    }
    if (saved) await onSaved?.();
  }

  const methodIcon = (method: EntryPaymentMethod) =>
    method === 'cash' ? <Banknote size={16} aria-hidden="true" /> : method === 'terminal' ? <CreditCard size={16} aria-hidden="true" /> : <WalletCards size={16} aria-hidden="true" />;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <InlineAlert variant="danger">{error}</InlineAlert>}
      {enabledPaymentMethods.length === 0 && <InlineAlert variant="warning">{t('paymentMethodUnavailable')}</InlineAlert>}

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

      <Field label={t('amount')} htmlFor="expense-amount" required>
        <CurrencyInput
          id="expense-amount"
          controlSize="lg"
          autoFocus
          required
          value={form.amount}
          onValueChange={(value) => set('amount', value)}
          trailingAddon={tc('currency')}
          className="text-gray-950 placeholder:text-gray-300"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('date')}>
          <DatePicker ariaLabel={t('date')} value={form.date} max={businessToday} onChange={(value) => set('date', value)} />
        </Field>
        <Field label={t('category')} htmlFor="expense-category">
          <Select id="expense-category" required disabled={selectedPreset !== null} value={form.category} onChange={(event) => set('category', event.target.value)}>
            <option value="" disabled>{t('selectCategory')}</option>
            {MANUAL_EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>{categoryLabel(category)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={t('paymentSource')} hint={t('paymentSourceHelp')}>
        <SegmentedControl
          variant="soft"
          label={t('paymentSource')}
          value={form.payment_source}
          disabled={selectedPreset !== null}
          onChange={(source) => set('payment_source', source)}
          options={PAYMENT_SOURCES.map((source) => ({
            value: source,
            label: t(`paymentSources.${source}`),
            icon: source === 'game_club' ? <Building2 size={16} aria-hidden="true" /> : <WalletCards size={16} aria-hidden="true" />,
          }))}
        />
      </Field>

      <Field label={t('paymentMethod')}>
        <SegmentedControl
          label={t('paymentMethod')}
          value={form.payment_method}
          onChange={(method) => set('payment_method', method)}
          options={enabledPaymentMethods.map((method) => ({
            value: method,
            label: tc(`paymentMethods.${method}`),
            icon: methodIcon(method),
          }))}
        />
      </Field>

      <Field label={t('comment')} htmlFor="expense-comment">
        <Textarea
          id="expense-comment"
          value={form.comment}
          onChange={(event) => set('comment', event.target.value)}
          placeholder={t('commentPlaceholder')}
          maxLength={300}
          showCount
        />
      </Field>

      <Button type="submit" size="lg" fullWidth disabled={enabledPaymentMethods.length === 0} loading={saving} loadingLabel={tc('saving')} icon={<Save size={18} aria-hidden="true" />}>
        {t('submit')}
      </Button>
    </form>
  );
}
