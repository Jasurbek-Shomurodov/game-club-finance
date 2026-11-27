'use client';

import { useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Undo2 } from 'lucide-react';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import { MONEY_SOURCE_ICONS } from '@/components/sideIcons';
import { Button, CurrencyInput, Field, InlineAlert, Modal, MonthPicker, SegmentedControl } from '@/components/PresentationFoundation';
import type { ReserveReturnLimits } from '@/lib/calculations/ownerReserve';
import { formatCurrency, formatCurrencyInput, formatYearMonth, parseCurrencyInput } from '@/lib/formatters';
import { requestReserveMove } from '@/lib/ownerReserveRequests';
import type { ReserveErrorCode } from '@/lib/supabase/ownerReserve';
import {
  OWNER_WITHDRAWAL_PAYMENT_METHODS,
  OWNER_WITHDRAWAL_SOURCES,
  type OwnerReserveMethod,
  type OwnerWithdrawalPaymentMethod,
  type OwnerWithdrawalSource,
} from '@/types';
import { METHOD_ICONS } from '@/components/owner-money/profitIcons';

/** Mounted only while open, so every opening starts a fresh return. */
interface ReserveReturnModalProps {
  /** What each bucket can give back, as the database limits a return (reserveReturnLimits). */
  limits: ReserveReturnLimits;
  /** The club's business month: the month whose profit the money goes back to by default. */
  currentMonth: string;
  methodLabel: (method: OwnerReserveMethod) => string;
  /** The page's loader; a return that started under another one (club switch, day rollover) is stale. */
  currentLoad: RefObject<unknown>;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

/**
 * Sends money from the reserve back to a month's owner profit. The reserve is
 * the home of this action; the month it returns to is chosen here because the
 * reserve page has no month of its own.
 */
export function ReserveReturnModal({ limits, currentMonth, methodLabel, currentLoad, onClose, onSaved }: ReserveReturnModalProps) {
  const t = useTranslations('moneyTaken');
  const tr = useTranslations('ownerReserve');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { selectedClubId } = useClub();
  const gameClubReturnable = OWNER_WITHDRAWAL_PAYMENT_METHODS.some((method) => limits.game_club[method] > 0);
  const [month, setMonth] = useState(currentMonth);
  const [returnTarget, setReturnTarget] = useState<OwnerWithdrawalSource>(gameClubReturnable || limits.bar <= 0 ? 'game_club' : 'bar');
  const [returnMethod, setReturnMethod] = useState<OwnerWithdrawalPaymentMethod>(
    () => OWNER_WITHDRAWAL_PAYMENT_METHODS.find((value) => limits.game_club[value] > 0) ?? 'cash',
  );
  const [returnInput, setReturnInput] = useState('');
  const [reserveError, setReserveError] = useState<ReserveErrorCode | null>(null);
  const [reserveBusy, setReserveBusy] = useState<string | null>(null);
  const reserveRequestId = useRef<string | null>(null);

  const currency = (amount: number) => `${formatCurrency(amount)} ${tc('currency')}`;
  const returnMax = returnTarget === 'game_club' ? limits.game_club[returnMethod] : returnTarget === 'bar' ? limits.bar : 0;
  const returnValue = parseCurrencyInput(returnInput);
  const returnValid = Number.isFinite(returnValue) && returnValue > 0 && returnValue <= returnMax;

  async function handleReturn(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedClubId || !returnTarget || !returnValid || reserveBusy) return;
    const operationLoad = currentLoad.current;
    reserveRequestId.current ??= crypto.randomUUID();
    setReserveBusy('return');
    setReserveError(null);
    try {
      const failure = await requestReserveMove(selectedClubId, {
        kind: 'return',
        month,
        source: returnTarget,
        comment: '',
        parts: [{ id: reserveRequestId.current, method: returnTarget === 'game_club' ? returnMethod : null, amount: Math.round(returnValue) }],
      });
      if (operationLoad !== currentLoad.current) return;
      if (failure) {
        reserveRequestId.current = null;
        setReserveError(failure);
        return;
      }
      await onSaved();
    } catch {
      setReserveError('failed');
    } finally {
      setReserveBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={() => (reserveBusy ? undefined : onClose())}
      locked={reserveBusy !== null}
      title={tr('returnTitle')}
      description={tr('returnDescription', { month: formatYearMonth(month, locale) })}
      size="md"
      footer={(
        <div className="flex w-full flex-col-reverse gap-2 short:flex-row short:justify-end short:[&>*]:flex-1 sm:flex-row sm:justify-end sm:short:[&>*]:flex-none">
          <Button type="button" variant="secondary" disabled={reserveBusy !== null} onClick={onClose}>{tc('cancel')}</Button>
          <Button type="submit" form="reserve-return-form" disabled={!returnValid} loading={reserveBusy === 'return'} loadingLabel={tc('saving')} icon={<Undo2 size={17} aria-hidden="true" />}>
            {tr('returnSave')}
          </Button>
        </div>
      )}
    >
      <form id="reserve-return-form" onSubmit={handleReturn} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('month')}>
            <MonthPicker
              value={month}
              max={currentMonth}
              disabled={reserveBusy !== null}
              onChange={(value) => {
                // A different month is a different return: it gets its own request id.
                reserveRequestId.current = null;
                setMonth(value);
              }}
            />
          </Field>
          <Field label={t('source')}>
            <SegmentedControl
              label={t('source')}
              value={returnTarget}
              disabled={reserveBusy !== null}
              onChange={(source) => {
                reserveRequestId.current = null;
                setReturnTarget(source);
                setReturnInput('');
              }}
              options={OWNER_WITHDRAWAL_SOURCES.map((source) => {
                const Icon = MONEY_SOURCE_ICONS[source];
                return {
                  value: source,
                  label: tr(`sources.${source}`),
                  icon: <Icon size={16} aria-hidden="true" />,
                  disabled: source === 'game_club' ? !gameClubReturnable : limits.bar <= 0,
                };
              })}
            />
          </Field>
        </div>
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
              options={OWNER_WITHDRAWAL_PAYMENT_METHODS.map((method) => {
                const Icon = METHOD_ICONS[method];
                return {
                  value: method,
                  disabled: limits.game_club[method] <= 0,
                  label: (
                    <span className="flex flex-col items-center py-1 leading-tight">
                      <span className="inline-flex items-center gap-1.5"><Icon size={14} aria-hidden="true" />{methodLabel(method)}</span>
                      <span className="mt-0.5 text-xs font-normal tabular-nums opacity-80">{formatCurrency(limits.game_club[method])}</span>
                    </span>
                  ),
                };
              })}
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
            <Button type="button" variant="secondary" size="lg" className="shrink-0" disabled={returnMax <= 0} onClick={() => setReturnInput(formatCurrencyInput(returnMax))}>
              {t('takeAll')}
            </Button>
          </div>
        </Field>
        {reserveError ? <InlineAlert variant="danger">{tr(`errors.${reserveError}`)}</InlineAlert> : null}
      </form>
    </Modal>
  );
}
