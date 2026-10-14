'use client';

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  Card,
  Checkbox,
  CurrencyInput,
  DatePicker,
  Field,
  InlineAlert,
  Input,
  SectionHeading,
  SegmentedControl,
  Select,
  StatTile,
  Textarea,
} from '@/components/PresentationFoundation';
import { salaryBalance, type KpiBasis, type SalaryEmployee, type SalaryMonth } from '@/lib/calculations/salaries';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { EntryPaymentMethod } from '@/types';
import { employeeRoles, knownEmployeeRole, useSalaryText, type EntryKind, type SavingTarget, type SetupMode } from './shared';

export interface EmployeeFormState {
  id: string;
  name: string;
  job_title: string;
  date: string;
  salary_type: string;
  amount: string;
  kpi: string;
  kpi_basis: KpiBasis;
  kpi_game_club: boolean;
  kpi_bar: boolean;
  active: boolean;
}

export interface EntryFormState {
  id: string;
  kind: EntryKind;
  amount: string;
  date: string;
  comment: string;
  payment_method: EntryPaymentMethod;
  payment_source: string;
}

export type FormDialog = 'entry' | 'employee';

export interface OperationsFormsProps {
  employees: SalaryEmployee[];
  balances: Record<string, SalaryMonth[]>;
  today: string;
  isOwner: boolean;
  loading: boolean;
  loadError: boolean;
  savingTarget: SavingTarget | null;
  setupMode: SetupMode;
  entrySelected: SalaryEmployee | null;
  selectedEmployee: SalaryEmployee | null;
  employeeForm: EmployeeFormState;
  setEmployeeForm: Dispatch<SetStateAction<EmployeeFormState>>;
  entryForm: EntryFormState;
  setEntryForm: Dispatch<SetStateAction<EntryFormState>>;
  entryError: string;
  employeeError: string;
  onSetupModeChange: (mode: SetupMode) => void;
  onSelectSetupEmployee: (employee: SalaryEmployee | null) => void;
  onOpenEntry: (employee: SalaryEmployee | null, kind: EntryKind) => void;
  onSubmit: (event: FormEvent, dialog: FormDialog) => void;
}

/** Payment/bonus/fine form for salary editors, and the employee setup form for owners. */
export function OperationsForms(props: OperationsFormsProps) {
  const { isOwner } = props;
  return (
    <div className={cn('grid gap-5 xl:items-start', isOwner && 'xl:grid-cols-2')}>
      <OperationForm {...props} dialog="entry" />
      {isOwner && <OperationForm {...props} dialog="employee" />}
    </div>
  );
}

function OperationForm({
  dialog, employees, balances, today, loading, loadError, savingTarget, setupMode, entrySelected, selectedEmployee,
  employeeForm, setEmployeeForm, entryForm, setEntryForm, entryError, employeeError,
  onSetupModeChange, onSelectSetupEmployee, onOpenEntry, onSubmit,
}: OperationsFormsProps & { dialog: FormDialog }) {
  const t = useTranslations('salaries');
  const tc = useTranslations('common');
  const tp = useTranslations('expenses');
  const { enabledPaymentMethods } = useClub();
  const { roleLabel } = useSalaryText();
  const saving = savingTarget !== null;
  const selected = dialog === 'entry' ? entrySelected : selectedEmployee;
  const formDisabled = savingTarget === dialog || loading || loadError;
  const formError = dialog === 'entry' ? entryError : employeeError;
  const setupModeOptions = (['new', 'salary', 'kpi', 'profile'] as const).map((mode) => ({
    value: mode,
    label: t(mode === 'new' ? 'addEmployee' : mode === 'salary' ? 'changeSalary' : mode === 'kpi' ? 'changeKpi' : 'editEmployee'),
  }));
  const entryKindOptions = (['payment', 'bonus', 'fine'] as const).map((kind) => ({ value: kind, label: t(kind) }));
  const title = dialog === 'entry'
    ? t('recordOperations')
    : t(setupMode === 'new' ? 'addEmployee' : setupMode === 'salary' ? 'changeSalary' : setupMode === 'kpi' ? 'changeKpi' : 'editEmployee');

  function renderEmployeeSelect() {
    return (
      <Field label={t('employee')} htmlFor={`salary-${dialog}-employee`} required className="sm:col-span-2">
        <Select
          id={`salary-${dialog}-employee`}
          required
          value={selected?.id ?? ''}
          onChange={(event) => {
            const employee = employees.find((e) => e.id === event.target.value) ?? null;
            if (dialog === 'entry') onOpenEntry(employee, entryForm.kind);
            else onSelectSetupEmployee(employee);
          }}
        >
          <option value="">{t('selectEmployee')}</option>
          {employees.filter((e) => dialog !== 'entry' || e.joined_on <= today).map((employee) => (
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

  function renderEntryFields() {
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
          disabled={formDisabled}
          onChange={onSetupModeChange}
        />
      )}
      <form onSubmit={(event) => onSubmit(event, dialog)} className="space-y-4">
        <fieldset disabled={formDisabled} className="grid gap-4 sm:grid-cols-2">
          {dialog === 'entry' && (
            <div className="sm:col-span-2">
              <SegmentedControl
                variant="soft"
                label={t('entryType')}
                options={entryKindOptions}
                value={entryForm.kind}
                onChange={(kind) => onOpenEntry(selected, kind)}
              />
              <p className="mt-2 text-xs leading-5 text-gray-500">{t(`${entryForm.kind}Hint`)}</p>
            </div>
          )}
          {(dialog === 'entry' || setupMode !== 'new') && renderEmployeeSelect()}
          {dialog === 'employee' ? renderEmployeeFields() : renderEntryFields()}
        </fieldset>
        {formError && <InlineAlert variant="danger">{formError}</InlineAlert>}
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
