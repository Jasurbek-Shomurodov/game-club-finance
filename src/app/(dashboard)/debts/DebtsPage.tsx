'use client';

// Route: /debts

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CurrencyInput,
  DatePicker,
  DetailListSkeleton,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  LoadErrorAlert,
  MetricCard,
  Modal,
  Money,
  PageHeader,
  SectionHeading,
  SegmentedControl,
  Skeleton,
  useToast,
  MetricMoney,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { cn } from '@/lib/utils';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessRollover } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { formatCurrency, formatDate, formatNumber, parseCurrencyInput } from '@/lib/formatters';
import {
  calculateRemainingDebt,
  canManageDebts,
  classifyDebtPaymentInsertError,
  getDebtStatus,
} from '@/lib/calculations/debt';
import { getDebtDateIssue, validateDebtPayment } from '@/lib/validation';
import { Plus, Users, Wallet } from 'lucide-react';
import { defaultPaymentMethod } from '@/lib/paymentMethods';
import type { NewDebt, DebtPayment, EntryPaymentMethod } from '@/types';

const DEBT_COLUMNS = 'id,club_id,person_name,date,amount,paid_amount,remaining_amount,category,comment,status,created_by,created_at,updated_at';
const DEBT_PAYMENT_COLUMNS = 'id,club_id,debt_id,date,amount,payment_method,comment,created_at';

type DebtStatusVariant = 'danger' | 'warning' | 'success';

function statusVariant(status: string): DebtStatusVariant {
  if (status === 'paid') return 'success';
  if (status === 'partial') return 'warning';
  return 'danger';
}

/** Single source for the outstanding amount shown in the list, the modal and validation. */
function remainingFor(debt: Pick<NewDebt, 'amount' | 'paid_amount'>): number {
  return calculateRemainingDebt(Number(debt.amount) || 0, Number(debt.paid_amount) || 0);
}

