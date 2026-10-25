'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRightLeft, CircleDollarSign, type LucideIcon } from 'lucide-react';
import { PAYMENT_METHOD_ICONS } from '@/components/paymentMethodIcons';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  CurrencyInput,
  DatePicker,
  Field,
  InlineAlert,
  SegmentedControl,
  Textarea,
} from '@/components/PresentationFoundation';
import { formatCurrency, formatUnitCurrency, parseCurrencyInput } from '@/lib/formatters';
import {
  exchangeNeedsRate,
  exchangeReceivedAmount,
  type ExchangeMethod,
} from '@/lib/calculations/moneyExchanges';
import { mutateFinanceRequest } from '@/lib/supabase/client';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessRollover } from '@/lib/useBusinessPeriod';
import { useCollectedDay } from '@/lib/useCollectedDay';

interface ExchangeFormProps {
  onSaved?: () => void | Promise<void>;
}

const ERROR_KEYS: Record<string, string> = {
  UNAUTHORIZED: 'unauthorized',
  INVALID_REQUEST: 'invalidRequest',
  FORBIDDEN: 'forbidden',
  PAYMENT_METHOD_DISABLED: 'paymentMethodDisabled',
  REQUEST_CONFLICT: 'requestConflict',
  NOT_AVAILABLE: 'notAvailable',
};

const METHOD_ICONS: Record<ExchangeMethod, LucideIcon> = { ...PAYMENT_METHOD_ICONS, usd: CircleDollarSign };

/** Moves Game Club money between payment methods, or into and out of dollars at a typed rate. */
export default function ExchangeForm({ onSaved }: ExchangeFormProps) {
  const t = useTranslations('exchanges');
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods } = useClub();
  const businessToday = useBusinessToday(businessDayStartHour);
  const methods: ExchangeMethod[] = [...enabledPaymentMethods, 'usd'];
  const emptyForm = () => ({
    date: businessToday,
    from: methods[0] ?? 'cash',
    to: methods[1] ?? 'usd',
    amount: '',
    rate: '',
    comment: '',
  });
  const [form, setForm] = useState(emptyForm);
  // A date whose money was collected is closed (097); say so before saving.
  const dayClosed = useCollectedDay(selectedClubId, form.date);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitPending = useRef(false);
  // One id per exchange being entered, so a retried submit is stored once.
  const requestId = useRef<string | null>(null);

  useBusinessRollover(businessToday, (previousToday, nextToday) => {
    setForm((current) => (current.date === previousToday ? { ...current, date: nextToday } : current));
  });

  // A half-filled exchange belongs to the club it was started for.
  const previousClubId = useRef(selectedClubId);
  useEffect(() => {
    if (previousClubId.current === selectedClubId) return;
    previousClubId.current = selectedClubId;
    requestId.current = null;
    setError('');
    setForm(emptyForm());
    // emptyForm reads the current club's methods and business date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClubId]);

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    requestId.current = null;
    setForm((current) => {
      const next = { ...current, [field]: value };
      // Picking the method on the other side swaps them instead of making both equal.
      if (field === 'from' && value === current.to) next.to = current.from;
      if (field === 'to' && value === current.from) next.from = current.to;
      return next;
    });
  }

  const amount = parseCurrencyInput(form.amount);
  const needsRate = exchangeNeedsRate(form.from, form.to);
  const rate = needsRate ? parseCurrencyInput(form.rate) : null;
  const received = exchangeReceivedAmount(form.from, form.to, amount, rate);
  const formatAmount = (method: ExchangeMethod, value: number) => (
    method === 'usd' ? `$${formatUnitCurrency(value)}` : `${formatCurrency(value)} ${tc('currency')}`
  );
  const methodOptions = methods.map((method) => {
    const Icon = METHOD_ICONS[method];
    return { value: method, label: t(`methods.${method}`), icon: <Icon size={16} aria-hidden="true" /> };
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitPending.current) return;
    if (!selectedClubId) {
      setError(tc('error'));
      return;
    }
    if (form.from === form.to) {
      setError(t('sameMethod'));
      return;
    }
    if (!amount || amount <= 0) {
      setError(tc('invalidAmount'));
      return;
    }
    if (needsRate && (!rate || rate <= 0)) {
      setError(t('rateRequired'));
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

    submitPending.current = true;
    setSaving(true);
    setError('');
    let saved = false;
    try {
      const response = await mutateFinanceRequest('/api/exchanges', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: (requestId.current ??= crypto.randomUUID()),
          clubId: selectedClubId,
          date: form.date,
          from: form.from,
          to: form.to,
          amount,
          rate,
          comment: form.comment.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: unknown } | null;
        if (body?.code === 'DAY_COLLECTED') {
          setError(tc('dayClosed'));
          return;
        }
        const key = typeof body?.code === 'string' ? ERROR_KEYS[body.code] : undefined;
        setError(key ? t(`errors.${key}`) : t('saveError'));
        return;
      }
      saved = true;
      requestId.current = null;
      setForm(emptyForm());
    } catch {
      setError(t('saveError'));
    } finally {
      submitPending.current = false;
      setSaving(false);
    }
    if (saved) await onSaved?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <InlineAlert variant="danger">{error}</InlineAlert>}

      <Field label={t('from')}>
        <SegmentedControl label={t('from')} value={form.from} onChange={(method) => set('from', method)} options={methodOptions} />
      </Field>
      <Field label={t('to')}>
        <SegmentedControl label={t('to')} value={form.to} onChange={(method) => set('to', method)} options={methodOptions} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('amount')} htmlFor="exchange-amount" required>
          <CurrencyInput
            id="exchange-amount"
            controlSize="lg"
            autoFocus
            required
            value={form.amount}
            onValueChange={(value) => set('amount', value)}
            trailingAddon={form.from === 'usd' ? '$' : tc('currency')}
          />
        </Field>
        {needsRate && (
          <Field label={t('rate')} htmlFor="exchange-rate" hint={t('rateHint')} required>
            <CurrencyInput
              id="exchange-rate"
              controlSize="lg"
              required
              value={form.rate}
              onValueChange={(value) => set('rate', value)}
              trailingAddon={tc('currency')}
            />
          </Field>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm">
        <span className="text-gray-500">{t('receive')}</span>
        <span className="font-semibold tabular-nums text-gray-900">
          {received === null ? '—' : formatAmount(form.to, received)}
        </span>
      </div>

      <Field label={t('date')} error={dayClosed ? tc('dayClosed') : undefined}>
        <DatePicker ariaLabel={t('date')} value={form.date} max={businessToday} onChange={(value) => set('date', value)} />
      </Field>

      <Field label={t('comment')} htmlFor="exchange-comment">
        <Textarea
          id="exchange-comment"
          value={form.comment}
          onChange={(event) => set('comment', event.target.value)}
          placeholder={t('commentPlaceholder')}
          maxLength={300}
          showCount
        />
      </Field>

      <Button type="submit" size="lg" fullWidth disabled={dayClosed} loading={saving} loadingLabel={tc('saving')} icon={<ArrowRightLeft size={18} aria-hidden="true" />}>
        {t('submit')}
      </Button>
    </form>
  );
}
