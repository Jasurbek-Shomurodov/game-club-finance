'use client';

// Route: /daily-cash

import { useCallback, useEffect, useMemo, useRef, useState, type ElementType, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Banknote,
  Clock3,
  CreditCard,
  Gamepad2,
  ReceiptText,
  MonitorSmartphone,
  RotateCw,
  Save,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { calculateFinancialReportTotals } from '@/lib/calculations/dailyReport';
import { canAccessFeature, canReadFinancialTotals } from '@/lib/permissions';
import ExpenseRegistrationForm from '../reports/ExpensesPanel';
import { loadDailyCashSummary, emptyDailyCashSummary, type DailyCashSummary } from '@/lib/supabase/dailyCashSummary';
import { calculateGameClubIncome } from '@/lib/calculations/dailyCash';
import { canEditEntryForRole, getEditDeadline } from '@/lib/time/editWindow';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CurrencyInput,
  DatePicker,
  Field,
  FormSkeleton,
  InlineAlert,
  MetricGridSkeleton,
  Modal,
  Money,
  PageHeader,
  SectionHeading,
  StatTile,
  Textarea,
  toneForAmount,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { todayIso } from '@/lib/utils';
import { formatCurrency, formatCurrencyInput, formatDateOnly, formatDateTime, parseCurrencyInput } from '@/lib/formatters';
import type { DailyCashEntry } from '@/types';

interface CashFormData {
  date: string;
  cash_income: string;
  terminal_income: string;
  card_income: string;
  playstation_income: string;
  comment: string;
}

const emptyForm = (date = todayIso()): CashFormData => ({
  date,
  cash_income: '',
  terminal_income: '',
  card_income: '',
  playstation_income: '',
  comment: '',
});

function parseAmount(value: string): number {
  const parsed = parseCurrencyInput(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function amountToInput(value: number | null | undefined): string {
  return value && value > 0 ? formatCurrencyInput(value) : '';
}

const savedBreakdownGrid: Record<number, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
};

function formatRemaining(ms: number): string {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function entryToForm(entry: DailyCashEntry): CashFormData {
  return {
    date: entry.date,
    cash_income: amountToInput(entry.cash_income),
    terminal_income: amountToInput(entry.terminal_income),
    card_income: amountToInput(entry.card_income),
    playstation_income: amountToInput(entry.playstation_income),
    comment: entry.comment ?? '',
  };
}

interface PaymentFieldProps {
  id: string;
  label: string;
  value: string;
  icon: ElementType;
  currency: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function PaymentField({ id, label, value, icon: Icon, currency, disabled, onChange }: PaymentFieldProps) {
  return (
    <Field
      htmlFor={id}
      label={(
        <span className="inline-flex items-center gap-1.5">
          <Icon size={15} className="text-gray-400" aria-hidden="true" />
          {label}
        </span>
      )}
    >
      <CurrencyInput id={id} className="font-semibold" value={value} disabled={disabled} onValueChange={onChange} trailingAddon={currency} />
    </Field>
  );
}

export default function DailyCashPage() {
  const t = useTranslations('dailyCash');
  const tc = useTranslations('common');
  const tr = useTranslations('reports');
  const { selectedClubId, role: currentRole, businessDayStartHour, enabledPaymentMethods, featureAccess } = useClub();
  const { locale } = useAppLocale();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const businessToday = useMemo(() => todayIso(new Date(), businessDayStartHour), [businessDayStartHour]);
  const [form, setForm] = useState<CashFormData>(() => emptyForm(businessToday));
  const [entry, setEntry] = useState<DailyCashEntry | null>(null);
  const [createdByName, setCreatedByName] = useState('');
  const [loading, setLoading] = useState(true);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [financeSummary, setFinanceSummary] = useState<DailyCashSummary | null>(null);
  const canSeeNetProfit = canReadFinancialTotals(currentRole, featureAccess);
  const loadSequence = useRef(0);
  // An expense form filled in for one club must never be saved into another.
  useEffect(() => { setExpenseDialogOpen(false); }, [selectedClubId]);
  const cancelLoads = useCallback(() => { loadSequence.current++; }, []);
  const isOwner = currentRole === 'owner';
  // Guards against double submit (state updates land a render later) and lets
  // an in-flight save notice that the user switched clubs meanwhile.
  const mutationPending = useRef(false);
  const currentClubId = useRef(selectedClubId);

  useEffect(() => {
    currentClubId.current = selectedClubId;
    setForm(emptyForm(businessToday));
    setError('');
  }, [businessToday, selectedClubId]);

  const fetchExisting = useCallback(
    async (date: string, { silent = false } = {}) => {
      const requestId = ++loadSequence.current;
      if (!selectedClubId) {
        setEntry(null);
        setForm(emptyForm(date));
        setFinanceSummary(null);
        setLoading(false);
        return;
      }

      const supabase = createClient();
      if (!silent) setLoading(true);
      setError('');
      setLoadFailed(false);

      try {
        const [cashRes, summary] = await Promise.all([
          supabase
            .from('daily_cash_entries')
            .select('*')
            .eq('club_id', selectedClubId)
            .eq('date', date)
            .maybeSingle(),
          loadDailyCashSummary(supabase, selectedClubId, date, canSeeNetProfit),
        ]);

        if (requestId !== loadSequence.current) return;
        const { data, error: fetchError } = cashRes;

        if (fetchError) {
          setLoadFailed(true);
          setEntry(null);
          setForm(emptyForm(date));
          setFinanceSummary(null);
          setLoading(false);
          return;
        }

        setFinanceSummary(summary);

        const cashEntry = data as DailyCashEntry | null;
        setEntry(cashEntry);
        setForm(cashEntry ? entryToForm(cashEntry) : emptyForm(date));

        if (cashEntry?.created_by) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', cashEntry.created_by)
            .maybeSingle();
          if (requestId !== loadSequence.current) return;
          setCreatedByName(profile?.full_name ?? '');
        } else {
          setCreatedByName('');
        }

        setLoading(false);
      } catch {
        if (requestId !== loadSequence.current) return;
        setLoadFailed(true);
        setEntry(null);
        setFinanceSummary(null);
        setLoading(false);
      }
    },
    [selectedClubId, canSeeNetProfit],
  );

  useEffect(() => {
    void fetchExisting(form.date);
    return cancelLoads;
  }, [form.date, fetchExisting, cancelLoads]);

  // The countdown is only shown to non-owners with a saved entry.
  const showCountdown = Boolean(entry) && !isOwner;
  useEffect(() => {
    if (!showCountdown) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [showCountdown]);

  function setField(field: keyof CashFormData, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  }

  const values = useMemo(
    () => ({
      cashIncome: parseAmount(form.cash_income),
      terminalIncome: parseAmount(form.terminal_income),
      cardIncome: parseAmount(form.card_income),
      playstationIncome: parseAmount(form.playstation_income),
    }),
    [form.cash_income, form.terminal_income, form.card_income, form.playstation_income],
  );

  const total = calculateGameClubIncome(values);
  const totals = calculateFinancialReportTotals({ ...(financeSummary ?? emptyDailyCashSummary), manualIncome: total });
  const barSummary = { sales: totals.barSales, profit: totals.barSales - totals.barCost };
  const netProfit = totals.accountingNetProfit;
  const editable = entry ? canEditEntryForRole(currentRole, entry.created_at, now) : true;
  const locked = Boolean(entry && !editable);
  const deadline = entry ? getEditDeadline(entry.created_at) : null;
  const remainingMs = deadline ? deadline.getTime() - now.getTime() : 0;
  const disabled = loading || saving || locked || loadFailed;
  const isDirty = entry ? JSON.stringify(entryToForm(entry)) !== JSON.stringify(form) : Boolean(
    form.cash_income || form.terminal_income || form.card_income || form.playstation_income || form.comment,
  );

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (mutationPending.current || saving || loadFailed) return;

    if (locked) {
      setError(t('entryLocked'));
      return;
    }

    if (!selectedClubId) {
      setError(tc('error'));
      return;
    }

    if (form.date > businessToday) {
      setError(t('futureDateError'));
      return;
    }

    const clubId = selectedClubId;
    const date = form.date;
    mutationPending.current = true;
    setSaving(true);
    setError('');

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const payload = {
        date,
        club_id: clubId,
        cash_income: values.cashIncome,
        terminal_income: values.terminalIncome,
        card_income: values.cardIncome,
        playstation_income: values.playstationIncome,
        comment: form.comment.trim() ? form.comment.trim() : null,
        updated_at: new Date().toISOString(),
      };

      const result = entry
        ? await supabase.from('daily_cash_entries').update(payload).eq('id', entry.id).eq('club_id', clubId).select('id')
        : await supabase.from('daily_cash_entries').insert({
            ...payload,
            created_by: session?.user?.id ?? null,
          });

      // The user switched clubs while saving: the write went to the club it was
      // made for; do not paint its result over the newly selected club.
      if (currentClubId.current !== clubId) return;

      if (result.error) {
        setError(result.error.code === '23505' ? t('duplicateEntryError') : t('saveError'));
        return;
      }
      if (entry && (result.data ?? []).length === 0) {
        // RLS filtered the update out (edit window closed or no permission).
        setError(t('entryLocked'));
        await fetchExisting(date, { silent: true });
        return;
      }

      showToast(entry ? t('entryUpdated') : t('entrySaved'));
      await fetchExisting(date, { silent: true });
    } catch {
      if (currentClubId.current === clubId) setError(t('saveError'));
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry || !isOwner || !selectedClubId || mutationPending.current) return;
    const clubId = selectedClubId;
    const target = entry;
    const confirmed = await confirm({
      title: tc('delete'),
      description: t('deleteConfirmDetailed', {
        date: formatDateOnly(target.date, locale),
        amount: `${formatCurrency(calculateGameClubIncome({
          cashIncome: target.cash_income,
          terminalIncome: target.terminal_income,
          cardIncome: target.card_income,
          playstationIncome: target.playstation_income ?? 0,
        }))} ${tc('currency')}`,
      }),
      confirmLabel: tc('delete'),
    });
    // The dialog can stay open across a club switch; never act on a stale entry.
    if (!confirmed || currentClubId.current !== clubId || mutationPending.current) return;

    mutationPending.current = true;
    setSaving(true);
    setError('');

    try {
      const supabase = createClient();
      const { data: deletedRows, error: deleteError } = await supabase
        .from('daily_cash_entries')
        .delete()
        .eq('club_id', clubId)
        .eq('id', target.id)
        .select('id');

      if (currentClubId.current !== clubId) return;

      if (deleteError || (deletedRows ?? []).length === 0) {
        setError(t('deleteError'));
        return;
      }

      showToast(t('entryDeleted'));
      setEntry(null);
      setForm(emptyForm(target.date));
      await fetchExisting(target.date, { silent: true });
    } catch {
      if (currentClubId.current === clubId) setError(t('deleteError'));
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  }

  function handleReset() {
    setError('');
    setForm(entry ? entryToForm(entry) : emptyForm(form.date));
  }

  const header = (
    <PageHeader
      title={t('title')}
      action={(
        <div className="flex flex-wrap gap-2">
          {canAccessFeature(currentRole, featureAccess, 'expenses') && (
            <Button variant="outline" onClick={() => setExpenseDialogOpen(true)} icon={<ReceiptText size={18} aria-hidden="true" />}>
              {tr('registerExpense')}
            </Button>
          )}
          <ButtonLink href="/reports" iconRight={<TrendingUp size={16} className="text-primary-600" aria-hidden="true" />}>
            {t('reports')}
          </ButtonLink>
        </div>
      )}
    />
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {header}
        <FormSkeleton />
        <MetricGridSkeleton count={3} className="xl:grid-cols-3" />
      </div>
    );
  }

  const paymentCards: Array<{ key: 'cash_income' | 'terminal_income' | 'card_income' | 'playstation_income'; label: string; icon: ElementType; visible: boolean }> = [
    { key: 'cash_income', label: t('cash'), icon: Banknote, visible: enabledPaymentMethods.includes('cash') },
    { key: 'terminal_income', label: t('terminal'), icon: MonitorSmartphone, visible: enabledPaymentMethods.includes('terminal') },
    { key: 'card_income', label: t('card'), icon: CreditCard, visible: enabledPaymentMethods.includes('card') },
    { key: 'playstation_income', label: t('playstation'), icon: Gamepad2, visible: true },
  ];

  const savedBreakdown = entry
    ? [
        { label: t('cash'), amount: entry.cash_income, visible: enabledPaymentMethods.includes('cash') || entry.cash_income > 0 },
        { label: t('terminal'), amount: entry.terminal_income, visible: enabledPaymentMethods.includes('terminal') || entry.terminal_income > 0 },
        { label: t('card'), amount: entry.card_income, visible: enabledPaymentMethods.includes('card') || entry.card_income > 0 },
        { label: t('playstation'), amount: entry.playstation_income ?? 0, visible: true },
      ].filter((item) => item.visible)
    : [];

  return (
    <div className="space-y-4">
      {header}

      {loadFailed && (
        <InlineAlert
          variant="danger"
          action={(
            <Button size="sm" variant="outline" onClick={() => void fetchExisting(form.date)} icon={<RotateCw size={15} aria-hidden="true" />}>
              {tc('retry')}
            </Button>
          )}
        >
          {t('loadError')}
        </InlineAlert>
      )}

      <Card as="form" onSubmit={handleSave} aria-busy={saving || undefined}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-600">{t('date')}</span>
            <div className="w-full max-w-[220px]">
              <DatePicker
                ariaLabel={t('date')}
                value={form.date}
                max={businessToday}
                onChange={(value) => setField('date', value)}
              />
            </div>
          </div>

          {entry && deadline && editable && (
            <Badge variant="success" icon={<Clock3 size={15} aria-hidden="true" />} className="self-start px-3 py-2 text-sm sm:self-center">
              {isOwner ? t('ownerAccessEdit') : (
                <>
                  {t('editUntil', { time: formatDateTime(deadline, locale) })}
                  <span className="ml-1 rounded-full bg-surface/70 px-2 py-0.5 tabular-nums">{formatRemaining(remainingMs)}</span>
                </>
              )}
            </Badge>
          )}
        </div>

        {locked && (
          <InlineAlert variant="warning" className="mt-4">{t('entryLocked')}</InlineAlert>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {paymentCards.filter((card) => card.visible).map((card) => (
            <PaymentField
              key={card.key}
              id={`daily-cash-${card.key}`}
              label={card.label}
              value={form[card.key]}
              disabled={disabled}
              onChange={(value) => setField(card.key, value)}
              icon={card.icon}
              currency={tc('currency')}
            />
          ))}
        </div>

        <div className="mt-6" aria-live="polite">
          <p className="text-sm font-medium text-gray-500">{t('totalGameClubIncome')}</p>
          <p className="mt-1 break-words text-3xl font-bold tracking-tight tabular-nums text-gray-950">
            <Money amount={total} currencyClassName="text-sm font-medium text-gray-500" />
          </p>
        </div>

        <Card tone="muted" padding="sm" className="mt-3">
          <div className={`grid grid-cols-1 divide-y divide-gray-200 sm:divide-x sm:divide-y-0 ${canSeeNetProfit ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            <StatTile variant="flat" size="sm" className="py-2 sm:pr-4 sm:py-0" label={t('barSales')} value={formatCurrency(barSummary.sales)} unit={tc('currency')} />
            <StatTile variant="flat" size="sm" className="py-2 sm:px-4 sm:py-0" label={t('barProfit')} value={formatCurrency(barSummary.profit)} unit={tc('currency')} tone={toneForAmount(barSummary.profit)} />
            {canSeeNetProfit && financeSummary && (
              <StatTile variant="flat" size="sm" className="py-2 sm:px-4 sm:py-0" label={t('netProfit')} value={formatCurrency(netProfit)} unit={tc('currency')} tone={toneForAmount(netProfit)} />
            )}
          </div>
        </Card>

        <Field label={t('commentOptional')} htmlFor="daily-cash-comment" className="mt-6">
          <Textarea
            id="daily-cash-comment"
            maxLength={300}
            showCount
            placeholder={t('commentPlaceholder')}
            value={form.comment}
            disabled={disabled}
            onChange={(event) => setField('comment', event.target.value)}
          />
        </Field>

        {error && <InlineAlert variant="danger" className="mt-4">{error}</InlineAlert>}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" disabled={saving || loadFailed || !isDirty} onClick={handleReset}>
            {t('reset')}
          </Button>
          <Button type="submit" size="lg" disabled={disabled} loading={saving} loadingLabel={tc('saving')} icon={<Save size={18} aria-hidden="true" />}>
            {t('saveEntry')}
          </Button>
        </div>
      </Card>

      {entry && (
        <Card as="section" padding="lg">
          <SectionHeading
            size="lg"
            title={t('todayEntry')}
            badge={<Badge variant="success">{t('savedBadge')}</Badge>}
            action={editable && isOwner ? (
              <Button variant="dangerOutline" size="sm" disabled={saving} onClick={handleDelete} icon={<Trash2 size={15} aria-hidden="true" />}>
                {tc('delete')}
              </Button>
            ) : undefined}
          />

          <div className={`mt-4 grid grid-cols-2 gap-3 ${savedBreakdownGrid[Math.min(savedBreakdown.length + 1, 5)]}`}>
            {savedBreakdown.map((item) => (
              <StatTile key={item.label} label={item.label} value={formatCurrency(item.amount)} unit={tc('currency')} variant="soft" size="sm" />
            ))}
            <StatTile
              label={t('total')}
              tone="success"
              variant="soft"
              size="sm"
              unit={tc('currency')}
              value={formatCurrency(calculateGameClubIncome({
                cashIncome: entry.cash_income,
                terminalIncome: entry.terminal_income,
                cardIncome: entry.card_income,
                playstationIncome: entry.playstation_income ?? 0,
              }))}
            />
          </div>

          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
            <span>{t('createdLabel')} {formatDateTime(entry.created_at, locale)}</span>
            {createdByName && <span>{t('byLabel')} {createdByName}</span>}
          </div>

          <InlineAlert variant={editable ? 'warning' : 'info'} title={t('editWindowTitle')} className="mt-4">
            {editable
              ? isOwner
                ? t('ownerEditNote')
                : t('adminEditNote', { remaining: formatRemaining(remainingMs) })
              : t('entryLocked')}
          </InlineAlert>
        </Card>
      )}

      <Modal
        open={expenseDialogOpen}
        onClose={() => setExpenseDialogOpen(false)}
        title={tr('registerExpense')}
        size="xl"
      >
        <ExpenseRegistrationForm
          onSaved={() => {
            setExpenseDialogOpen(false);
            showToast(tr('expenseRegistered'));
          }}
        />
      </Modal>

      {toastElement}
      {confirmDialog}
    </div>
  );
}
