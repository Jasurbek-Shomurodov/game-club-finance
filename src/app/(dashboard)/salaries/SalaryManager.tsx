'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, Building2, Check, ChevronRight, History, Pencil, Power, Users, Wallet, X } from 'lucide-react';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  CurrencyInput,
  DataTable,
  DatePicker,
  EmployeeCardGridSkeleton,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  MetricCard,
  MetricGridSkeleton,
  Modal,
  Money,
  PageHeader,
  SectionHeading,
  SegmentedControl,
  Select,
  StatTile,
  TableSkeleton,
  Textarea,
  useConfirm,
  useToast,
  type SegmentedOption,
  MetricMoney,
} from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { createClient } from '@/lib/supabase/client';
import { loadSalaries } from '@/lib/supabase/salaries';
import { calculateSalaries, combineSalaryMonths, salaryBalance, canDeleteSalaryRate, type KpiBasis, type SalaryEmployee, type SalaryEntry, type SalaryRate } from '@/lib/calculations/salaries';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput, formatDateOnly, formatDateTime, formatYearMonth } from '@/lib/formatters';
import { defaultPaymentMethod } from '@/lib/paymentMethods';
import { canAccessFeature } from '@/lib/permissions';
import { todayIso } from '@/lib/utils';
import { classifyDatabaseWriteError } from '@/lib/validation';
import type { EntryPaymentMethod } from '@/types';

const employeeRoles = ['Manager', 'Admin', 'Cleaner'] as const;

function knownEmployeeRole(value: string) {
  return employeeRoles.find((role) => role.toLowerCase() === value.trim().toLowerCase());
}

type SetupMode = 'new' | 'salary' | 'kpi' | 'profile';
type SalaryView = 'operations' | 'employees' | 'history';
type EntryKind = SalaryEntry['kind'];
type SavingTarget = 'entry' | 'employee' | 'role' | 'deactivate' | 'delete';

