'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PiggyBank } from 'lucide-react';
import { useModalForm, useReportFormState, type ModalFormProps } from '@/components/expenses/modalForm';
import { useClub } from '@/components/layout/DashboardShell';
import { PAYMENT_METHOD_ICONS } from '@/components/paymentMethodIcons';
import {
  CurrencyInput,
  DatePicker,
  Field,
  InlineAlert,
  LoadErrorAlert,
  Modal,
  Money,
  Skeleton,
  SkeletonStatus,
  Textarea,
} from '@/components/PresentationFoundation';
import type { CollectionBalances } from '@/lib/calculations/collectedMoney';
import { reserveDepositParts, reserveDepositPrefill, type ReserveDepositAmounts } from '@/lib/calculations/ownerReserve';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput } from '@/lib/formatters';
import { requestReserveDepositByMethod } from '@/lib/ownerReserveRequests';
import { createClient } from '@/lib/supabase/client';
import { fetchCollectionBalances } from '@/lib/supabase/moneyCollections';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { OWNER_WITHDRAWAL_PAYMENT_METHODS, type OwnerWithdrawalPaymentMethod } from '@/types';

type Method = OwnerWithdrawalPaymentMethod;
type Inputs = Record<Method, string>;

const EMPTY_INPUTS: Inputs = { cash: '', terminal: '', card: '', playstation: '' };

const toInputs = (amounts: ReserveDepositAmounts): Inputs => Object.fromEntries(OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => {
  const amount = amounts[method] ?? 0;
  return [method, amount > 0 ? formatCurrencyInput(amount) : ''];
})) as Inputs;

const tillOf = (balances: CollectionBalances): Record<Method, number> => Object.fromEntries(
  OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => [method, balances[method].till]),
) as Record<Method, number>;

export interface ReserveDepositModalProps {
  open: boolean;
  onClose: () => void;
  /** After every part is stored; the page closes the dialog, says so and reloads. */
  onSaved: () => void | Promise<void>;
  /**
   * A save ended short of that: some methods were stored and another refused,
   * or a method was refused or its request failed. The dialog stays open; the
   * page reloads silently so its figures match what is stored, even if the
   * owner then cancels.
   */
  onChanged: () => void;
  /** The day the money leaves the till; the club's business today when omitted or in the future. */
  initialDate?: string;
  /** What to start from per method (an income entry's split), never above the till. Omitted: all the till holds. */
  initialAmounts?: ReserveDepositAmounts;
}

/**
 * Puts Game Club money into the owner reserve: by payment method, out of
 * what the till holds on the chosen day. One form, launched from Reports and
 * from the reserve page; everything goes through /api/reserve, so the club's
 * group hears about it and the database checks the month's profit and the day.
 */
export function ReserveDepositModal({ open, onClose, onSaved, onChanged, initialDate, initialAmounts }: ReserveDepositModalProps) {
  const t = useTranslations('ownerReserve.depositForm');
  const tr = useTranslations('ownerReserve');
  const { formProps, footer, saving } = useModalForm({ submitLabel: tr('depositButton'), icon: <PiggyBank size={18} aria-hidden="true" />, onCancel: onClose });
  // Each opening gets a fresh form. Reopened during the closing animation, the
  // dialog stays mounted, and the form would keep the last opening's day,
  // prefill and till.
  const [openedFor, setOpenedFor] = useState(open);
  const [opening, setOpening] = useState(0);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) setOpening((count) => count + 1);
  }
  return (
    <Modal open={open} onClose={onClose} locked={saving} title={t('title')} description={t('description')} size="lg" footer={footer}>
      <ReserveDepositForm key={opening} {...formProps} onSaved={onSaved} onChanged={onChanged} initialDate={initialDate} initialAmounts={initialAmounts} />
    </Modal>
  );
}