export default function DebtsPage() {
  const t = useTranslations('debts');
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods, role } = useClub();
  const { locale } = useAppLocale();
  const { showToast, toastElement } = useToast();
  const businessToday = useBusinessToday(businessDayStartHour);

  const [addOpen, setAddOpen] = useState(false);
  const [payDebtId, setPayDebtId] = useState<string | null>(null);
  const [payments, setPayments] = useState<DebtPayment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showPaid, setShowPaid] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState('');
  // Club the open modal belongs to; a submit is refused if the selected club changed meanwhile.
  const [formClubId, setFormClubId] = useState<string | null>(null);
  const paymentsRequestSequence = useRef(0);
  const canManage = canManageDebts(role);

  const [addForm, setAddForm] = useState({
    person_name: '',
    amount: '',
    date: businessToday,
    category: 'other',
    comment: '',
  });

  const [payForm, setPayForm] = useState({
    amount: '',
    payment_method: defaultPaymentMethod(enabledPaymentMethods),
    date: businessToday,
    comment: '',
  });

  // A new business day moves untouched form dates forward; a date the user picked is kept.
  useBusinessRollover(businessToday, (previousToday, nextToday) => {
    setAddForm((prev) => (prev.date === previousToday ? { ...prev, date: nextToday } : prev));
    setPayForm((prev) => (prev.date === previousToday ? { ...prev, date: nextToday } : prev));
  });

  // A payment method the club no longer accepts falls back to its default.
  useEffect(() => {
    setPayForm((prev) => (enabledPaymentMethods.some((method) => method === prev.payment_method)
      ? prev
      : { ...prev, payment_method: defaultPaymentMethod(enabledPaymentMethods) }));
  }, [enabledPaymentMethods]);

  // Switching clubs closes any open form and drops cached payment history of the previous club.
  useEffect(() => {
    paymentsRequestSequence.current += 1;
    setAddOpen(false);
    setPayDebtId(null);
    setPayments([]);
    setPaymentsLoading(false);
    setPaymentsError('');
    setFormClubId(null);
    setError('');
  }, [selectedClubId]);

  const loadDebts = useCallback(async (isCurrent: () => boolean) => {
    if (!selectedClubId) return [];
    try {
      const supabase = createClient();
      // Every debt counts toward the totals, so read past the 1,000-row response cap.
      const { data, error: fetchError } = await fetchAllRows<NewDebt>(() => supabase
        .from('new_debts')
        .select(DEBT_COLUMNS)
        .eq('club_id', selectedClubId)
        .order('date', { ascending: false })
        .order('id'));
      if (fetchError) throw fetchError;
      return data ?? [];
    } catch (fetchError) {
      if (isCurrent()) console.error('Failed to load debts', fetchError);
      throw fetchError;
    }
  }, [selectedClubId]);
  const { data: debts, loading, error: loadError, reload: reloadDebts } = useClubQuery<NewDebt[]>(loadDebts, []);

  async function loadPayments(debtId: string, clubId: string) {
    const requestId = ++paymentsRequestSequence.current;
    setPaymentsLoading(true);
    setPaymentsError('');

    try {
      const supabase = createClient();
      const { data, error: fetchError } = await fetchAllRows<DebtPayment>(() => supabase
        .from('debt_payments')
        .select(DEBT_PAYMENT_COLUMNS)
        .eq('club_id', clubId)
        .eq('debt_id', debtId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id'));
      if (requestId !== paymentsRequestSequence.current) return;
      if (fetchError) {
        console.error('Failed to load debt payments', fetchError);
        setPaymentsError(t('paymentsLoadError'));
        return;
      }
      setPayments(data ?? []);
    } catch (fetchError) {
      if (requestId !== paymentsRequestSequence.current) return;
      console.error('Failed to load debt payments', fetchError);
      setPaymentsError(t('paymentsLoadError'));
    } finally {
      if (requestId === paymentsRequestSequence.current) setPaymentsLoading(false);
    }
  }

  function openPayModal(debtId: string) {
    if (!selectedClubId) return;
    setPayDebtId(debtId);
    setFormClubId(selectedClubId);
    setPayForm({ amount: '', payment_method: defaultPaymentMethod(enabledPaymentMethods), date: businessToday, comment: '' });
    setError('');
    // Never show the previously opened debt's history while this one loads.
    setPayments([]);
    void loadPayments(debtId, selectedClubId);
  }

  function closePayModal() {
    paymentsRequestSequence.current += 1;
    setPaymentsLoading(false);
    setPayDebtId(null);
  }

  function openAddDebtModal(personName = '') {
    setAddForm({
      person_name: personName,
      amount: '',
      date: businessToday,
      category: 'other',
      comment: '',
    });
    setError('');
    setFormClubId(selectedClubId || null);
    setAddOpen(true);
  }

  async function handleAddDebt(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseCurrencyInput(addForm.amount);
    if (!selectedClubId) { setError(tc('error')); return; }
    if (formClubId !== selectedClubId) { setError(t('clubChanged')); return; }
    if (!amount || amount <= 0) { setError(tc('invalidAmount')); return; }
    if (!addForm.person_name.trim()) { setError(tc('required')); return; }
    const dateIssue = getDebtDateIssue({ date: addForm.date, businessDate: businessToday });
    if (dateIssue) { setError(dateIssue === 'future' ? t('futureDateError') : tc('error')); return; }
    setSaving(true);
    setError('');

    try {
      const supabase = createClient();
      // Verified with the auth server; migration 075 also defaults and checks this column.
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error('Failed to verify the signed-in user', userError);
        setError(t('saveError'));
        return;
      }

      const { error: err } = await supabase.from('new_debts').insert({
        club_id: selectedClubId,
        person_name: addForm.person_name.trim(),
        amount,
        remaining_amount: amount,
        date: addForm.date,
        category: addForm.category,
        comment: addForm.comment.trim() || null,
        status: 'unpaid',
        created_by: user.id,
      });

      if (err) {
        console.error('Failed to save debt', err);
        setError(t('saveError'));
        return;
      }

      setAddOpen(false);
      showToast(t('debtSaved'));
      await reloadDebts({ silent: true });
    } catch (saveError) {
      console.error('Failed to save debt', saveError);
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payDebtId) return;
    const amount = parseCurrencyInput(payForm.amount);
    if (!selectedClubId) { setError(tc('error')); return; }
    if (formClubId !== selectedClubId) { setError(t('clubChanged')); return; }
    if (!amount || amount <= 0) { setError(tc('invalidAmount')); return; }
    const debt = debts.find((row) => row.id === payDebtId);
    if (!debt) { setError(tc('error')); return; }
    const dateIssue = getDebtDateIssue({
      date: payForm.date,
      businessDate: businessToday,
      debtDate: debt.date,
    });
    if (dateIssue) {
      setError(
        dateIssue === 'future'
          ? t('futureDateError')
          : dateIssue === 'before_debt'
            ? t('paymentBeforeDebtDate')
            : tc('error'),
      );
      return;
    }
    const paymentValidation = validateDebtPayment({
      paymentAmount: amount,
      remainingDebt: remainingFor(debt),
    });
    if (!paymentValidation.valid) { setError(t('paymentExceedsRemaining')); return; }
    setSaving(true);
    setError('');

    try {
      const supabase = createClient();
      const { error: err } = await supabase.from('debt_payments').insert({
        club_id: selectedClubId,
        debt_id: payDebtId,
        amount,
        payment_method: payForm.payment_method,
        date: payForm.date,
        comment: payForm.comment.trim() || null,
      });

      if (err) {
        console.error('Failed to save debt payment', err);
        const issue = classifyDebtPaymentInsertError(err);
        setError(
          issue === 'exceeds_remaining'
            ? t('paymentExceedsRemaining')
            : issue === 'before_debt_date'
              ? t('paymentBeforeDebtDate')
              : issue === 'future_date'
                ? t('futureDateError')
                : t('saveError'),
        );
        // Another payment may have landed first: show the current balance and history.
        if (issue === 'exceeds_remaining') {
          void loadPayments(payDebtId, selectedClubId);
          await reloadDebts({ silent: true });
        }
        return;
      }

      closePayModal();
      showToast(t('paymentSaved'));
      await reloadDebts({ silent: true });
    } catch (saveError) {
      console.error('Failed to save debt payment', saveError);
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  const activeDebt = payDebtId ? debts.find((d) => d.id === payDebtId) : null;
  const unpaid = debts.filter((d) => d.status !== 'paid');
  const paid = debts.filter((d) => d.status === 'paid');
  const outstandingTotal = unpaid.reduce((sum, debt) => sum + remainingFor(debt), 0);
  const debtorCount = new Set(unpaid.map((debt) => debt.person_name.trim().toLocaleLowerCase())).size;
  const paidTotal = debts.reduce((sum, debt) => sum + (Number(debt.paid_amount) || 0), 0);
  const activePayments = payDebtId ? payments : [];
  const paymentMethodOptions = enabledPaymentMethods.map((method) => ({
    value: method,
    label: tc(`paymentMethods.${method}`),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        action={canManage ? (
          <Button onClick={() => openAddDebtModal()} icon={<Plus size={16} aria-hidden="true" />}>
            {t('addDebt')}
          </Button>
        ) : undefined}
      />

      {loading ? (
        <DetailListSkeleton rows={7} />
      ) : loadError ? (
        <LoadErrorAlert retrying={loading} onRetry={() => void reloadDebts()}>
          {t('loadError')}
        </LoadErrorAlert>
      ) : debts.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title={tc('noData')}
            action={canManage ? (
              <Button onClick={() => openAddDebtModal()} icon={<Plus size={16} aria-hidden="true" />}>{t('addDebt')}</Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard
              label={t('outstandingTotal')}
              value={<MetricMoney amount={outstandingTotal} />}
              tone={outstandingTotal > 0 ? 'danger' : 'default'}
            />
            <MetricCard label={t('debtorsCount')} value={formatNumber(debtorCount)} />
            <MetricCard label={t('paidTotal')} value={<MetricMoney amount={paidTotal} />} />
          </section>

          {unpaid.length > 0 && (
            <Card as="section" padding="none" className="overflow-hidden">
              <CardHeader>
                <SectionHeading
                  size="sm"
                  title={t('outstanding')}
                  badge={<Badge variant="neutral" size="sm">{unpaid.length}</Badge>}
                />
              </CardHeader>
              <ul className="divide-y divide-gray-100">
                {unpaid.map((debt) => {
                  const remaining = remainingFor(debt);
                  const status = getDebtStatus(debt.amount, debt.paid_amount);
                  return (
                    <li key={debt.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar name={debt.person_name} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="break-words font-semibold text-gray-900">{debt.person_name}</p>
                            <Badge variant={statusVariant(status)} size="sm">{t(status)}</Badge>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-gray-500" title={debt.comment ?? undefined}>
                            {formatDate(debt.date, locale)}
                            {debt.comment ? ` · ${debt.comment}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <div className="text-right">
                          <p className={cn('font-semibold tabular-nums', remaining > 0 ? 'text-danger-600' : 'text-gray-900')}>
                            <Money amount={remaining} />
                          </p>
                          {debt.paid_amount > 0 && (
                            <p className="mt-0.5 text-xs text-gray-500">
                              {t('paidAmount')}: {formatCurrency(debt.paid_amount)} / {formatCurrency(debt.amount)}
                            </p>
                          )}
                        </div>
                        {canManage && (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button size="sm" onClick={() => openPayModal(debt.id)} icon={<Wallet size={14} aria-hidden="true" />}>
                              {t('acceptPayment')}
                            </Button>
                            <IconButton
                              variant="ghost"
                              size="sm"
                              label={`${t('addDebt')} · ${debt.person_name}`}
                              icon={<Plus size={16} aria-hidden="true" />}
                              onClick={() => openAddDebtModal(debt.person_name)}
                            />
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {paid.length > 0 && (
            <Card as="section" padding="none" className="overflow-hidden">
              <CardHeader>
                <SectionHeading
                  size="sm"
                  title={t('paid')}
                  badge={<Badge variant="neutral" size="sm">{paid.length}</Badge>}
                  action={(
                    <Button variant="ghost" size="sm" aria-expanded={showPaid} onClick={() => setShowPaid((value) => !value)}>
                      {showPaid ? t('hidePaid') : t('showPaid')}
                    </Button>
                  )}
                />
              </CardHeader>
              {showPaid && (
                <ul className="divide-y divide-gray-100">
                  {paid.map((debt) => (
                    <li key={debt.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                      <Avatar name={debt.person_name} size="sm" tone="neutral" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-700">{debt.person_name}</p>
                        <p className="text-xs text-gray-500">{formatDate(debt.date, locale)}</p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums text-gray-500"><Money amount={debt.amount} /></span>
                      <Badge variant="success" size="sm">{t('paid')}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t('addDebt')}
        locked={saving}
        footer={(
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>{tc('cancel')}</Button>
            <Button type="submit" form="add-debt-form" loading={saving} loadingLabel={tc('saving')}>{tc('save')}</Button>
          </>
        )}
      >
        <form id="add-debt-form" onSubmit={handleAddDebt} className="space-y-4">
          <Field label={t('personName')} htmlFor="debt-person" required>
            <Input
              id="debt-person"
              type="text"
              maxLength={120}
              value={addForm.person_name}
              onChange={(e) => setAddForm((p) => ({ ...p, person_name: e.target.value }))}
              required
            />
          </Field>
          <Field label={t('amount')} htmlFor="debt-amount" required>
            <CurrencyInput
              id="debt-amount"
              value={addForm.amount}
              onValueChange={(value) => setAddForm((p) => ({ ...p, amount: value }))}
              trailingAddon={tc('currency')}
              required
            />
          </Field>
          <Field label={t('date')}>
            <DatePicker
              ariaLabel={t('date')}
              value={addForm.date}
              onChange={(value) => setAddForm((previous) => ({ ...previous, date: value }))}
              max={businessToday}
            />
          </Field>
          <Field label={t('comment')} htmlFor="debt-comment">
            <Input
              id="debt-comment"
              type="text"
              maxLength={250}
              value={addForm.comment}
              onChange={(e) => setAddForm((p) => ({ ...p, comment: e.target.value }))}
            />
          </Field>
          {error && <InlineAlert variant="danger">{error}</InlineAlert>}
        </form>
      </Modal>

      <Modal
        open={Boolean(payDebtId && activeDebt)}
        onClose={closePayModal}
        title={t('partialPayment')}
        locked={saving}
        footer={(
          <>
            <Button variant="outline" onClick={closePayModal} disabled={saving}>{tc('cancel')}</Button>
            <Button type="submit" form="add-payment-form" loading={saving} loadingLabel={tc('saving')}>{tc('save')}</Button>
          </>
        )}
      >
        {activeDebt && payDebtId && (
          <form id="add-payment-form" onSubmit={handleAddPayment} className="space-y-4">
            <Card tone="muted" padding="sm">
              <p className="font-semibold text-gray-800">{activeDebt.person_name}</p>
              <p className="text-sm text-gray-500">
                {t('remaining')}: <Money amount={remainingFor(activeDebt)} className="font-semibold text-gray-900" />
              </p>
            </Card>

            {paymentsLoading ? (
              <div role="status" aria-label={t('paymentsLoading')} className="space-y-2">
                <Skeleton className="h-3 w-32 bg-gray-100" />
                <Skeleton className="h-9 w-full rounded-lg bg-gray-100" />
              </div>
            ) : paymentsError ? (
              <LoadErrorAlert
                retrying={paymentsLoading}
                onRetry={() => {
                  if (formClubId) void loadPayments(payDebtId, formClubId);
                }}
              >
                {paymentsError}
              </LoadErrorAlert>
            ) : activePayments.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">{t('debtPayments')}</p>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {activePayments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-gray-600">
                      <span>{formatDate(p.date, locale)} · {tc.has(`paymentMethods.${p.payment_method}`) ? tc(`paymentMethods.${p.payment_method as EntryPaymentMethod}`) : p.payment_method}</span>
                      <span className="font-medium text-success-600">+<Money amount={p.amount} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Field label={t('amount')} htmlFor="payment-amount" required>
              <CurrencyInput
                id="payment-amount"
                value={payForm.amount}
                onValueChange={(value) => setPayForm((p) => ({ ...p, amount: value }))}
                trailingAddon={tc('currency')}
                required
                autoFocus
              />
            </Field>
            <Field label={t('paymentMethod')}>
              <SegmentedControl
                label={t('paymentMethod')}
                options={paymentMethodOptions}
                value={payForm.payment_method}
                onChange={(method) => setPayForm((p) => ({ ...p, payment_method: method }))}
              />
            </Field>
            <Field label={t('date')}>
              <DatePicker
                ariaLabel={t('date')}
                value={payForm.date}
                onChange={(value) => setPayForm((previous) => ({ ...previous, date: value }))}
                min={activeDebt.date}
                max={businessToday}
              />
            </Field>
            <Field label={t('comment')} htmlFor="payment-comment">
              <Input
                id="payment-comment"
                type="text"
                maxLength={250}
                value={payForm.comment}
                onChange={(e) => setPayForm((p) => ({ ...p, comment: e.target.value }))}
              />
            </Field>
            {error && <InlineAlert variant="danger">{error}</InlineAlert>}
          </form>
        )}
      </Modal>

      {toastElement}
    </div>
  );
}
