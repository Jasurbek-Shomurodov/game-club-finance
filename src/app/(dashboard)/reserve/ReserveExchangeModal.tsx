'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRightLeft } from 'lucide-react';
import { PAYMENT_METHOD_ICONS } from '@/components/paymentMethodIcons';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  CurrencyInput,
  DatePicker,
  DecimalInput,
  Field,
  InlineAlert,
  Modal,
  NoteField,
  SegmentedControl,
  useEntryNoteGuard,
} from '@/components/PresentationFoundation';
import { exchangeReceivedAmount } from '@/lib/calculations/moneyExchanges';
import { formatCurrency, formatCurrencyInput, formatDecimalInput, parseCurrencyInput, parseDecimalInput, formatDollars } from '@/lib/formatters';
import { requestReserveExchange } from '@/lib/ownerReserveRequests';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useCollectedDay } from '@/lib/useCollectedDay';
import type { ReserveErrorCode } from '@/lib/supabase/ownerReserve';

type Direction = 'buy' | 'sell';
type SumsMethod = 'cash' | 'terminal' | 'card';
const SUMS_METHODS: readonly SumsMethod[] = ['cash', 'terminal', 'card'];

/** Mounted only while open, so every opening starts a fresh exchange. */
interface ReserveExchangeModalProps {
  initialDirection: Direction;
  /** Sums each method can turn into dollars (reserveBuyLimits). */
  buyLimits: Record<SumsMethod, number>;
  /** Dollars the reserve holds now. */
  dollarsHeld: number;
  /** The latest rate used, to start from. */
  lastRate: number | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

/**
 * Buys dollars with the reserve's sums or sells its dollars for sums (170).
 * Nothing leaves the reserve: only what it holds them in changes. The limits
 * shown here are the ones exchange_owner_reserve enforces.
 */
export function ReserveExchangeModal({ initialDirection, buyLimits, dollarsHeld, lastRate, onClose, onSaved }: ReserveExchangeModalProps) {
  const t = useTranslations('reservePage.exchange');
  const tr = useTranslations('ownerReserve');
  const tx = useTranslations('exchanges');
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods } = useClub();
  const businessToday = useBusinessToday(businessDayStartHour);
  const methods = SUMS_METHODS.filter((method) => enabledPaymentMethods.includes(method));
  const richest = (limits: Record<SumsMethod, number>) => methods.reduce<SumsMethod>(
    (best, method) => (limits[method] > limits[best] ? method : best),
    methods[0] ?? 'cash',
  );
  const emptyForm = () => ({
    direction: initialDirection,
    method: richest(buyLimits),
    amount: '',
    rate: lastRate ? formatDecimalInput(lastRate) : '',
    date: businessToday,
    comment: '',
  });
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const note = useEntryNoteGuard();
  const dayClosed = useCollectedDay(selectedClubId, form.date);
  // One pair of ids per exchange being entered, so a retried submit is stored once.
  const requestIds = useRef<{ id: string; entryId: string } | null>(null);

  const buying = form.direction === 'buy';
  const limit = buying ? buyLimits[form.method] : Math.max(0, dollarsHeld);
  const amount = buying ? parseCurrencyInput(form.amount) : parseDecimalInput(form.amount);
  const rate = parseDecimalInput(form.rate);
  const received = exchangeReceivedAmount(buying ? form.method : 'usd', buying ? 'usd' : form.method, amount, rate > 0 ? rate : null);
  const sums = (value: number) => `${formatCurrency(value)} ${tc('currency')}`;
  const dollars = (value: number) => formatDollars(value);
  const limitText = buying ? sums(limit) : dollars(limit);
  const nothing = buying ? methods.every((method) => buyLimits[method] <= 0) : dollarsHeld <= 0;

  function set<K extends keyof ReturnType<typeof emptyForm>>(field: K, value: ReturnType<typeof emptyForm>[K]) {
    requestIds.current = null;
    setError('');
    setForm((current) => {
      const next = { ...current, [field]: value };
      // Sums are whole and dollars keep cents: a new direction starts a new amount.
      if (field === 'direction' && value !== current.direction) {
        next.amount = '';
        if (value === 'buy') next.method = richest(buyLimits);
      }
      return next;
    });
  }

  function fillAll() {
    set('amount', buying ? formatCurrencyInput(limit) : formatDecimalInput(limit));
  }

