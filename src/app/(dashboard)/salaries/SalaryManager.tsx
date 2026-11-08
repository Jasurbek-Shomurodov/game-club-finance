'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, Building2, CalendarCheck, Gift, Percent, ShieldAlert, Users, Wallet } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Badge,
  Card,
  ConfirmDialog,
  DatePicker,
  Disclosure,
  EmptyState,
  Field,
  InlineAlert,
  LoadErrorAlert,
  MetricCard,
  MetricGridSkeleton,
  MetricMoney,
  PageHeader,
  SegmentedControl,
  Textarea,
  useConfirm,
  useToast,
  type SegmentedOption,
} from '@/components/PresentationFoundation';
import { loadSalaries, loadSalaryEntries } from '@/lib/supabase/salaries';
import {
  applySalaryPaymentChanges,
  calculateSalaries,
  combineSalaryMonths,
  deactivatedFrom,
  deactivationCancelsRates,
  displayedRate,
  earliestDeactivationDate,
  employeeStatus,
  maxSalaryPayment,
  rateInForce,
  salaryBalance,
  salaryEarnings,
  salaryPaymentsBySource,
  scheduledDeactivation,
  type KpiBasis,
  type SalaryEmployee,
} from '@/lib/calculations/salaries';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatCurrency, formatCurrencyInput, formatDateOnly, parseCurrencyInput } from '@/lib/formatters';
import { defaultPaymentMethod } from '@/lib/paymentMethods';
import { canAccessFeature } from '@/lib/permissions';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessRollover } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { mergeUntouchedFields } from '@/lib/formMerge';
import { EmployeeEditDialog, employeeEditChanges, employeeEditState, withLandedEmployeeChange, type EmployeeEditState } from './EmployeeEditDialog';
import { EmployeesView } from './EmployeesView';
import { HistoryView } from './HistoryView';
import { OperationsForms, type EmployeeFormState, type EntryFormState, type FormDialog } from './OperationsForms';
import {
  knownEmployeeRole,
  postSalary,
  useSalaryText,
  type DeletionTarget,
  type EmployeeRateSummary,
  type EntryKind,
  type SalaryView,
  type SavingTarget,
  type SetupMode,
} from './shared';

const emptyData: Awaited<ReturnType<typeof loadSalaries>> = { employees: [], rates: [], entries: [], deleterNames: {}, monthlyProfit: [] };

const VIEW_PATHS: Record<SalaryView, string> = { employees: '/salaries/employees', operations: '/salaries/operations', history: '/salaries/history' };

export default function SalariesPage({ view = 'employees', employeeId }: { view?: SalaryView; employeeId?: string }) {
  const t = useTranslations('salaries');
  const { selectedClubId, loading: clubLoading } = useClub();
  if (!selectedClubId) {
    if (clubLoading) return <MetricGridSkeleton count={3} className="sm:grid-cols-3" />;
    return <Card><EmptyState icon={Building2} title={t('noClubTitle')} description={t('noClubDescription')} /></Card>;
  }
  // Each /salaries route is its own page, so switching views remounts anyway;
  // the key additionally resets all local state when the club changes.
  return <SalaryManager key={`${selectedClubId}:${view}:${employeeId ?? ''}`} clubId={selectedClubId} view={view} employeeId={employeeId} />;
}

