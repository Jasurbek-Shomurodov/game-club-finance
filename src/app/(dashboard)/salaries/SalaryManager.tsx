'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, Building2, Users, Wallet } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Card,
  ConfirmDialog,
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
  displayedRate,
  employeeStatus,
  rateInForce,
  salaryBalance,
  type KpiBasis,
  type SalaryEmployee,
} from '@/lib/calculations/salaries';
import { formatCurrencyInput, parseCurrencyInput } from '@/lib/formatters';
import { defaultPaymentMethod } from '@/lib/paymentMethods';
import { canAccessFeature } from '@/lib/permissions';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessRollover } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
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

const emptyData: Awaited<ReturnType<typeof loadSalaries>> = { employees: [], rates: [], entries: [], monthlyProfit: [] };

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
  const [roleEdit, setRoleEdit] = useState<{ id: string; role: string } | null>(null);
  const [roleError, setRoleError] = useState('');
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
    return [employee.id, { current: rateInForce(data.rates, employee.id, today), display, status: employeeStatus(employee, display, today) }];
  })), [data.employees, data.rates, today]);
  const historyEmployee = data.employees.find((employee) => employee.id === employeeId);
  const upcomingCount = data.employees.filter((e) => summaries.get(e.id)?.status === 'upcoming').length;
  const activeCount = data.employees.filter((e) => summaries.get(e.id)?.current?.active).length;
  // Deactivated staff keep their balance on their card but stay out of the club's total due.
  const due = data.employees
    .filter((e) => summaries.get(e.id)?.display?.active)
    .reduce((sum, e) => sum + Math.max(0, salaryBalance(balances[e.id] ?? [])), 0);
  // Without an employee in the route, history covers the whole club.
  const historyMonths = useMemo(() => (employeeId ? balances[employeeId] ?? [] : combineSalaryMonths(balances)), [balances, employeeId]);
  const paid = data.entries.filter((e) => !e.deleted_at && e.kind === 'payment').reduce((sum, e) => sum + Number(e.amount), 0);

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
      const entries = await loadSalaryEntries(clubId, today);
      if (request === generation.current) {
        setData((previous) => ({ ...previous, entries, monthlyProfit: applySalaryPaymentChanges(previous.monthlyProfit, previous.entries, entries) }));
      }
    } catch {
      if (request === generation.current) await reload({ silent: true });
    }
  }, [clubId, reload, setData, today]);

  function employeeFormFor(employee: SalaryEmployee | null): EmployeeFormState {
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
  }

  // Forms are rendered inline, so selecting an employee or switching a
  // segmented option never scrolls the page.
  function selectSetupEmployee(employee: SalaryEmployee | null) {
    if (savingTarget === 'employee' || !isOwner) return;
    setSelected(employee);
    setEmployeeForm(employeeFormFor(employee));
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

  function changeRoleEdit(edit: { id: string; role: string } | null) {
    if (!edit || edit.id !== roleEdit?.id) setRoleError('');
    setRoleEdit(edit);
  }

  async function saveEmployeeRole() {
    if (!roleEdit || !isOwner || mutating.current) return;
    mutating.current = true;
    setSavingTarget('role');
    setRoleError('');
    try {
      await postSalary(clubId, { action: 'change_role', employeeId: roleEdit.id, jobTitle: roleEdit.role });
      setData((previous) => ({ ...previous, employees: previous.employees.map((employee) => employee.id === roleEdit.id ? { ...employee, job_title: roleEdit.role } : employee) }));
      setRoleEdit(null);
      showToast(t('saved'));
    } catch (error) { setRoleError(writeErrorMessage(error)); }
    finally { mutating.current = false; setSavingTarget(null); }
  }

  async function setEmployeeActive(employee: SalaryEmployee, active: boolean) {
    if (mutating.current || !isOwner) return;
    const confirmed = await confirm({
      title: `${t(active ? 'activate' : 'deactivate')} · ${employee.name}`,
      description: t(active ? 'activateConfirm' : 'deactivateConfirm', { name: employee.name }),
      confirmLabel: t(active ? 'activate' : 'deactivate'),
      tone: active ? 'primary' : 'danger',
    });
    if (!confirmed) return;
    mutating.current = true;
    setSavingTarget('deactivate');
    try {
      await postSalary(clubId, { action: 'set_active', employeeId: employee.id, active });
      showToast(t(active ? 'activated' : 'deactivated'));
      await reload({ silent: true });
    } catch (error) { showToast(writeErrorMessage(error), 'error'); }
    finally { mutating.current = false; setSavingTarget(null); }
  }

  async function deleteRecord() {
    const reason = deleteReason.trim();
    if (!deletion || !reason || !isOwner || mutating.current) return;
    mutating.current = true;
    setSavingTarget('delete');
    setDeleteError('');
    try {
      // Same route as every other payroll write, so it is logged and notified consistently.
      await postSalary(clubId, { action: 'delete_record', employeeId: deletion.employeeId, recordId: deletion.id, kind: deletion.kind, reason });
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
    { value: 'history', label: historyEmployee?.name ?? t('history') },
  ];
  const pageTitle = view === 'history' ? historyEmployee?.name ?? t('history') : t(view === 'employees' ? 'employees' : 'title');
  // Club-wide due keeps one employee's overpayment from hiding what another is owed.
  // One employee's negative balance is an advance, shown like on their card.
  const dueValue = view === 'history' && employeeId ? salaryBalance(historyMonths) : due;
  const isAdvance = dueValue < 0;

  return (
    <div className="space-y-5">
      <PageHeader
        back={view === 'history' && employeeId ? '/salaries/employees' : undefined}
        backLabel={t('employees')}
        title={pageTitle}
        tabs={(
          <SegmentedControl
            variant="tabs"
            label={t('viewSwitcher')}
            options={viewOptions}
            value={view}
            onChange={setView}
          />
        )}
      />

      {loadError && (
        <LoadErrorAlert retrying={loading} onRetry={() => void reload()}>
          {t('loadError')}
        </LoadErrorAlert>
      )}

      {/* After a failed load the totals are unknown, not zero. */}
      {!loadError && (
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            label={t(view === 'history' ? 'base' : 'activeEmployees')}
            value={view === 'history' ? <MetricMoney amount={historyMonths.reduce((sum, month) => sum + month.base, 0)} /> : String(activeCount)}
            trendLabel={view !== 'history' && upcomingCount ? t('upcomingCount', { count: upcomingCount }) : undefined}
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
          <MetricCard label={t('totalPaid')} value={<MetricMoney amount={view === 'history' ? historyMonths.reduce((sum, month) => sum + month.paid, 0) : paid} />} icon={Banknote} loading={loading} />
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
          employees={data.employees}
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
          employees={data.employees}
          summaries={summaries}
          balances={balances}
          loading={loading}
          loadError={loadError}
          isOwner={isOwner}
          savingTarget={savingTarget}
          roleEdit={roleEdit}
          roleError={roleError}
          onRoleEditChange={changeRoleEdit}
          onSaveRole={() => void saveEmployeeRole()}
          onSetActive={(employee, active) => void setEmployeeActive(employee, active)}
        />
      )}

      {view === 'history' && (
        <HistoryView
          employeeId={employeeId}
          historyEmployee={historyEmployee}
          employees={data.employees}
          rates={data.rates}
          entries={data.entries}
          months={historyMonths}
          loading={loading}
          loadError={loadError}
          isOwner={isOwner}
          saving={saving}
          today={today}
          onDelete={(target) => { setDeleteError(''); setDeleteReason(''); setDeletion(target); }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deletion) && isOwner}
        tone="danger"
        title={t('deleteTitle')}
        description={(
          <>
            <p className="mb-2 font-semibold text-gray-900">{deletion?.label}</p>
            <p>{t(deletion?.kind === 'rate' ? 'deleteRateHelp' : 'deleteEntryHelp')}</p>
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

      {toastElement}
      {confirmDialog}
    </div>
  );
}
