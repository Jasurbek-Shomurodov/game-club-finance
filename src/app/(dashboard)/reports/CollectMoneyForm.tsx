'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HandCoins } from 'lucide-react';
import { PAYMENT_METHOD_ICONS } from '@/components/paymentMethodIcons';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  CurrencyInput,
  DatePicker,
  Field,
  InlineAlert,
  Money,
  Textarea,
} from '@/components/PresentationFoundation';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput } from '@/lib/formatters';
import { COLLECTED_METHODS, type CollectedMethod, type CollectionBalances } from '@/lib/calculations/collectedMoney';
import { createClient, mutateFinanceRequest } from '@/lib/supabase/client';
import { fetchCollectionBalances } from '@/lib/supabase/moneyCollections';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';

type Amounts = Record<CollectedMethod, string>;

const EMPTY_AMOUNTS: Amounts = { cash: '', terminal: '', card: '', playstation: '' };

/**
 * A collector takes money out of the admin's kassa (migration 169). Each
 * method starts filled with everything the kassa can give on the chosen day,
 * so collecting it all is one tap; the collector can lower any amount.
 */
export default function CollectMoneyForm({ onSaved }: { onSaved?: () => void | Promise<void> }) {
  const t = useTranslations('reports.collectMoney');
  const tc = useTranslations('common');
  const tr = useTranslations('reports');
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods } = useClub();
  const businessToday = useBusinessToday(businessDayStartHour);
  const [date, setDate] = useState(businessToday);
  const [amounts, setAmounts] = useState<Amounts>(EMPTY_AMOUNTS);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitPending = useRef(false);
  // One id per collection being entered, so a retried submit is stored once.
  const requestId = useRef<string | null>(null);

  const loadBalances = useCallback(async (): Promise<CollectionBalances | null> => (
    selectedClubId ? fetchCollectionBalances(createClient(), selectedClubId, date) : null
  ), [date, selectedClubId]);
  const balanceQuery = useClubQuery<CollectionBalances | null>(loadBalances, null);
  const balances = balanceQuery.loading ? null : balanceQuery.data;

  // A method the club turned off still shows while the kassa holds its money.
  const methods = COLLECTED_METHODS.filter((method) => method === 'playstation'
    ? (balances?.playstation.till ?? 0) > 0
    : enabledPaymentMethods.includes(method) || (balances?.[method].till ?? 0) > 0);

  // Fill every method with what the kassa holds whenever the day's balances arrive.
  useEffect(() => {
    if (!balances) return;
    requestId.current = null;
    setAmounts({
      cash: balances.cash.till > 0 ? formatCurrencyInput(balances.cash.till) : '',
      terminal: balances.terminal.till > 0 ? formatCurrencyInput(balances.terminal.till) : '',
      card: balances.card.till > 0 ? formatCurrencyInput(balances.card.till) : '',
      playstation: balances.playstation.till > 0 ? formatCurrencyInput(balances.playstation.till) : '',
    });
  }, [balances]);

  const parsed = Object.fromEntries(COLLECTED_METHODS.map((method) => [method, parseCurrencyInput(amounts[method])])) as Record<CollectedMethod, number>;
  const total = methods.reduce((sum, method) => sum + parsed[method], 0);
  const kassaTotal = balances ? methods.reduce((sum, method) => sum + balances[method].till, 0) : null;

  function setAmount(method: CollectedMethod, value: string) {
    requestId.current = null;
    const limit = balances?.[method].till ?? null;
    const typed = parseCurrencyInput(value);
    setAmounts((current) => ({ ...current, [method]: limit !== null && typed > limit ? formatCurrencyInput(limit) : value }));
  }

  function methodLabel(method: CollectedMethod) {
    return method === 'playstation' ? tr('playstation') : tc(`paymentMethods.${method}`);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitPending.current) return;
    if (!selectedClubId) {
      setError(tc('error'));
      return;
    }
    if (total <= 0) {
      setError(t('nothing'));
      return;
    }
    if (date > businessToday) {
      setError(t('futureDate'));
      return;
    }
    submitPending.current = true;
    setSaving(true);
    setError('');
    let saved = false;
    try {
      const response = await mutateFinanceRequest('/api/money-collections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clubId: selectedClubId,
          requestId: (requestId.current ??= crypto.randomUUID()),
          date,
          amounts: Object.fromEntries(methods.filter((method) => parsed[method] > 0).map((method) => [method, parsed[method]])),
          comment: comment.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: unknown } | null;
        if (body?.code === 'INSUFFICIENT_BALANCE') {
          void balanceQuery.reload({ silent: true });
          setError(t('tooMuch'));
        } else if (body?.code === 'FORBIDDEN') {
          setError(tc('accessDeniedDescription'));
        } else {
          setError(t('error'));
        }
        return;
      }
      saved = true;
      requestId.current = null;
      setComment('');
    } catch {
      setError(t('error'));
    } finally {
      submitPending.current = false;
      setSaving(false);
    }
    if (saved) await onSaved?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <InlineAlert variant="danger">{error}</InlineAlert>}

      <div className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3">
        <p className="text-xs font-medium text-primary-700">{t('inKassa')}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
          {kassaTotal === null ? '—' : <Money amount={kassaTotal} currencyClassName="text-sm font-medium text-gray-500" />}
        </p>
        <p className="mt-1 text-xs text-gray-600">{t('inKassaHint')}</p>
      </div>

      <Field label={t('date')}>
        <DatePicker ariaLabel={t('date')} value={date} max={businessToday} onChange={(value) => { requestId.current = null; setDate(value); }} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {methods.map((method) => {
          const Icon = PAYMENT_METHOD_ICONS[method];
          const held = balances?.[method].till ?? null;
          return (
            <Field
              key={method}
              label={(
                <span className="inline-flex items-center gap-1.5">
                  <Icon size={14} aria-hidden="true" className="text-gray-400" />
                  {methodLabel(method)}
                </span>
              )}
              htmlFor={`collect-${method}`}
              hint={held !== null ? t('available', { amount: `${formatCurrency(held)} ${tc('currency')}` }) : undefined}
            >
              <CurrencyInput
                id={`collect-${method}`}
                controlSize="lg"
                value={amounts[method]}
                disabled={held !== null && held <= 0}
                onValueChange={(value) => setAmount(method, value)}
                trailingAddon={tc('currency')}
              />
            </Field>
          );
        })}
      </div>

      <Field label={t('comment')} htmlFor="collect-comment">
        <Textarea
          id="collect-comment"
          rows={2}
          value={comment}
          maxLength={300}
          placeholder={t('commentPlaceholder')}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm">
        <span className="text-gray-500">{t('total')}</span>
        <span className="font-semibold tabular-nums text-gray-900"><Money amount={total} /></span>
      </div>

      <Button
        type="submit"
        size="lg"
        fullWidth
        disabled={total <= 0 || balanceQuery.loading}
        loading={saving}
        loadingLabel={tc('saving')}
        icon={<HandCoins size={18} aria-hidden="true" />}
      >
        {t('submit')}
      </Button>
    </form>
  );
}
