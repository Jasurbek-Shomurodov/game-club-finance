'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CircleHelp, HandCoins, TriangleAlert, type LucideIcon } from 'lucide-react';
import { MONEY_SOURCE_ICONS } from '@/components/sideIcons';
import { PAYMENT_METHOD_ICONS } from '@/components/paymentMethodIcons';
import {
  Button,
  CurrencyInput,
  Field,
  InlineAlert,
  Modal,
  MonthPicker,
  NoteField,
  SegmentedControl,
  Select,
  useEntryNoteGuard,
} from '@/components/PresentationFoundation';
import { recordCashShortage } from '@/lib/cashShortageApi';
import { createClient } from '@/lib/supabase/client';
import {
  fetchShortageLimits,
  shortageLimitFor,
  type ShortageEmployee,
  type ShortageErrorCode,
  type ShortageLimits,
} from '@/lib/supabase/cashShortages';
import { monthRange } from '@/lib/utils';
import { formatCurrency, formatCurrencyInput, formatDateOnly, formatYearMonth, parseCurrencyInput } from '@/lib/formatters';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { CASH_SHORTAGE_REASONS, type CashShortageMethod, type CashShortageReason, type OwnerWithdrawalSource } from '@/types';

/** The payment-method icons every other form uses. */
export const SHORTAGE_METHOD_ICONS: Record<CashShortageMethod, LucideIcon> = {
  cash: PAYMENT_METHOD_ICONS.cash,
  terminal: PAYMENT_METHOD_ICONS.terminal,
  card: PAYMENT_METHOD_ICONS.card,
  playstation: PAYMENT_METHOD_ICONS.playstation,
};

/** Methods a shortage can come from: the club's enabled ones, plus PlayStation on the Game Club side. */
export function shortageMethods(enabled: readonly string[], source: OwnerWithdrawalSource): CashShortageMethod[] {
  const uzs = (['cash', 'terminal', 'card'] as const).filter((method) => enabled.includes(method));
  return source === 'game_club' ? [...uzs, 'playstation'] : uzs;
}

interface CashShortageFormProps {
  clubId: string;
  /** YYYY-MM the form opens on. */
  defaultMonth: string;
  /** The club business date: a shortage is never in a later month, nor dated after it. */
  today: string;
  enabledPaymentMethods: readonly string[];
  employees: readonly ShortageEmployee[];
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
}

/**
 * The dialog that records money missing from the till in a month, optionally
 * taking part back from the responsible employee's salary. The amount can never
 * exceed what that month still has in the chosen money (migration 151 refuses
 * it as well). Mounted only while open, so every opening starts a fresh form.
 */
export function CashShortageModal(props: CashShortageFormProps & { onCancel: () => void }) {
  return <ShortageForm {...props} modal />;
}

/** The same form inline, with its buttons under the fields, for a caller that brings its own dialog. */
export function CashShortageForm(props: CashShortageFormProps) {
  return <ShortageForm {...props} />;
}