async function postSalary(clubId: string, body: Record<string, unknown>) {
  const response = await fetch('/api/salaries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubId, ...body }),
  });
  const payload = await response.json().catch(() => null) as { error?: string; code?: string | null } | null;
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error ?? `HTTP ${response.status}`), { code: payload?.code ?? (response.status === 403 ? '42501' : '') });
  }
}

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
  // The route decides the initial view; the segmented control switches views
  // in place so the loaded data is reused instead of refetched.
  const [view, setView] = useState<SalaryView>(initialView);
  const tc = useTranslations('common');
  const tp = useTranslations('expenses');
  const { locale } = useAppLocale();
  const { businessDayStartHour, enabledPaymentMethods, role, featureAccess } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  // Salary editors record payments, bonuses and fines; only owners change employees, salary, KPI or activation.
  const canEdit = canAccessFeature(role, featureAccess, 'salaries');
  const isOwner = role === 'owner';
  const today = todayIso(new Date(), businessDayStartHour);
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [deletion, setDeletion] = useState<{ id: string; kind: 'entry' | 'rate'; label: string } | null>(null);
  const [roleEdit, setRoleEdit] = useState<{ id: string; role: string } | null>(null);
  const [roleError, setRoleError] = useState('');
  const [savingTarget, setSavingTarget] = useState<SavingTarget | null>(null);
  const saving = savingTarget !== null;
  const [loadError, setLoadError] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [employeeError, setEmployeeError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [setupMode, setSetupMode] = useState<SetupMode>('new');
  const [entrySelected, setEntrySelected] = useState<SalaryEmployee | null>(null);
  const [selectedEmployee, setSelected] = useState<SalaryEmployee | null>(null);
  const [employeeForm, setEmployeeForm] = useState(() => ({ id: crypto.randomUUID(), name: '', job_title: '', date: today, salary_type: 'daily', amount: '0', kpi: '0', kpi_basis: 'overall_profit' as KpiBasis, kpi_game_club: true, kpi_bar: true, active: true }));
  const [entryForm, setEntryForm] = useState(() => ({ id: crypto.randomUUID(), kind: 'payment' as EntryKind, amount: '', date: today, comment: '', payment_method: defaultPaymentMethod(enabledPaymentMethods), payment_source: 'game_club' }));
  const generation = useRef(0);
  const mutating = useRef(false);
  // Unsaved "new employee" draft, kept while the user looks at another setup mode.
  const newEmployeeDraft = useRef<typeof employeeForm | null>(null);
  const balances = useMemo(() => calculateSalaries({ ...data, throughDate: today }), [data, today]);
  const historyEmployee = data.employees.find((employee) => employee.id === employeeId);
  const currentRate = (id: string) => data.rates.filter((r) => !r.deleted_at && r.employee_id === id && r.effective_date <= today).sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
  const displayRate = (employee: SalaryEmployee) => currentRate(employee.id) ?? data.rates.filter((r) => !r.deleted_at && r.employee_id === employee.id).sort((a, b) => a.effective_date.localeCompare(b.effective_date))[0];
  const upcomingCount = data.employees.filter((e) => e.joined_on > today && displayRate(e)?.active).length;
  const activeCount = data.employees.filter((e) => currentRate(e.id)?.active).length;
  const due = data.employees.reduce((sum, e) => sum + Math.max(0, salaryBalance(balances[e.id] ?? [])), 0);
  // Without an employee in the route, history covers the whole club.
  const historyMonths = useMemo(() => (employeeId ? balances[employeeId] ?? [] : combineSalaryMonths(balances)), [balances, employeeId]);
  const historyEntries = data.entries.filter((e) => !historyEmployee || e.employee_id === historyEmployee.id);
  const historyRates = data.rates.filter((r) => !historyEmployee || r.employee_id === historyEmployee.id);
  // In the club-wide history each row names its employee.
  const employeePrefix = (id: string) => (historyEmployee ? '' : `${data.employees.find((e) => e.id === id)?.name ?? ''} · `);
  const paid = data.entries.filter((e) => !e.deleted_at && e.kind === 'payment').reduce((sum, e) => sum + Number(e.amount), 0);
  const roleLabel = (value: string) => {
    const known = knownEmployeeRole(value);
    return known ? t(`roles.${known}`) : value || t('noRole');
  };
  const kpiSummary = (rate: Pick<SalaryRate, 'kpi_basis' | 'kpi_game_club' | 'kpi_bar'> | undefined) => {
    const pools = [(rate?.kpi_game_club ?? true) && t('poolGameClub'), (rate?.kpi_bar ?? true) && t('poolBar')].filter(Boolean).join(' + ');
    return `${t((rate?.kpi_basis ?? 'overall_profit') === 'owner_profit' ? 'kpiBasisOwnerShort' : 'kpiBasisOverallShort')} · ${pools}`;
  };
  const currency = (value: number) => `${formatCurrency(value)} ${tc('currency')}`;
  const writeErrorMessage = (error: unknown) => {
    console.error('Salary write failed', error);
    const kind = classifyDatabaseWriteError(error);
    if (kind === 'permission') return t('permissionError');
    if (kind === 'check') return t('checkError');
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    return `${t('saveError')}${detail}`;
  };

  const reload = useCallback(async ({ silent = false } = {}) => {
    const request = ++generation.current;
    if (!silent) setLoading(true);
    setLoadError(false);
    try {
      const next = await loadSalaries(clubId, today);
      if (request === generation.current) setData(next);
    } catch {
      if (request === generation.current) setLoadError(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [clubId, today]);
  useEffect(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);

  function employeeFormFor(employee: SalaryEmployee | null) {
    const rate = employee ? displayRate(employee) : undefined;
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

  async function save(event: FormEvent, dialog: 'entry' | 'employee') {
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
      await reload({ silent: true });
    } catch (error) { setError(writeErrorMessage(error)); }
    finally { mutating.current = false; setSavingTarget(null); }
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
    if (!deletion || !canEdit || (deletion.kind === 'rate' && !isOwner) || mutating.current) return;
    mutating.current = true;
    setSavingTarget('delete');
    setDeleteError('');
    try {
      const result = await createClient().rpc('delete_salary_record', { p_club_id: clubId, p_id: deletion.id, p_kind: deletion.kind });
      if (result.error) throw result.error;
      setDeletion(null);
      showToast(t('deletedSuccess'));
      await reload({ silent: true });
    } catch (error) { setDeleteError(writeErrorMessage(error)); }
    finally { mutating.current = false; setSavingTarget(null); }
  }

  const formDisabled = (dialog: 'entry' | 'employee') => savingTarget === dialog || loading || loadError;
  const setupModeOptions = (['new', 'salary', 'kpi', 'profile'] as const).map((mode) => ({
    value: mode,
    label: t(mode === 'new' ? 'addEmployee' : mode === 'salary' ? 'changeSalary' : mode === 'kpi' ? 'changeKpi' : 'editEmployee'),
  }));
  const entryKindOptions = (['payment', 'bonus', 'fine'] as const).map((kind) => ({ value: kind, label: t(kind) }));
  const viewOptions: SegmentedOption<SalaryView>[] = [
    { value: 'employees', label: t('employees') },
    { value: 'operations', label: t('dailyOperations') },
    { value: 'history', label: historyEmployee?.name ?? t('history') },
  ];

  function renderEmployeeSelect(dialog: 'entry' | 'employee', selected: SalaryEmployee | null) {
    return (
      <Field label={t('employee')} htmlFor={`salary-${dialog}-employee`} required className="sm:col-span-2">
        <Select
          id={`salary-${dialog}-employee`}
          required
          value={selected?.id ?? ''}
          onChange={(event) => {
            const employee = data.employees.find((e) => e.id === event.target.value) ?? null;
            if (dialog === 'entry') openEntry(employee, entryForm.kind);
            else selectSetupEmployee(employee);
          }}
        >
          <option value="">{t('selectEmployee')}</option>
          {data.employees.filter((e) => dialog !== 'entry' || e.joined_on <= today).map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.name} · {roleLabel(employee.job_title)}{employee.joined_on > today ? ` · ${t('upcoming')}` : ''}</option>
          ))}
        </Select>
      </Field>
    );
  }

  function renderEmployeeFields() {
    return (
      <>
        {(setupMode === 'new' || setupMode === 'profile') && (
          <>
            <Field label={t('name')} htmlFor="salary-employee-name" required>
              <Input id="salary-employee-name" required maxLength={120} value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })} />
            </Field>
            <Field label={t('role')} htmlFor="salary-employee-role">
              <Select id="salary-employee-role" value={employeeForm.job_title} onChange={(e) => setEmployeeForm({ ...employeeForm, job_title: e.target.value })}>
                <option value="">{t('selectRole')}</option>
                {employeeRoles.map((option) => <option key={option} value={option}>{t(`roles.${option}`)}</option>)}
                {employeeForm.job_title && !knownEmployeeRole(employeeForm.job_title) && <option value={employeeForm.job_title}>{employeeForm.job_title}</option>}
              </Select>
            </Field>
          </>
        )}
        {(setupMode === 'new' || setupMode === 'profile') && (
          <Field label={t('effectiveDate')} hint={t(setupMode === 'new' ? 'futureHelp' : 'rateHelp')}>
            <DatePicker
              ariaLabel={t('effectiveDate')}
              min={selectedEmployee ? (selectedEmployee.joined_on > today ? selectedEmployee.joined_on : today) : '2000-01-01'}
              max={selectedEmployee ? (selectedEmployee.joined_on > today ? selectedEmployee.joined_on : today) : undefined}
              disabled={savingTarget === 'employee'}
              value={employeeForm.date}
              onChange={(date) => setEmployeeForm({ ...employeeForm, date })}
            />
          </Field>
        )}
        {(setupMode === 'salary' || setupMode === 'kpi') && (
          <p className="text-xs leading-5 text-gray-500 sm:col-span-2">{t('rateHelp')}</p>
        )}
        {setupMode !== 'kpi' && (
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            <Field label={t('salaryType')} htmlFor="salary-type">
              <Select id="salary-type" value={employeeForm.salary_type} onChange={(e) => setEmployeeForm({ ...employeeForm, salary_type: e.target.value })}>
                <option value="daily">{t('daily')}</option>
                <option value="monthly">{t('monthly')}</option>
              </Select>
            </Field>
            <Field label={t('amount')} htmlFor="salary-amount" hint={t('zeroBaseHelp')}>
              <CurrencyInput id="salary-amount" value={employeeForm.amount} onValueChange={(value) => setEmployeeForm({ ...employeeForm, amount: value })} />
            </Field>
          </div>
        )}
        {setupMode !== 'salary' && (
          <>
          <Field label={t('kpiPercent')} htmlFor="salary-kpi">
            <Input id="salary-kpi" type="number" required min="0" max="100" step="0.01" inputMode="decimal" value={employeeForm.kpi} onChange={(e) => setEmployeeForm({ ...employeeForm, kpi: e.target.value })} onWheel={(event) => event.currentTarget.blur()} trailingAddon="%" />
          </Field>
            <Field label={t('kpiBasis')} htmlFor="salary-kpi-basis" hint={t(employeeForm.kpi_basis === 'owner_profit' ? 'kpiBasisOwnerHelp' : 'kpiBasisOverallHelp')} className="sm:col-span-2">
              <Select id="salary-kpi-basis" value={employeeForm.kpi_basis} onChange={(e) => setEmployeeForm({ ...employeeForm, kpi_basis: e.target.value as KpiBasis })}>
                <option value="overall_profit">{t('kpiBasisOverall')}</option>
                <option value="owner_profit">{t('kpiBasisOwner')}</option>
              </Select>
            </Field>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2" role="group" aria-label={t('kpiPools')}>
              <span className="text-sm font-medium text-gray-700">{t('kpiPools')}</span>
              <Checkbox label={t('poolGameClub')} checked={employeeForm.kpi_game_club} onChange={(e) => setEmployeeForm({ ...employeeForm, kpi_game_club: e.target.checked })} />
              <Checkbox label={t('poolBar')} checked={employeeForm.kpi_bar} onChange={(e) => setEmployeeForm({ ...employeeForm, kpi_bar: e.target.checked })} />
            </div>
          </>
        )}
        {(setupMode === 'new' || setupMode === 'profile') && (
          <Checkbox className="self-end" label={t('active')} checked={employeeForm.active} onChange={(e) => setEmployeeForm({ ...employeeForm, active: e.target.checked })} />
        )}
      </>
    );
  }

  function renderEntryFields(selected: SalaryEmployee | null) {
    const balance = salaryBalance(balances[selected?.id ?? ''] ?? []);
    return (
      <>
        <StatTile className="sm:col-span-2" variant="soft" label={t('balance')} value={formatCurrency(balance)} unit={tc('currency')} tone="primary" />
        <Field label={t('amount')} htmlFor="salary-entry-amount" required>
          <CurrencyInput id="salary-entry-amount" required value={entryForm.amount} onValueChange={(value) => setEntryForm({ ...entryForm, amount: value })} />
        </Field>
        <Field label={t('date')}>
          <DatePicker ariaLabel={t('date')} min={selected?.joined_on} max={today} disabled={savingTarget === 'entry'} value={entryForm.date} onChange={(date) => setEntryForm({ ...entryForm, date })} />
        </Field>
        {entryForm.kind === 'payment' && (
          <>
            <Field label={tp('paymentMethod')} htmlFor="salary-entry-method">
              <Select id="salary-entry-method" value={entryForm.payment_method} onChange={(e) => setEntryForm({ ...entryForm, payment_method: e.target.value as EntryPaymentMethod })}>
                {enabledPaymentMethods.map((method) => <option key={method} value={method}>{tc(`paymentMethods.${method}`)}</option>)}
              </Select>
            </Field>
            <Field label={tp('paymentSource')} htmlFor="salary-entry-source">
              <Select id="salary-entry-source" value={entryForm.payment_source} onChange={(e) => setEntryForm({ ...entryForm, payment_source: e.target.value })}>
                <option value="game_club">{tp('paymentSources.game_club')}</option>
                <option value="bar">{tp('paymentSources.bar')}</option>
              </Select>
            </Field>
          </>
        )}
        <Field label={t('comment')} htmlFor="salary-entry-comment" className="sm:col-span-2">
          <Textarea id="salary-entry-comment" maxLength={1000} value={entryForm.comment} onChange={(e) => setEntryForm({ ...entryForm, comment: e.target.value })} />
        </Field>
      </>
    );
  }

  function formErrorFor(dialog: 'entry' | 'employee') {
    return dialog === 'entry' ? entryError : employeeError;
  }

  function renderForm(dialog: 'entry' | 'employee') {
    const selected = dialog === 'entry' ? entrySelected : selectedEmployee;
    const title = dialog === 'entry'
      ? t('recordOperations')
      : t(setupMode === 'new' ? 'addEmployee' : setupMode === 'salary' ? 'changeSalary' : setupMode === 'kpi' ? 'changeKpi' : 'editEmployee');
    return (
      <Card as="section" id={dialog === 'entry' ? 'salary-entry-form' : 'salary-employee-form'} padding="lg">
        <SectionHeading title={title} className="mb-5" />
        {dialog === 'employee' && (
          <SegmentedControl
            variant="soft"
            // Four labels never fit on one row inside the half-width form card.
            className="mb-5 grid-cols-2"
            columns="auto"
            label={t('salarySetup')}
            options={setupModeOptions}
            value={setupMode}
            disabled={formDisabled('employee')}
            onChange={changeSetupMode}
          />
        )}
        {/* eslint-disable-next-line react-hooks/refs -- save() reads refs only inside the submit handler, never while rendering. */}
        <form onSubmit={(event) => void save(event, dialog)} className="space-y-4">
          <fieldset disabled={formDisabled(dialog)} className="grid gap-4 sm:grid-cols-2">
            {dialog === 'entry' && (
              <div className="sm:col-span-2">
                <SegmentedControl
                  variant="soft"
                  label={t('entryType')}
                  options={entryKindOptions}
                  value={entryForm.kind}
                  onChange={(kind) => openEntry(selected, kind)}
                />
                <p className="mt-2 text-xs leading-5 text-gray-500">{t(`${entryForm.kind}Hint`)}</p>
              </div>
            )}
            {(dialog === 'entry' || setupMode !== 'new') && renderEmployeeSelect(dialog, selected)}
            {dialog === 'employee' ? renderEmployeeFields() : renderEntryFields(selected)}
          </fieldset>
          {formErrorFor(dialog) && <InlineAlert variant="danger">{formErrorFor(dialog)}</InlineAlert>}
          <Button
            type="submit"
            fullWidth
            loading={savingTarget === dialog}
            loadingLabel={tc('saving')}
            disabled={loading || loadError || (saving && savingTarget !== dialog) || ((dialog === 'entry' || setupMode !== 'new') && !selected)}
          >
            {dialog === 'entry' ? t(`record_${entryForm.kind}`) : tc('save')}
          </Button>
        </form>
      </Card>
    );
  }

  function renderEmployeeCard(employee: SalaryEmployee) {
    const rate = displayRate(employee);
    const upcoming = employee.joined_on > today && Boolean(rate?.active);
    const balance = salaryBalance(balances[employee.id] ?? []);
    const status = upcoming ? 'upcoming' : rate?.active ? 'active' : 'inactive';

    return (
              <Card key={employee.id} as="article" padding="lg">
                <div className="mb-5 flex items-start gap-3">
                  <Avatar name={employee.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-base font-semibold text-gray-950">{employee.name}</h2>
                    <div className="mt-0.5 flex items-center gap-1 text-sm text-gray-500">
                      <span className="break-words">{roleLabel(employee.job_title)}</span>
                      {isOwner && roleEdit?.id !== employee.id && (
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={`${t('changeRole')} · ${employee.name}`}
                          icon={<Pencil size={15} />}
                          disabled={saving}
                          onClick={() => { setRoleError(''); setRoleEdit({ id: employee.id, role: knownEmployeeRole(employee.job_title) ?? '' }); }}
                        />
                      )}
                    </div>
                  </div>
                  <Badge variant={status === 'upcoming' ? 'info' : status === 'active' ? 'success' : 'neutral'}>{t(status)}</Badge>
                </div>
                {isOwner && roleEdit?.id === employee.id && (
                  <form className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3" onSubmit={(event) => { event.preventDefault(); void saveEmployeeRole(); }}>
                    <Field label={t('role')} htmlFor={`employee-role-${employee.id}`} error={roleError || undefined}>
                      <div className="flex flex-wrap gap-2">
                        <Select id={`employee-role-${employee.id}`} className="min-w-0 flex-1" required disabled={saving} value={roleEdit.role} onChange={(event) => setRoleEdit({ ...roleEdit, role: event.target.value })}>
                          <option value="">{t('selectRole')}</option>
                          {employeeRoles.map((option) => <option key={option} value={option}>{t(`roles.${option}`)}</option>)}
                        </Select>
                        <IconButton type="submit" variant="soft" label={tc('save')} icon={<Check size={18} />} loading={savingTarget === 'role'} disabled={!roleEdit.role || (saving && savingTarget !== 'role')} />
                        <IconButton label={tc('cancel')} icon={<X size={18} />} disabled={saving} onClick={() => { setRoleEdit(null); setRoleError(''); }} />
                      </div>
                    </Field>
                  </form>
                )}
                <dl className="divide-y divide-gray-100 text-sm">
                  {[
                    [t(upcoming ? 'startsOn' : 'joined'), formatDateOnly(employee.joined_on, locale)],
                    [t(rate?.salary_type ?? 'daily'), currency(Number(rate?.amount ?? 0))],
                    [t('kpi'), `${Number(rate?.kpi_percent ?? 0)}%`],
                    [t('kpiBasis'), kpiSummary(rate)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 py-2">
                      <dt className="text-gray-500">{label}</dt>
                      <dd className="text-right font-semibold tabular-nums text-gray-900">{value}</dd>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4 pt-3">
                    <dt className="text-gray-500">{t(balance < 0 ? 'advance' : 'balance')}</dt>
                    <dd className={cn('text-right text-xl font-bold tracking-tight tabular-nums', balance > 0 ? 'text-warning-600' : 'text-gray-950')}>
                      {formatCurrency(Math.abs(balance))}{currencySuffix}
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 flex flex-wrap gap-2">
                  <ButtonLink size="sm" href={`/salaries/employees/${employee.id}`} icon={<History size={16} aria-hidden="true" />}>{t('history')}</ButtonLink>
                  {isOwner && (
                    <Button
                      variant={rate?.active ? 'dangerOutline' : 'outline'}
                      size="sm"
                      disabled={saving}
                      onClick={() => void setEmployeeActive(employee, !rate?.active)}
                      icon={<Power size={16} aria-hidden="true" />}
                    >
                      {t(rate?.active ? 'deactivate' : 'activate')}
                    </Button>
                  )}
                </div>
              </Card>
    );
  }

  const pageTitle = view === 'history' ? historyEmployee?.name ?? t('history') : t(view === 'employees' ? 'employees' : 'title');
  const employeesSorted = [...data.employees].sort((a, b) => a.name.localeCompare(b.name));
  const inactiveEmployees = employeesSorted.filter((employee) => !displayRate(employee)?.active);
  const liveEmployees = employeesSorted.filter((employee) => displayRate(employee)?.active);
  // Club-wide due keeps one employee's overpayment from hiding what another is owed.
  const dueValue = view === 'history' && employeeId ? salaryBalance(historyMonths) : due;
  const currencySuffix = <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{tc('currency')}</span>;
  const metricMoney = (value: number) => <MetricMoney amount={value} />;

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
        <InlineAlert variant="danger" action={<Button variant="outline" size="sm" onClick={() => void reload()}>{t('retry')}</Button>}>
          {t('loadError')}
        </InlineAlert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label={t(view === 'history' ? 'base' : 'activeEmployees')}
          value={view === 'history' ? metricMoney(historyMonths.reduce((sum, month) => sum + month.base, 0)) : String(activeCount)}
          trendLabel={view !== 'history' && upcomingCount ? t('upcomingCount', { count: upcomingCount }) : undefined}
          icon={Users}
          loading={loading}
        />
        <MetricCard label={t('totalDue')} value={metricMoney(dueValue)} icon={Wallet} loading={loading} tone={dueValue > 0 ? 'warning' : 'default'} />
        <MetricCard label={t('totalPaid')} value={metricMoney(view === 'history' ? historyMonths.reduce((sum, month) => sum + month.paid, 0) : paid)} icon={Banknote} loading={loading} />
      </div>

      {view !== 'employees' && (
        <details className="group text-sm text-gray-700">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-[13px] font-semibold text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [&::-webkit-details-marker]:hidden [&>svg]:transition-transform group-open:[&>svg]:rotate-90">
            <ChevronRight size={16} aria-hidden="true" />
            {t('howItWorks')}
          </summary>
          <Card className="mt-2">
            <div className="space-y-2 leading-6 text-gray-600"><p>{t('baseHelp')}</p><p>{t('kpiHelp')}</p><p>{t('estimateHelp')}</p><p>{t('paymentHelp')}</p></div>
          </Card>
        </details>
      )}

      {!canEdit && <InlineAlert variant="info">{t('viewOnlyHelp')}</InlineAlert>}

      {canEdit && !isOwner && view === 'operations' && <InlineAlert variant="info">{t('ownerOnlySetupHelp')}</InlineAlert>}

      {canEdit && view === 'operations' && (
        <div className={cn('grid gap-5 xl:items-start', isOwner && 'xl:grid-cols-2')}>
          {renderForm('entry')}
          {isOwner && renderForm('employee')}
        </div>
      )}

      {view === 'employees' && loading && <EmployeeCardGridSkeleton />}

      {view === 'employees' && !loading && !loadError && data.employees.length === 0 && (
        <Card><EmptyState icon={Users} title={t('emptyTitle')} description={t('emptyDescription')} /></Card>
      )}

      {view === 'employees' && !loading && !loadError && data.employees.length > 0 && (
        <>
          {liveEmployees.length > 0 && (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{liveEmployees.map(renderEmployeeCard)}</div>
          )}
          {inactiveEmployees.length > 0 && (
            <details className="group">
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-[13px] font-semibold text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [&::-webkit-details-marker]:hidden [&>svg]:transition-transform group-open:[&>svg]:rotate-90">
                <ChevronRight size={16} aria-hidden="true" />
                {t('deactivatedSection', { count: inactiveEmployees.length })}
              </summary>
              <div className="mt-3 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{inactiveEmployees.map(renderEmployeeCard)}</div>
            </details>
          )}
        </>
      )}

      {view === 'history' && loading && <TableSkeleton rows={6} columns={7} />}
      {view === 'history' && employeeId && !loading && !loadError && !historyEmployee && (
        <Card><EmptyState icon={Users} title={t('employeeNotFound')} /></Card>
      )}
      {view === 'history' && (historyEmployee || (!employeeId && !loading && !loadError)) && (
        <Card as="section" padding="lg">
          <div className="space-y-6">
            <div>
              <SectionHeading size="sm" title={t('monthlyBreakdown')} description={t('estimateHelp')} className="mb-3" />
              <DataTable
                bare
                dense
                minWidth={640}
                keyExtractor={(month) => month.month}
                data={[...historyMonths].reverse()}
                columns={[
                  { key: 'month', header: t('month'), render: (month) => formatYearMonth(month.month, locale) },
                  { key: 'base', header: t('base'), align: 'right', render: (month) => formatCurrency(month.base) },
                  { key: 'kpi', header: t('kpi'), align: 'right', render: (month) => formatCurrency(month.kpi) },
                  { key: 'bonus', header: t('bonus'), align: 'right', render: (month) => formatCurrency(month.bonus) },
                  { key: 'fine', header: t('fine'), align: 'right', render: (month) => formatCurrency(month.fine) },
                  { key: 'payment', header: t('payment'), align: 'right', render: (month) => formatCurrency(month.paid) },
                  { key: 'balance', header: t('balance'), align: 'right', render: (month) => <Money amount={month.balance} currency={null} signed className="font-semibold" /> },
                ]}
              />
            </div>
            <div>
              <SectionHeading size="sm" title={t('transactions')} className="mb-3" />
              <div className="space-y-2">
                {historyEntries.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)).map((entry) => (
                  <div key={entry.id} className={`flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 p-3 text-sm ${entry.deleted_at ? 'opacity-60' : ''}`}>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{employeePrefix(entry.employee_id)}{t(entry.kind)} · {formatDateOnly(entry.date, locale)}</p>
                      {entry.payment_method && <p className="mt-1 text-xs text-gray-500">{tc(`paymentMethods.${entry.payment_method}`)} · {tp(`paymentSources.${entry.payment_source}`)}</p>}
                      {entry.comment && <p className="mt-1 break-words text-gray-500">{entry.comment}</p>}
                    </div>
                    <strong className={cn('tabular-nums', entry.kind === 'bonus' ? 'text-success-600' : entry.kind === 'fine' ? 'text-danger-600' : 'text-gray-900')}>{entry.kind === 'bonus' ? '+' : '−'}{currency(Number(entry.amount))}</strong>
                    {entry.deleted_at ? (
                      <Badge variant="neutral" size="sm">{t('deleted')} · {formatDateTime(entry.deleted_at, locale)}</Badge>
                    ) : canEdit && (
                      <Button variant="dangerOutline" size="sm" disabled={saving} onClick={() => { setDeleteError(''); setDeletion({ id: entry.id, kind: 'entry', label: `${employeePrefix(entry.employee_id)}${t(entry.kind)} · ${formatDateOnly(entry.date, locale)} · ${currency(Number(entry.amount))}` }); }}>
                        {t('delete')}
                      </Button>
                    )}
                  </div>
                ))}
                {historyEntries.length === 0 && <EmptyState compact bordered title={t('noTransactions')} />}
              </div>
            </div>
            <div>
              <SectionHeading size="sm" title={t('rateHistory')} className="mb-3" />
              {historyRates.length === 0 && <EmptyState compact bordered title={t('noRates')} />}
              <ul className="divide-y divide-gray-100">
                {historyRates.sort((a, b) => b.effective_date.localeCompare(a.effective_date)).map((rate) => {
                  const deletable = canDeleteSalaryRate(data.rates, rate);
                  return (
                    <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-gray-600" key={rate.id}>
                      <p className={rate.deleted_at ? 'line-through opacity-60' : ''}>
                        {employeePrefix(rate.employee_id)}{formatDateOnly(rate.effective_date, locale)} · {t(rate.salary_type)} · {currency(Number(rate.amount))} · {t('kpi')}: {Number(rate.kpi_percent)}% ({kpiSummary(rate)}) · {t(rate.active ? 'active' : 'inactive')}
                      </p>
                      {rate.deleted_at ? (
                        <Badge variant="neutral" size="sm">{t('deleted')} · {formatDateTime(rate.deleted_at, locale)}</Badge>
                      ) : isOwner && (
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            variant="dangerOutline"
                            size="sm"
                            disabled={saving || !deletable}
                            aria-describedby={!deletable ? `rate-delete-hint-${rate.id}` : undefined}
                            onClick={() => { setDeleteError(''); setDeletion({ id: rate.id, kind: 'rate', label: `${employeePrefix(rate.employee_id)}${formatDateOnly(rate.effective_date, locale)} · ${currency(Number(rate.amount))} · ${Number(rate.kpi_percent)}%` }); }}
                          >
                            {t('delete')}
                          </Button>
                          {!deletable && <p id={`rate-delete-hint-${rate.id}`} className="max-w-xs text-right text-xs text-gray-500">{t('lastRateHelp')}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <Modal
        open={Boolean(deletion) && canEdit}
        onClose={() => setDeletion(null)}
        locked={saving}
        title={t('deleteTitle')}
        size="sm"
        footer={(
          <>
            <Button variant="outline" disabled={saving} onClick={() => setDeletion(null)}>{tc('cancel')}</Button>
            <Button variant="danger" loading={savingTarget === 'delete'} loadingLabel={tc('saving')} onClick={() => void deleteRecord()}>{t('delete')}</Button>
          </>
        )}
      >
        <p className="mb-3 font-semibold">{deletion?.label}</p>
        <p className="text-sm leading-6 text-gray-600">{t(deletion?.kind === 'rate' ? 'deleteRateHelp' : 'deleteEntryHelp')}</p>
        {deleteError && <InlineAlert variant="danger" className="mt-4">{deleteError}</InlineAlert>}
      </Modal>

      {toastElement}
      {confirmDialog}
    </div>
  );
}