  const failureText = (failure: ReserveErrorCode) => tr(`errors.${failure}`);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !selectedClubId) return;
    if (!amount || amount <= 0) return setError(tc('invalidAmount'));
    if (amount > limit) return setError(t('tooMuch', { amount: limitText }));
    if (!rate || rate <= 0) return setError(t('rateRequired'));
    if (received === null || received <= 0) return setError(tc('invalidAmount'));
    if (form.date > businessToday) return setError(tx('futureDateError'));
    if (dayClosed) return setError(tc('dayClosed'));
    if (!note.check(form.comment)) return setError('');

    setSaving(true);
    setError('');
    try {
      requestIds.current ??= { id: crypto.randomUUID(), entryId: crypto.randomUUID() };
      const failure = await requestReserveExchange(selectedClubId, {
        ...requestIds.current,
        date: form.date,
        direction: form.direction,
        method: form.method,
        amount,
        rate,
        comment: form.comment.trim(),
      });
      if (failure === 'note_required') {
        note.reject(form.comment);
        return;
      }
      if (failure) {
        setError(failureText(failure));
        return;
      }
      requestIds.current = null;
      note.reset();
      await onSaved();
    } catch {
      setError(tr('errors.failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      locked={saving}
      size="md"
      title={t('title')}
      description={t('description')}
      footer={(
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>{tc('cancel')}</Button>
          <Button
            type="submit"
            form="reserve-exchange-form"
            loading={saving}
            loadingLabel={tc('saving')}
            disabled={nothing || dayClosed}
            icon={<ArrowRightLeft size={16} aria-hidden="true" />}
          >
            {t('submit')}
          </Button>
        </div>
      )}
    >
      <form id="reserve-exchange-form" onSubmit={submit} className="space-y-5">
        {error ? <InlineAlert variant="danger">{error}</InlineAlert> : null}
        {nothing ? <InlineAlert variant="info">{t(buying ? 'nothingToBuy' : 'nothingToSell')}</InlineAlert> : null}

        <Field label={t('direction')}>
          <SegmentedControl
            label={t('direction')}
            value={form.direction}
            onChange={(direction) => set('direction', direction)}
            options={[
              { value: 'buy', label: t('buy') },
              { value: 'sell', label: t('sell') },
            ]}
          />
        </Field>

        {methods.length > 1 ? (
          <Field label={t(buying ? 'methodBuy' : 'methodSell')} hint={buying ? t('methodHint') : undefined}>
            <SegmentedControl
              label={t(buying ? 'methodBuy' : 'methodSell')}
              value={form.method}
              onChange={(method) => set('method', method)}
              options={methods.map((method) => {
                const Icon = PAYMENT_METHOD_ICONS[method];
                return { value: method, label: tc(`paymentMethods.${method}`), icon: <Icon size={16} aria-hidden="true" /> };
              })}
            />
          </Field>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t(buying ? 'amountSums' : 'amountDollars')}
            htmlFor="reserve-exchange-amount"
            required
            hint={(
              <Button type="button" variant="ghost" size="sm" className="-ml-3" disabled={limit <= 0} onClick={fillAll}>
                {t('available', { amount: limitText })}
              </Button>
            )}
          >
            {buying ? (
              <CurrencyInput
                id="reserve-exchange-amount"
                controlSize="lg"
                autoFocus
                required
                value={form.amount}
                onValueChange={(value) => set('amount', value)}
                trailingAddon={tc('currency')}
              />
            ) : (
              <DecimalInput
                id="reserve-exchange-amount"
                controlSize="lg"
                autoFocus
                required
                value={form.amount}
                onValueChange={(value) => set('amount', value)}
                trailingAddon="$"
              />
            )}
          </Field>
          <Field label={t('rate')} htmlFor="reserve-exchange-rate" hint={t('rateHint')} required>
            <DecimalInput
              id="reserve-exchange-rate"
              controlSize="lg"
              required
              value={form.rate}
              onValueChange={(value) => set('rate', value)}
              trailingAddon={tc('currency')}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm">
          <span className="text-gray-500">{t('receive')}</span>
          <span className="font-semibold tabular-nums text-gray-900">
            {received === null ? '—' : buying ? dollars(received) : sums(received)}
          </span>
        </div>

        <Field label={t('date')} error={dayClosed ? tc('dayClosed') : undefined}>
          <DatePicker ariaLabel={t('date')} value={form.date} max={businessToday} onChange={(value) => set('date', value)} />
        </Field>

        <NoteField
          guard={note}
          id="reserve-exchange-note"
          label={t('note')}
          value={form.comment}
          onChange={(value) => set('comment', value)}
          placeholder={t('notePlaceholder')}
          maxLength={300}
        />
      </form>
      {note.dialog}
    </Modal>
  );
}