function ShortageForm({ clubId, defaultMonth, today, enabledPaymentMethods, employees, onSaved, onCancel, modal = false }: CashShortageFormProps & { modal?: boolean }) {
  const t = useTranslations('cashShortages');
  const tc = useTranslations('common');
  const note = useEntryNoteGuard();
  const { locale } = useAppLocale();
  const maxMonth = today.slice(0, 7);
  const [month, setMonth] = useState(defaultMonth > maxMonth ? maxMonth : defaultMonth);
  // undefined while loading; null before migration 151 (no limit known).
  const [limits, setLimits] = useState<ShortageLimits | null | undefined>(undefined);
  const [limitsFailed, setLimitsFailed] = useState(false);
  const [source, setSource] = useState<OwnerWithdrawalSource>('game_club');
  const [method, setMethod] = useState<CashShortageMethod>(() => shortageMethods(enabledPaymentMethods, 'game_club')[0] ?? 'cash');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<CashShortageReason>('stolen');
  const [employeeId, setEmployeeId] = useState('');
  const [recover, setRecover] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ShortageErrorCode | null>(null);
  // One id per submit attempt, so a retry after a lost response is saved once.
  const requestIds = useRef<{ shortage: string; recovery: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLimits(undefined);
    setLimitsFailed(false);
    fetchShortageLimits(createClient(), clubId, month)
      .then((result) => { if (!cancelled) setLimits(result); })
      .catch(() => { if (!cancelled) setLimitsFailed(true); });
    return () => { cancelled = true; };
  }, [clubId, month]);

  const methods = shortageMethods(enabledPaymentMethods, source);
  const limit = limits ? shortageLimitFor(limits, source, method) : null;
  // Before 151 the shortage is dated inside the month as before: today, or the month's last day.
  const date = limits ? limits.date : month === maxMonth ? today : monthRange(month).to;
  const allCollected = limits !== undefined && limits !== null && limits.date === null;
  const amountValue = parseCurrencyInput(amount);
  const amountEntered = Number.isFinite(amountValue) && amountValue > 0;
  const overLimit = amountEntered && limit !== null && amountValue > limit;
  const amountValid = amountEntered && !overLimit;
  const limitsReady = limits !== undefined && !limitsFailed && !allCollected;
  const recoverValue = recover ? parseCurrencyInput(recover) : 0;
  const recoverValid = !employeeId || !recover || (Number.isFinite(recoverValue) && recoverValue >= 0 && (!amountValid || recoverValue <= amountValue));
  const employeeName = employees.find((employee) => employee.id === employeeId)?.name ?? '';

  /** The amount never goes above what the month has: typing more stops at the limit. */
  function changeAmount(value: string) {
    const parsed = parseCurrencyInput(value);
    setAmount(limit !== null && Number.isFinite(parsed) && parsed > limit ? formatCurrencyInput(limit) : value);
  }

  /** Switching to money that has less trims an amount already typed. */
  function clampTo(nextSource: OwnerWithdrawalSource, nextMethod: CashShortageMethod) {
    if (!limits || !amountEntered) return;
    const nextLimit = shortageLimitFor(limits, nextSource, nextMethod);
    if (amountValue > nextLimit) setAmount(nextLimit > 0 ? formatCurrencyInput(nextLimit) : '');
  }

  function changeMethod(next: CashShortageMethod) {
    setMethod(next);
    clampTo(source, next);
  }

  function changeSource(next: OwnerWithdrawalSource) {
    setSource(next);
    const nextMethods = shortageMethods(enabledPaymentMethods, next);
    const nextMethod = nextMethods.includes(method) ? method : nextMethods[0] ?? 'cash';
    setMethod(nextMethod);
    clampTo(next, nextMethod);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || !amountValid || !recoverValid || !limitsReady || !date) return;
    if (!note.check(comment)) return;
    requestIds.current ??= { shortage: crypto.randomUUID(), recovery: crypto.randomUUID() };
    setSaving(true);
    setError(null);
    try {
      const failure = await recordCashShortage(clubId, {
        id: requestIds.current.shortage,
        recoveryId: requestIds.current.recovery,
        date: date ?? today,
        source,
        method,
        amount: Math.round(amountValue),
        reason,
        employeeId: employeeId || null,
        comment,
        recoverAmount: employeeId ? Math.round(recoverValue) : 0,
      });
      if (failure === 'note_required') {
        note.reject(comment);
        return;
      }
      if (failure) {
        setError(failure);
        // A refused request is final: the next attempt is a new request.
        requestIds.current = null;
        return;
      }
      requestIds.current = null;
      note.reset();
      await onSaved();
    } catch {
      setError('failed');
    } finally {
      setSaving(false);
    }
  }

  const reasonIcons: Record<CashShortageReason, LucideIcon> = { stolen: TriangleAlert, short_handover: HandCoins, unknown: CircleHelp };

  const actions = (
    <div className="flex w-full flex-col-reverse gap-2 short:flex-row short:justify-end short:[&>*]:flex-1 sm:flex-row sm:justify-end sm:short:[&>*]:flex-none">
      {onCancel ? <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>{tc('cancel')}</Button> : null}
      <Button
        type="submit"
        form="cash-shortage-form"
        variant="danger"
        disabled={!amountValid || !recoverValid || !limitsReady || !date}
        loading={saving}
        loadingLabel={tc('saving')}
        icon={<TriangleAlert size={17} aria-hidden="true" />}
      >
        {amountValid ? t('saveAmount', { amount: `${formatCurrency(amountValue)} ${tc('currency')}` }) : t('save')}
      </Button>
    </div>
  );

  const form = (
    <form id="cash-shortage-form" onSubmit={handleSubmit} className="space-y-4" aria-busy={saving || undefined}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <Field label={t('month')} hint={date && limits ? t('datedOn', { date: formatDateOnly(date, locale) }) : undefined}>
          <MonthPicker value={month} max={maxMonth} disabled={saving} onChange={setMonth} />
        </Field>
        <Field label={t('source')}>
          <SegmentedControl
            label={t('source')}
            value={source}
            onChange={changeSource}
            disabled={saving}
            options={(['game_club', 'bar'] as const).map((value) => {
              const Icon = MONEY_SOURCE_ICONS[value];
              return { value, label: t(`sources.${value}`), icon: <Icon size={16} aria-hidden="true" /> };
            })}
          />
        </Field>
      </div>

      <Field
        label={t('method')}
        required
        hint={limit !== null ? (
          <>
            {source === 'bar' ? t('availableBar') : t('availableMethod', { method: tc(`paymentMethods.${method}`) })}:{' '}
            <span className="font-semibold tabular-nums text-success-600">{formatCurrency(limit)} {tc('currency')}</span>
          </>
        ) : undefined}
      >
        <SegmentedControl
          label={t('method')}
          value={method}
          onChange={changeMethod}
          disabled={saving}
          columns="auto"
          className="grid-cols-2 sm:grid-cols-4"
          options={methods.map((value) => {
            const Icon = SHORTAGE_METHOD_ICONS[value];
            const held = limits && source === 'game_club' ? limits.gameClub[value] : null;
            return {
              value,
              disabled: held === 0 && value !== method,
              icon: held === null ? <Icon size={15} aria-hidden="true" /> : undefined,
              label: held === null ? tc(`paymentMethods.${value}`) : (
                <span className="flex flex-col items-center py-1 leading-tight">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon size={15} aria-hidden="true" />
                    {tc(`paymentMethods.${value}`)}
                  </span>
                  <span className="mt-0.5 text-xs font-normal tabular-nums opacity-80">{formatCurrency(held)}</span>
                </span>
              ),
            };
          })}
        />
      </Field>

      <Field
        label={`${t('amount')} (${tc('currency')})`}
        htmlFor="shortage-amount"
        required
        hint={limit === 0 ? t('nothingAvailable') : t('amountHint')}
        error={overLimit && limit !== null ? t('exceedsAvailable', { amount: `${formatCurrency(limit)} ${tc('currency')}` }) : undefined}
      >
        <div className="flex gap-2">
          <CurrencyInput
            id="shortage-amount"
            className="flex-1"
            required
            controlSize="lg"
            value={amount}
            invalid={overLimit}
            disabled={saving || limit === 0}
            onValueChange={changeAmount}
          />
          {limit !== null && limit > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="shrink-0"
              disabled={saving}
              aria-label={t('takeAllLabel', { amount: `${formatCurrency(limit)} ${tc('currency')}` })}
              onClick={() => setAmount(formatCurrencyInput(limit))}
            >
              {t('takeAll')}
            </Button>
          ) : null}
        </div>
      </Field>

      <Field label={t('reason')}>
        <SegmentedControl
          label={t('reason')}
          value={reason}
          onChange={setReason}
          disabled={saving}
          columns="auto"
          className="grid-cols-1 sm:grid-cols-3"
          options={CASH_SHORTAGE_REASONS.map((value) => {
            const Icon = reasonIcons[value];
            return { value, label: t(`reasons.${value}`), icon: <Icon size={15} aria-hidden="true" /> };
          })}
        />
      </Field>

      <Field label={t('employee')} htmlFor="shortage-employee" hint={employees.length === 0 ? t('noEmployees') : undefined}>
        <Select
          id="shortage-employee"
          value={employeeId}
          disabled={saving}
          onChange={(event) => {
            setEmployeeId(event.target.value);
            if (!event.target.value) setRecover('');
          }}
        >
          <option value="">{t('employeeUnknown')}</option>
          {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </Select>
      </Field>

      {employeeId ? (
        <Field
          label={`${t('recoverNow')} (${tc('currency')})`}
          htmlFor="shortage-recover"
          hint={t('recoverHint', { name: employeeName })}
          error={!recoverValid ? t('recoverTooLarge', { amount: formatCurrency(amountValid ? amountValue : 0) }) : undefined}
        >
          <div className="flex gap-2">
            <CurrencyInput
              id="shortage-recover"
              className="flex-1"
              value={recover}
              invalid={!recoverValid}
              disabled={saving}
              onValueChange={setRecover}
            />
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              disabled={saving || !amountValid}
              onClick={() => setRecover(formatCurrencyInput(amountValue))}
            >
              {t('recoverAll')}
            </Button>
          </div>
        </Field>
      ) : null}

      <NoteField
        guard={note}
        id="shortage-comment"
        label={t('comment')}
        value={comment}
        onChange={setComment}
        placeholder={t('commentPlaceholder')}
        maxLength={1000}
        disabled={saving}
      />

      {allCollected ? <InlineAlert variant="warning">{t('allCollected', { month: formatYearMonth(month, locale) })}</InlineAlert> : null}
      {limitsFailed ? <InlineAlert variant="danger">{t('limitsLoadError')}</InlineAlert> : null}
      {error ? <InlineAlert variant="danger">{t(`errors.${error}`)}</InlineAlert> : null}

      {modal ? null : actions}
      {note.dialog}
    </form>
  );

  if (!modal) return form;
  return (
    <Modal open onClose={onCancel ?? (() => {})} title={t('title')} description={t('description')} size="xl" footer={actions}>
      {form}
    </Modal>
  );
}