function SalaryManager({ clubId, view: initialView, employeeId }: { clubId: string; view: SalaryView; employeeId?: string }) {
  const t = useTranslations('salaries');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  // The route decides the initial view; the segmented control switches views
  // in place so the loaded data is reused instead of refetched.
  const [view, setView] = useState<SalaryView>(initialView);
  const { businessDayStartHour, enabledPaymentMethods, role, featureAccess } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { writeErrorMessage } = useSalaryText();
  // Salary editors record payments, bonuses and fines; only owners change employees, salary, KPI or activation, or delete records.
  const canEdit = canAccessFeature(role, featureAccess, 'salaries');
  const isOwner = role === 'owner';
  const today = useBusinessToday(businessDayStartHour);
  const [deletion, setDeletion] = useState<DeletionTarget | null>(null);
  const [employeeEdit, setEmployeeEdit] = useState<EmployeeEditState | null>(null);
  const [deactivation, setDeactivation] = useState<{ employee: SalaryEmployee; date: string; earliest: string } | null>(null);
  const [deactivationError, setDeactivationError] = useState('');
  const [editError, setEditError] = useState('');
  const [savingTarget, setSavingTarget] = useState<SavingTarget | null>(null);
  const saving = savingTarget !== null;
  const [entryError, setEntryError] = useState('');
  const [employeeError, setEmployeeError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [setupMode, setSetupMode] = useState<SetupMode>('new');
  const [entrySelected, setEntrySelected] = useState<SalaryEmployee | null>(null);
  const [selectedEmployee, setSelected] = useState<SalaryEmployee | null>(null);
  const [employeeForm, setEmployeeForm] = useState<EmployeeFormState>(() => ({ id: crypto.randomUUID(), name: '', job_title: '', date: today, salary_type: 'daily', amount: '0', kpi: '0', kpi_basis: 'overall_profit', kpi_game_club: true, kpi_bar: true, active: true }));
  const [entryForm, setEntryForm] = useState<EntryFormState>(() => ({ id: crypto.randomUUID(), kind: 'payment', amount: '', date: today, comment: '', payment_method: defaultPaymentMethod(enabledPaymentMethods), payment_source: 'game_club' }));
  const mutating = useRef(false);
  // Unsaved "new employee" draft, kept while the user looks at another setup mode.
  const newEmployeeDraft = useRef<EmployeeFormState | null>(null);
  // What the setup form was last filled with for the selected employee.
  const employeeFormBaseline = useRef<EmployeeFormState | null>(null);
  // Shared by full loads and the entries-only reload so only the latest lands.
  const generation = useRef(0);
  // The loader reads the day through a ref so a rollover does not make it a
  // new loader (which would show the skeleton and disable the forms).
  const todayRef = useRef(today);
  useEffect(() => { todayRef.current = today; }, [today]);
  const loadAll = useCallback(() => {
    generation.current += 1;
    return loadSalaries(clubId, todayRef.current);
  }, [clubId]);
  const salaries = useClubQuery(loadAll, emptyData);
  const { data, setData, loading, reload } = salaries;
  const loadError = salaries.error;
  // When the business day rolls over, dates still on the old day follow it;
  // edited dates are kept. Balances are re-read for the new day in place.
  useBusinessRollover(today, (previousDay, nextDay) => {
    setEntryForm((form) => (form.date === previousDay ? { ...form, date: nextDay } : form));
    setEmployeeForm((form) => (form.date === previousDay ? { ...form, date: nextDay } : form));
    void reload({ silent: true });
  });
  const balances = useMemo(() => calculateSalaries({ ...data, throughDate: today }), [data, today]);
  // One pass per employee instead of re-filtering every rate on each lookup.
  const summaries = useMemo(() => new Map<string, EmployeeRateSummary>(data.employees.map((employee) => {
    const display = displayedRate(data.rates, employee.id, today);
    return [employee.id, { current: rateInForce(data.rates, employee.id, today), display, status: employeeStatus(employee, display, today), deactivatesOn: scheduledDeactivation(data.rates, employee.id, today), deactivatedFrom: deactivatedFrom(data.rates, employee.id, today) }];
  })), [data.employees, data.rates, today]);
  // Hidden employees stay in `data` for the KPI calculation above, which their
  // fixed pay is part of, but leave every list, total and history.
  const employees = useMemo(() => data.employees.filter((e) => !e.deleted_at), [data.employees]);
  const shownRates = useMemo(() => { const ids = new Set(employees.map((e) => e.id)); return data.rates.filter((r) => ids.has(r.employee_id)); }, [data.rates, employees]);
  const shownEntries = useMemo(() => { const ids = new Set(employees.map((e) => e.id)); return data.entries.filter((e) => ids.has(e.employee_id)); }, [data.entries, employees]);
  const historyEmployee = employees.find((employee) => employee.id === employeeId);
  const upcomingCount = employees.filter((e) => summaries.get(e.id)?.status === 'upcoming').length;
  const activeCount = employees.filter((e) => summaries.get(e.id)?.current?.active).length;
  // Deactivated staff keep their balance on their card but stay out of the club's total due.
  const due = employees
    .filter((e) => summaries.get(e.id)?.display?.active)
    .reduce((sum, e) => sum + Math.max(0, salaryBalance(balances[e.id] ?? [])), 0);
  // Without an employee in the route, history covers the whole club.
  const historyMonths = useMemo(() => (employeeId
    ? balances[employeeId] ?? []
    : combineSalaryMonths(Object.fromEntries(employees.map((e) => [e.id, balances[e.id] ?? []])))), [balances, employeeId, employees]);
  const paidBySource = useMemo(() => salaryPaymentsBySource(data.entries, today), [data.entries, today]);
  // This business month's salary cost across the club, history view aside.
  const thisMonth = historyMonths.find((month) => month.month === today.slice(0, 7));

  // An entry changes only entries and, for payments, the linked salary expense;
  // that expense's effect on earned profit is applied locally instead of
  // reloading employees, rates and the whole profit snapshot. It merges into
  // the query's data, so it stays outside useClubQuery and shares `generation`
  // with full loads: a newer full load discards it. The write already
  // succeeded, so a failed refresh falls back to a silent full reload rather
  // than a page-level load error that would disable the forms.
  const reloadEntries = useCallback(async () => {
    const request = ++generation.current;
    try {
      const { entries, deleterNames } = await loadSalaryEntries(clubId, today);
      if (request === generation.current) {
        setData((previous) => ({ ...previous, entries, deleterNames: { ...previous.deleterNames, ...deleterNames }, monthlyProfit: applySalaryPaymentChanges(previous.monthlyProfit, previous.entries, entries) }));
      }
    } catch {
      if (request === generation.current) await reload({ silent: true });
    }
  }, [clubId, reload, setData, today]);

  const employeeFormFor = useCallback((employee: SalaryEmployee | null): EmployeeFormState => {
    const rate = employee ? summaries.get(employee.id)?.display : undefined;
    return {
      id: employee?.id ?? crypto.randomUUID(),
      name: employee?.name ?? '',
      job_title: knownEmployeeRole(employee?.job_title ?? '') ?? employee?.job_title ?? '',
      date: employee && employee.joined_on > today ? employee.joined_on : today,
      salary_type: rate?.salary_type ?? 'daily',
      amount: rate ? formatCurrencyInput(Number(rate.amount)) : '0',
      kpi: String(rate?.kpi_percent ?? 0),
      kpi_basis: (rate?.kpi_basis ?? 'overall_profit') as KpiBasis,
      kpi_game_club: rate?.kpi_game_club ?? true,
      kpi_bar: rate?.kpi_bar ?? true,
      active: rate?.active ?? true,
    };
  }, [summaries, today]);

  // The setup form outlives the tabs: a change made elsewhere (deactivating on
  // Employees, a pencil edit, a deleted rate) must reach it, or its next save
  // would write the old values back. Fields being typed in are kept.
  useEffect(() => {
    const employee = selectedEmployee && data.employees.find((row) => row.id === selectedEmployee.id);
    if (!employee) return;
    const fresh = employeeFormFor(employee);
    const baseline = employeeFormBaseline.current ?? fresh;
    employeeFormBaseline.current = fresh;
    setEmployeeForm((form) => (form.id === fresh.id ? mergeUntouchedFields(form, baseline, fresh) : form));
  }, [data.employees, employeeFormFor, selectedEmployee]);

  // Forms are rendered inline, so selecting an employee or switching a
  // segmented option never scrolls the page.
  function selectSetupEmployee(employee: SalaryEmployee | null) {
    if (savingTarget === 'employee' || !isOwner) return;
    const fresh = employeeFormFor(employee);
    employeeFormBaseline.current = fresh;
    setSelected(employee);
    setEmployeeForm(fresh);
    setEmployeeError('');
  }

  function changeSetupMode(mode: SetupMode) {
    if (savingTarget === 'employee' || !isOwner || mode === setupMode) return;
    setEmployeeError('');
    if (setupMode === 'new') newEmployeeDraft.current = employeeForm;
    if (mode === 'new') {
      // A new employee always gets a fresh id so it can never overwrite the selected one.
      setSelected(null);
      setEmployeeForm(newEmployeeDraft.current ?? employeeFormFor(null));
    } else if (setupMode === 'new') {
      setEmployeeForm(employeeFormFor(selectedEmployee));
    }
    setSetupMode(mode);
  }

  function openEntry(employee: SalaryEmployee | null, kind: EntryKind = 'payment') {
    if (savingTarget === 'entry' || !canEdit) return;
    setEntrySelected(employee);
    // Keep the typed amount and comment; only a new request id and kind change.
    setEntryForm((current) => (current.kind === kind && employee?.id === entrySelected?.id
      ? current
      : { ...current, id: crypto.randomUUID(), kind, date: employee?.id === entrySelected?.id ? current.date : today }));
    setEntryError('');
  }

  async function save(event: FormEvent, dialog: FormDialog) {
    const setError = dialog === 'entry' ? setEntryError : setEmployeeError;
    const targetEmployee = dialog === 'entry' ? entrySelected : selectedEmployee;
    event.preventDefault();
    const allowed = dialog === 'entry' ? canEdit : isOwner;
    if (!allowed || mutating.current) return;
    if ((dialog === 'entry' || setupMode !== 'new') && !targetEmployee) return;
    const amount = dialog === 'employee' && setupMode === 'kpi' ? Number(employeeForm.kpi) : parseCurrencyInput(dialog === 'employee' ? employeeForm.amount : entryForm.amount);
    if (!Number.isFinite(amount) || amount >= 100000000000000 || (dialog === 'employee' ? amount < 0 : amount <= 0)) {
      setError(tc('invalidAmount'));
      return;
    }
    if (dialog === 'entry' && entryForm.kind === 'payment') {
      const max = maxSalaryPayment(balances[targetEmployee!.id] ?? []);
      if (amount > max) {
        setError(t('paymentExceedsBalance', { max: formatCurrency(max), currency: tc('currency') }));
        return;
      }
    }
    if (dialog === 'employee' && setupMode !== 'salary' && !employeeForm.kpi_game_club && !employeeForm.kpi_bar) {
      setError(t('kpiPoolRequired'));
      return;
    }
    mutating.current = true;
    setSavingTarget(dialog);
    setError('');
    try {
      if (dialog === 'entry') {
        await postSalary(clubId, {
          action: 'record_entry', employeeId: targetEmployee!.id, requestId: entryForm.id, date: entryForm.date,
          kind: entryForm.kind, amount, comment: entryForm.comment.trim(),
          paymentMethod: entryForm.kind === 'payment' ? entryForm.payment_method : null,
          paymentSource: entryForm.kind === 'payment' ? entryForm.payment_source : null,
        });
      } else if (setupMode === 'salary' || setupMode === 'kpi') {
        await postSalary(clubId, {
          action: 'change_term', employeeId: targetEmployee!.id, kind: setupMode, amount, salaryType: employeeForm.salary_type,
          ...(setupMode === 'kpi' ? { kpiBasis: employeeForm.kpi_basis, kpiGameClub: employeeForm.kpi_game_club, kpiBar: employeeForm.kpi_bar } : {}),
        });
      } else {
        await postSalary(clubId, {
          action: 'save_employee', employeeId: employeeForm.id, name: employeeForm.name.trim(), jobTitle: employeeForm.job_title.trim(),
          date: employeeForm.date, salaryType: employeeForm.salary_type, amount, kpi: Number(employeeForm.kpi), active: employeeForm.active,
          kpiBasis: employeeForm.kpi_basis, kpiGameClub: employeeForm.kpi_game_club, kpiBar: employeeForm.kpi_bar,
        });
      }
      if (dialog === 'entry') setEntryForm((form) => ({ ...form, id: crypto.randomUUID(), amount: '', comment: '' }));
      else if (setupMode === 'new') {
        newEmployeeDraft.current = null;
        setEmployeeForm((form) => ({ ...form, id: crypto.randomUUID(), name: '', job_title: '', amount: '0', kpi: '0' }));
      }
      showToast(t('saved'));
      await (dialog === 'entry' ? reloadEntries() : reload({ silent: true }));
    } catch (error) { setError(writeErrorMessage(error)); }
    finally { mutating.current = false; setSavingTarget(null); }
  }

  function openEmployeeEdit(employee: SalaryEmployee) {
    if (!isOwner || saving) return;
    setEditError('');
    setEmployeeEdit(employeeEditState(employee, summaries.get(employee.id)?.display, { rates: data.rates, today }));
  }

  // Role, salary and KPI are separate owner actions (each logged and announced
  // on its own); only the parts that changed are sent, one after another, so a
  // KPI change applies on top of a salary change saved a moment earlier.
  async function saveEmployeeEdit() {
    if (!employeeEdit || !isOwner || mutating.current) return;
    const changes = employeeEditChanges(employeeEdit);
    const amount = parseCurrencyInput(employeeEdit.amount);
    const kpi = Number(employeeEdit.kpi);
    if (changes.salary && (!Number.isFinite(amount) || amount < 0 || amount >= 100000000000000)) { setEditError(tc('invalidAmount')); return; }
    if (changes.kpi && (!Number.isFinite(kpi) || kpi < 0 || kpi > 100)) { setEditError(tc('invalidAmount')); return; }
    if (changes.kpi && !employeeEdit.kpi_game_club && !employeeEdit.kpi_bar) { setEditError(t('kpiPoolRequired')); return; }
    const employeeId = employeeEdit.employee.id;
    // Only a backdated change sends its date; today's keeps working on databases before migration 123.
    const from = employeeEdit.date !== employeeEdit.defaultDate ? { date: employeeEdit.date } : {};
    mutating.current = true;
    setSavingTarget('employee');
    setEditError('');
    let wrote = false;
    // Each landed part joins the baseline, so a retry after a failure sends only what is left.
    let landed = employeeEdit;
    const markLanded = (part: 'role' | 'salary' | 'kpi') => {
      landed = withLandedEmployeeChange(landed, part);
      setEmployeeEdit(landed);
      wrote = true;
    };
    try {
      if (changes.role) {
        await postSalary(clubId, { action: 'change_role', employeeId, jobTitle: employeeEdit.role.trim() });
        markLanded('role');
      }
      if (changes.salary) {
        await postSalary(clubId, { action: 'change_term', employeeId, kind: 'salary', amount, salaryType: employeeEdit.salary_type, ...from });
        markLanded('salary');
      }
      if (changes.kpi) {
        await postSalary(clubId, {
          action: 'change_term', employeeId, kind: 'kpi', amount: kpi,
          kpiBasis: employeeEdit.kpi_basis, kpiGameClub: employeeEdit.kpi_game_club, kpiBar: employeeEdit.kpi_bar, ...from,
        });
        markLanded('kpi');
      }
      setEmployeeEdit(null);
      showToast(t('saved'));
    } catch (error) { setEditError(writeErrorMessage(error)); }
    finally {
      mutating.current = false;
      setSavingTarget(null);
      // A partly saved edit still shows what did land.
      if (wrote) void reload({ silent: true });
    }
  }

  function setEmployeeActive(employee: SalaryEmployee, active: boolean) {
    if (mutating.current || !isOwner) return;
    if (active) { void activateEmployee(employee); return; }
    const earliest = earliestDeactivationDate(employee, data.rates);
    setDeactivationError('');
    setDeactivation({ employee, earliest, date: summaries.get(employee.id)?.deactivatesOn ?? (today > earliest ? today : earliest) });
  }

  async function activateEmployee(employee: SalaryEmployee) {
    const confirmed = await confirm({
      title: `${t('activate')} · ${employee.name}`,
      description: t('activateConfirm', { name: employee.name }),
      confirmLabel: t('activate'),
      tone: 'primary',
    });
    if (!confirmed) return;
    mutating.current = true;
    setSavingTarget('deactivate');
    try {
      await postSalary(clubId, { action: 'set_active', employeeId: employee.id, active: true });
      showToast(t('activated'));
      await reload({ silent: true });
    } catch (error) { showToast(writeErrorMessage(error), 'error'); }
    finally { mutating.current = false; setSavingTarget(null); }
  }

  function deactivationHint(employeeId: string, date: string) {
    const hints = [
      date < today && t('deactivationBackdatedHelp'),
      deactivationCancelsRates(data.rates, employeeId, date) && t('deactivationCancelsRatesHelp'),
    ].filter(Boolean);
    return hints.length > 0 ? hints.join(' ') : undefined;
  }

  async function deactivateEmployee() {
    if (!deactivation || !isOwner || mutating.current) return;
    mutating.current = true;
    setSavingTarget('deactivate');
    setDeactivationError('');
    try {
      await postSalary(clubId, { action: 'set_active', employeeId: deactivation.employee.id, active: false, date: deactivation.date });
      setDeactivation(null);
      showToast(t(deactivation.date > today ? 'deactivationScheduled' : 'deactivated'));
      await reload({ silent: true });
    } catch (error) { setDeactivationError(writeErrorMessage(error)); }
    finally { mutating.current = false; setSavingTarget(null); }
  }

  function requestDeletion(target: DeletionTarget) {
    setDeleteError('');
    setDeleteReason('');
    setDeletion(target);
  }

  function requestEmployeeDeletion(employee: SalaryEmployee) {
    const balance = salaryBalance(balances[employee.id] ?? []);
    requestDeletion({ id: employee.id, employeeId: employee.id, kind: 'employee', label: employee.name, unpaid: balance > 0 ? balance : undefined });
  }

  async function deleteRecord() {
    const reason = deleteReason.trim();
    if (!deletion || !reason || !isOwner || mutating.current) return;
    mutating.current = true;
    setSavingTarget('delete');
    setDeleteError('');
    try {
      // Same route as every other payroll write, so it is logged and notified consistently.
      await postSalary(clubId, deletion.kind === 'employee'
        ? { action: 'delete_employee', employeeId: deletion.employeeId, reason }
        : { action: 'delete_record', employeeId: deletion.employeeId, recordId: deletion.id, kind: deletion.kind, reason });
      setDeletion(null);
      showToast(t('deletedSuccess'));
      // Deleting a rate can change accruals; an entry only changes entries.
      await (deletion.kind === 'entry' ? reloadEntries() : reload({ silent: true }));
    } catch (error) { setDeleteError(writeErrorMessage(error)); }
    finally { mutating.current = false; setSavingTarget(null); }
  }

  const viewOptions: SegmentedOption<SalaryView>[] = [
    { value: 'employees', label: t('employees') },
    { value: 'operations', label: t('dailyOperations') },
    { value: 'history', label: t('history') },
  ];
  // Switches in place (the loaded data is reused) but keeps the address in step,
  // so a reload, a shared link or Back lands on the same tab.
  const changeView = (next: SalaryView) => {
    setView(next);
    window.history.pushState(null, '', VIEW_PATHS[next]);
  };
  const historySummary = historyEmployee && summaries.get(historyEmployee.id);
  const historyStatus = historySummary?.status;
  const historyDeactivation = historySummary?.deactivatedFrom ? `${t('deactivatedFrom')} ${formatDateOnly(historySummary.deactivatedFrom, locale)}`
    : historySummary?.deactivatesOn ? `${t('deactivatesOn')} ${formatDateOnly(historySummary.deactivatesOn, locale)}` : '';
  const pageTitle = employeeId ? historyEmployee?.name ?? t('history') : t(view === 'employees' ? 'employees' : view === 'history' ? 'history' : 'title');
  // Club-wide due keeps one employee's overpayment from hiding what another is owed.
  // One employee's negative balance is an advance, shown like on their card.
  const dueValue = view === 'history' && employeeId ? salaryBalance(historyMonths) : due;
  const isAdvance = dueValue < 0;
  const historyTotals = salaryEarnings(historyMonths);

  return (
    <div className="space-y-5">
      {/* One employee's history is a page of its own, reached from their card; the section tabs belong to the club-wide views. */}
      <PageHeader
        back={employeeId ? '/salaries/employees' : undefined}
        backLabel={t('employees')}
        title={pageTitle}
        meta={historyStatus && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={historyStatus === 'upcoming' ? 'info' : historyStatus === 'active' ? 'success' : 'neutral'}>{t(historyStatus)}</Badge>
            {historyDeactivation && <span className="text-sm text-gray-500">{historyDeactivation}</span>}
          </div>
        )}
        tabs={employeeId ? undefined : (
          <SegmentedControl
            variant="tabs"
            label={t('viewSwitcher')}
            options={viewOptions}
            value={view}
            onChange={changeView}
          />
        )}
      />

      {loadError && (
        <LoadErrorAlert retrying={loading} onRetry={() => void reload()}>
          {t('loadError')}
        </LoadErrorAlert>
      )}

      {/* After a failed load the totals are unknown, not zero. */}
      {!loadError && view === 'history' && (
        // Tinted tiles, one per part of the balance, the way the calendar chips colour them.
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label={t(isAdvance ? 'advance' : 'totalDue')}
            value={<MetricMoney amount={Math.abs(dueValue)} />}
            icon={Wallet}
            iconClassName="text-warning-600"
            tone={dueValue > 0 ? 'warning' : 'default'}
            className="border-warning-100 bg-warning-50"
            loading={loading}
          />
          <MetricCard label={t('earnedTotal')} value={<MetricMoney amount={historyTotals.earned} />} icon={CalendarCheck} iconClassName="text-success-600" tone="success" className="border-success-100 bg-success-50" loading={loading} />
          <MetricCard label={t('totalPaid')} value={<MetricMoney amount={historyTotals.paid} />} icon={Banknote} iconClassName="text-primary-600" tone="primary" className="border-primary-100 bg-primary-50" loading={loading} />
          <MetricCard label={t('bonusTotal')} value={<MetricMoney amount={historyTotals.bonus} />} icon={Gift} iconClassName="text-purple-600" className="border-purple-100 bg-purple-50" loading={loading} />
          <MetricCard label={t('kpiTotal')} value={<MetricMoney amount={historyTotals.kpi} />} icon={Percent} iconClassName="text-success-600" tone="success" className="border-success-100 bg-success-50" loading={loading} />
          <MetricCard label={t('fineTotal')} value={<MetricMoney amount={historyTotals.fine} />} icon={ShieldAlert} iconClassName="text-danger-600" tone="danger" className="border-danger-100 bg-danger-50" loading={loading} />
        </div>
      )}

      {!loadError && view !== 'history' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            label={t('activeEmployees')}
            value={String(activeCount)}
            trendLabel={upcomingCount ? t('upcomingCount', { count: upcomingCount }) : undefined}
            icon={Users}
            loading={loading}
          />
          <MetricCard
            label={t(isAdvance ? 'advance' : 'totalDue')}
            value={<MetricMoney amount={Math.abs(dueValue)} />}
            icon={Wallet}
            loading={loading}
            tone={dueValue > 0 ? 'warning' : 'default'}
          />
          <MetricCard
            label={t('earnedThisMonth')}
            value={<MetricMoney amount={thisMonth?.earned ?? 0} />}
            trendLabel={t('paidThisMonth', { amount: `${formatCurrency(thisMonth?.paid ?? 0)} ${tc('currency')}` })}
            icon={Banknote}
            loading={loading}
          />
        </div>
      )}

      {view !== 'employees' && (
        <Disclosure summary={t('howItWorks')} className="text-sm text-gray-700">
          <Card className="mt-2">
            <div className="space-y-2 leading-6 text-gray-600"><p>{t('baseHelp')}</p><p>{t('kpiHelp')}</p><p>{t('estimateHelp')}</p><p>{t('paymentHelp')}</p></div>
          </Card>
        </Disclosure>
      )}

      {!canEdit && <InlineAlert variant="info">{t('viewOnlyHelp')}</InlineAlert>}

      {canEdit && !isOwner && view === 'operations' && <InlineAlert variant="info">{t('ownerOnlySetupHelp')}</InlineAlert>}

      {canEdit && view === 'operations' && (
        <OperationsForms
          employees={employees}
          balances={balances}
          today={today}
          isOwner={isOwner}
          loading={loading}
          loadError={loadError}
          savingTarget={savingTarget}
          setupMode={setupMode}
          entrySelected={entrySelected}
          selectedEmployee={selectedEmployee}
          employeeForm={employeeForm}
          setEmployeeForm={setEmployeeForm}
          entryForm={entryForm}
          setEntryForm={setEntryForm}
          entryError={entryError}
          employeeError={employeeError}
          onSetupModeChange={changeSetupMode}
          onSelectSetupEmployee={selectSetupEmployee}
          onOpenEntry={openEntry}
          onSubmit={(event, dialog) => void save(event, dialog)}
        />
      )}

      {view === 'employees' && (
        <EmployeesView
          employees={employees}
          summaries={summaries}
          balances={balances}
          paidBySource={paidBySource}
          loading={loading}
          loadError={loadError}
          isOwner={isOwner}
          savingTarget={savingTarget}
          onEdit={openEmployeeEdit}
          onSetActive={setEmployeeActive}
          onDelete={requestEmployeeDeletion}
        />
      )}

      {view === 'history' && (
        <HistoryView
          employeeId={employeeId}
          historyEmployee={historyEmployee}
          employees={employees}
          rates={shownRates}
          entries={shownEntries}
          deleterNames={data.deleterNames}
          months={historyMonths}
          balances={balances}
          loading={loading}
          loadError={loadError}
          isOwner={isOwner}
          saving={saving}
          today={today}
          onDelete={requestDeletion}
        />
      )}

      <ConfirmDialog
        open={Boolean(deletion) && isOwner}
        tone="danger"
        title={t(deletion?.kind === 'employee' ? 'deleteEmployeeTitle' : 'deleteTitle')}
        description={(
          <>
            <p className="mb-2 font-semibold text-gray-900">{deletion?.label}</p>
            <p>{t(deletion?.kind === 'employee' ? 'deleteEmployeeHelp' : deletion?.kind === 'rate' ? 'deleteRateHelp' : 'deleteEntryHelp')}</p>
            {deletion?.unpaid !== undefined && <p className="mt-2 font-semibold text-warning-600">{t('deleteEmployeeDue', { amount: `${formatCurrency(deletion.unpaid)} ${tc('currency')}` })}</p>}
            <Field label={t('deleteReason')} htmlFor="salary-delete-reason" required className="mt-3">
              <Textarea id="salary-delete-reason" required autoFocus maxLength={500} placeholder={t('deleteReasonPlaceholder')} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} />
            </Field>
          </>
        )}
        confirmLabel={t('delete')}
        confirmDisabled={!deleteReason.trim()}
        loading={saving}
        error={deleteError || undefined}
        onConfirm={() => void deleteRecord()}
        onCancel={() => setDeletion(null)}
      />

      <ConfirmDialog
        open={deactivation !== null}
        title={deactivation ? `${t('deactivate')} · ${deactivation.employee.name}` : t('deactivate')}
        description={deactivation && (
          <div className="space-y-3">
            <p>{t('deactivateConfirm', { name: deactivation.employee.name })}</p>
            <Field label={t('deactivationDate')} hint={deactivationHint(deactivation.employee.id, deactivation.date)}>
              <DatePicker
                value={deactivation.date}
                min={deactivation.earliest}
                disabled={savingTarget === 'deactivate'}
                ariaLabel={t('deactivationDate')}
                onChange={(date) => setDeactivation({ ...deactivation, date })}
              />
            </Field>
          </div>
        )}
        confirmLabel={t('deactivate')}
        tone="danger"
        loading={savingTarget === 'deactivate'}
        error={deactivationError || undefined}
        onConfirm={() => void deactivateEmployee()}
        onCancel={() => { if (!mutating.current) setDeactivation(null); }}
      />

      <EmployeeEditDialog
        edit={isOwner ? employeeEdit : null}
        saving={savingTarget === 'employee' && employeeEdit !== null}
        error={editError}
        onChange={setEmployeeEdit}
        onClose={() => { if (!mutating.current) setEmployeeEdit(null); }}
        onSave={() => void saveEmployeeEdit()}
      />

      {toastElement}
      {confirmDialog}
    </div>
  );
}
