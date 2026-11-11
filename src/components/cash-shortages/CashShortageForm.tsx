'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, CircleHelp, CreditCard, Gamepad2, HandCoins, MonitorSmartphone, TriangleAlert, Wine, type LucideIcon } from 'lucide-react';
import {
  Button,
  CurrencyInput,
  DatePicker,
  Field,
  InlineAlert,
  NoteField,
  SegmentedControl,
  Select,
  useEntryNoteGuard,
} from '@/components/PresentationFoundation';
import { recordCashShortage } from '@/lib/cashShortageApi';
import type { ShortageEmployee, ShortageErrorCode } from '@/lib/supabase/cashShortages';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput } from '@/lib/formatters';
import { CASH_SHORTAGE_REASONS, type CashShortageMethod, type CashShortageReason, type OwnerWithdrawalSource } from '@/types';

export const SHORTAGE_METHOD_ICONS: Record<CashShortageMethod, LucideIcon> = {
  cash: Banknote,
  terminal: MonitorSmartphone,
  card: CreditCard,
  playstation: Gamepad2,
};

/** Methods a shortage can come from: the club's enabled ones, plus PlayStation on the Game Club side. */
export function shortageMethods(enabled: readonly string[], source: OwnerWithdrawalSource): CashShortageMethod[] {
  const uzs = (['cash', 'terminal', 'card'] as const).filter((method) => enabled.includes(method));
  return source === 'game_club' ? [...uzs, 'playstation'] : uzs;
}

interface CashShortageFormProps {
  clubId: string;
  defaultDate: string;
  /** The club business date: a shortage is never dated after it. */
  maxDate: string;
  enabledPaymentMethods: readonly string[];
  employees: readonly ShortageEmployee[];
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
}

/** Records money missing from the till, optionally taking part back from the responsible employee's salary. */
export function CashShortageForm({ clubId, defaultDate, maxDate, enabledPaymentMethods, employees, onSaved, onCancel }: CashShortageFormProps) {
  const t = useTranslations('cashShortages');
  const tc = useTranslations('common');
  const note = useEntryNoteGuard();
  const [date, setDate] = useState(defaultDate);
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

  const methods = shortageMethods(enabledPaymentMethods, source);
  const amountValue = parseCurrencyInput(amount);
  const amountValid = Number.isFinite(amountValue) && amountValue > 0;
  const recoverValue = recover ? parseCurrencyInput(recover) : 0;
  const recoverValid = !employeeId || !recover || (Number.isFinite(recoverValue) && recoverValue >= 0 && (!amountValid || recoverValue <= amountValue));
  const employeeName = employees.find((employee) => employee.id === employeeId)?.name ?? '';

  function changeSource(next: OwnerWithdrawalSource) {
    setSource(next);
    const nextMethods = shortageMethods(enabledPaymentMethods, next);
    if (!nextMethods.includes(method)) setMethod(nextMethods[0] ?? 'cash');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || !amountValid || !recoverValid) return;
    if (!note.check(comment)) return;
    requestIds.current ??= { shortage: crypto.randomUUID(), recovery: crypto.randomUUID() };
    setSaving(true);
    setError(null);
    try {
      const failure = await recordCashShortage(clubId, {
        id: requestIds.current.shortage,
        recoveryId: requestIds.current.recovery,
        date,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-busy={saving || undefined}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <Field label={t('date')}>
          <DatePicker ariaLabel={t('date')} value={date} max={maxDate} disabled={saving} onChange={setDate} />
        </Field>
        <Field label={t('source')}>
          <SegmentedControl
            label={t('source')}
            value={source}
            onChange={changeSource}
            disabled={saving}
            options={(['game_club', 'bar'] as const).map((value) => {
              const Icon = value === 'bar' ? Wine : Gamepad2;
              return { value, label: t(`sources.${value}`), icon: <Icon size={16} aria-hidden="true" /> };
            })}
          />
        </Field>
      </div>

      <Field label={t('method')} required>
        <SegmentedControl
          label={t('method')}
          value={method}
          onChange={setMethod}
          disabled={saving}
          columns="auto"
          className="grid-cols-2 sm:grid-cols-4"
          options={methods.map((value) => {
            const Icon = SHORTAGE_METHOD_ICONS[value];
            return { value, label: tc(`paymentMethods.${value}`), icon: <Icon size={15} aria-hidden="true" /> };
          })}
        />
      </Field>

      <Field label={`${t('amount')} (${tc('currency')})`} htmlFor="shortage-amount" required hint={t('amountHint')}>
        <CurrencyInput id="shortage-amount" required controlSize="lg" value={amount} disabled={saving} onValueChange={setAmount} />
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

      {error ? <InlineAlert variant="danger">{t(`errors.${error}`)}</InlineAlert> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>{tc('cancel')}</Button> : null}
        <Button
          type="submit"
          variant="danger"
          disabled={!amountValid || !recoverValid}
          loading={saving}
          loadingLabel={tc('saving')}
          icon={<TriangleAlert size={17} aria-hidden="true" />}
        >
          {amountValid ? t('saveAmount', { amount: `${formatCurrency(amountValue)} ${tc('currency')}` }) : t('save')}
        </Button>
      </div>
      {note.dialog}
    </form>
  );
}