/** The method fields while the till's balances load. */
export function ReserveDepositFieldsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: Math.max(count, 1) }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3 w-24 bg-gray-100" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-3 w-32 bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function ReserveDepositForm({ formId, onFormState, onSaved, onChanged, initialDate, initialAmounts }: ModalFormProps & Pick<ReserveDepositModalProps, 'onSaved' | 'onChanged' | 'initialDate' | 'initialAmounts'>) {
  const t = useTranslations('ownerReserve.depositForm');
  const tr = useTranslations('ownerReserve');
  const tm = useTranslations('moneyTaken');
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods } = useClub();
  const businessToday = useBusinessToday(businessDayStartHour);
  const [date, setDate] = useState(() => (initialDate && initialDate <= businessToday ? initialDate : businessToday));
  // What the launcher asked for, fixed for this opening: a parent re-render does not refill the form.
  const [wanted] = useState(initialAmounts);
  const [inputs, setInputs] = useState<Inputs>(EMPTY_INPUTS);
  /** The day the fields were last filled for; a silent reload of the same day keeps what was typed. */
  const [filledFor, setFilledFor] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** Parts this opening already stored (their fields are cleared), shown when a later part was refused. */
  const [stored, setStored] = useState<{ method: Method; amount: number }[]>([]);
  const submitPending = useRef(false);
  // One id per method being entered, so a retried submit stores each part once.
  const requestIds = useRef<Partial<Record<Method, string>>>({});

  const loadBalances = useCallback(async (): Promise<CollectionBalances | null> => (
    selectedClubId ? fetchCollectionBalances(createClient(), selectedClubId, date) : null
  ), [date, selectedClubId]);
  const balanceQuery = useClubQuery<CollectionBalances | null>(loadBalances, null);
  // After a failed load the till is unknown: the fields are not capped and the database still checks the day.
  const balances = balanceQuery.loading || balanceQuery.error ? null : balanceQuery.data;
  const ready = !balanceQuery.loading;

  // As on the collect form: a method the club turned off still shows while the till holds its money.
  // A method the launcher asked for always shows, so its prefill is never dropped (with an unknown till, or a till of zero that explains it).
  const methods = OWNER_WITHDRAWAL_PAYMENT_METHODS.filter((method) => (wanted?.[method] ?? 0) > 0 || (method === 'playstation'
    ? (balances?.playstation.till ?? 0) > 0
    : enabledPaymentMethods.includes(method) || (balances?.[method].till ?? 0) > 0));

  // Fill the fields once the chosen day's balances arrive: what was asked for, capped at the till.
  useEffect(() => {
    if (!ready || filledFor === date) return;
    const start = balances
      ? reserveDepositPrefill(wanted, tillOf(balances))
      // Before migration 169 there is no till to cap at.
      : Object.fromEntries(reserveDepositParts(wanted ?? {}, OWNER_WITHDRAWAL_PAYMENT_METHODS).map((part) => [part.method, part.amount]));
    // A method this opening already stored is not filled again on another day: only what is typed goes in.
    const fill: ReserveDepositAmounts = { ...start };
    for (const part of stored) delete fill[part.method];
    setInputs(toInputs(fill));
    setFilledFor(date);
  }, [balances, date, filledFor, ready, stored, wanted]);

  const amounts = Object.fromEntries(OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => [method, parseCurrencyInput(inputs[method])])) as Record<Method, number>;
  const parts = reserveDepositParts(amounts, methods);
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const filling = !ready || filledFor !== date;

  function setAmount(method: Method, value: string) {
    delete requestIds.current[method];
    const limit = balances?.[method].till ?? null;
    const typed = parseCurrencyInput(value);
    setInputs((current) => ({ ...current, [method]: limit !== null && typed > limit ? formatCurrencyInput(limit) : value }));
  }

  function methodLabel(method: Method) {
    return method === 'playstation' ? tm('playstation') : tc(`paymentMethods.${method}`);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitPending.current) return;
    if (!selectedClubId) {
      setError(tc('error'));
      return;
    }
    if (parts.length === 0) {
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
    const sending = parts.map((part) => ({ id: (requestIds.current[part.method] ??= crypto.randomUUID()), method: part.method, amount: part.amount }));
    // One request per method, so a refusal leaves no doubt which parts are stored. A stored
    // method's field is cleared at once: it cannot be edited, re-dated and stored a second time.
    const { failure } = await requestReserveDepositByMethod(selectedClubId, {
      month: date.slice(0, 7),
      date,
      comment: comment.trim(),
      parts: sending,
    }, (method) => {
      delete requestIds.current[method];
      const amount = sending.find((part) => part.method === method)?.amount ?? 0;
      setInputs((current) => ({ ...current, [method]: '' }));
      setStored((current) => [...current, { method, amount }]);
    });
    submitPending.current = false;
    setSaving(false);
    if (!failure) {
      await onSaved();
      return;
    }
    // The refused method keeps its amount and its id for a retry; what was stored stays stored.
    setError(tr(`errors.${failure.code}`));
    void balanceQuery.reload({ silent: true });
    onChanged();
  }

  useReportFormState(onFormState, saving, total <= 0 || filling);

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-5">
      {stored.length > 0 && (
        <InlineAlert variant="success" size="sm">
          {t('storedParts', {
            parts: stored.map((part) => `${methodLabel(part.method)} ${formatCurrency(part.amount)} ${tc('currency')}`).join(', '),
          })}
        </InlineAlert>
      )}
      {error && <InlineAlert variant="danger">{error}</InlineAlert>}
      {balanceQuery.error && (
        <LoadErrorAlert retrying={balanceQuery.loading} onRetry={() => void balanceQuery.reload()}>{t('balancesError')}</LoadErrorAlert>
      )}

      <Field label={t('date')} hint={t('dateHint')}>
        <DatePicker
          ariaLabel={t('date')}
          value={date}
          max={businessToday}
          disabled={saving}
          onChange={(value) => {
            // Another day is another deposit: new ids, and the fields refill from that day's till.
            requestIds.current = {};
            setError('');
            setDate(value);
          }}
        />
      </Field>

      {filling ? (
        <SkeletonStatus><ReserveDepositFieldsSkeleton count={enabledPaymentMethods.length} /></SkeletonStatus>
      ) : (
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
                htmlFor={`reserve-deposit-${method}`}
                hint={held !== null ? t('available', { amount: `${formatCurrency(held)} ${tc('currency')}` }) : undefined}
              >
                <CurrencyInput
                  id={`reserve-deposit-${method}`}
                  controlSize="lg"
                  value={inputs[method]}
                  disabled={saving || (held !== null && held <= 0)}
                  onValueChange={(value) => setAmount(method, value)}
                  trailingAddon={tc('currency')}
                />
              </Field>
            );
          })}
        </div>
      )}

      <Field label={t('comment')} htmlFor="reserve-deposit-comment">
        <Textarea
          id="reserve-deposit-comment"
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
    </form>
  );
}
