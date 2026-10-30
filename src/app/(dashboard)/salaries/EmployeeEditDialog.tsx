'use client';

import type { FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Checkbox,
  CurrencyInput,
  Field,
  InlineAlert,
  Input,
  Modal,
  SectionHeading,
  Select,
} from '@/components/PresentationFoundation';
import type { KpiBasis, SalaryEmployee, SalaryRate } from '@/lib/calculations/salaries';
import { formatCurrencyInput, parseCurrencyInput } from '@/lib/formatters';
import { employeeRoles, knownEmployeeRole } from './shared';

export interface EmployeeEditState {
  employee: SalaryEmployee;
  rate: SalaryRate | undefined;
  role: string;
  salary_type: string;
  amount: string;
  kpi: string;
  kpi_basis: KpiBasis;
  kpi_game_club: boolean;
  kpi_bar: boolean;
}

export function employeeEditState(employee: SalaryEmployee, rate: SalaryRate | undefined): EmployeeEditState {
  return {
    employee,
    rate,
    role: knownEmployeeRole(employee.job_title) ?? employee.job_title,
    salary_type: rate?.salary_type ?? 'daily',
    amount: formatCurrencyInput(Number(rate?.amount ?? 0)),
    kpi: String(Number(rate?.kpi_percent ?? 0)),
    kpi_basis: (rate?.kpi_basis ?? 'overall_profit') as KpiBasis,
    kpi_game_club: rate?.kpi_game_club ?? true,
    kpi_bar: rate?.kpi_bar ?? true,
  };
}

/** Which parts of the edit differ from what the employee has today; each is saved separately. */
export function employeeEditChanges(edit: EmployeeEditState) {
  const { employee, rate } = edit;
  return {
    role: edit.role.trim() !== (knownEmployeeRole(employee.job_title) ?? employee.job_title),
    salary: edit.salary_type !== (rate?.salary_type ?? 'daily') || parseCurrencyInput(edit.amount) !== Number(rate?.amount ?? 0),
    kpi: Number(edit.kpi) !== Number(rate?.kpi_percent ?? 0)
      || edit.kpi_basis !== (rate?.kpi_basis ?? 'overall_profit')
      || edit.kpi_game_club !== (rate?.kpi_game_club ?? true)
      || edit.kpi_bar !== (rate?.kpi_bar ?? true),
  };
}

/** Owner dialog behind the card's pencil: role, salary and KPI in one place. */
export function EmployeeEditDialog({ edit, saving, error, onChange, onClose, onSave }: {
  edit: EmployeeEditState | null;
  saving: boolean;
  error: string;
  onChange: (edit: EmployeeEditState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations('salaries');
  const tc = useTranslations('common');
  const changes = edit ? employeeEditChanges(edit) : null;
  const hasChanges = Boolean(changes && (changes.role || changes.salary || changes.kpi));
  const set = (patch: Partial<EmployeeEditState>) => edit && onChange({ ...edit, ...patch });
  const submit = (event: FormEvent) => { event.preventDefault(); if (hasChanges) onSave(); };

  return (
    <Modal
      open={edit !== null}
      onClose={onClose}
      locked={saving}
      title={edit ? `${t('editEmployeeTitle')} · ${edit.employee.name}` : t('editEmployeeTitle')}
      size="md"
      footer={(
        <>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{tc('cancel')}</Button>
          <Button type="submit" form="salary-employee-edit-form" loading={saving} loadingLabel={tc('saving')} disabled={!hasChanges}>{tc('save')}</Button>
        </>
      )}
    >
      {edit && (
        <form id="salary-employee-edit-form" onSubmit={submit} className="space-y-6">
          <fieldset disabled={saving} className="space-y-6">
            <section className="space-y-3">
              <Field label={t('role')} htmlFor="salary-edit-role" required>
                <Select id="salary-edit-role" required value={edit.role} onChange={(event) => set({ role: event.target.value })}>
                  <option value="">{t('selectRole')}</option>
                  {employeeRoles.map((option) => <option key={option} value={option}>{t(`roles.${option}`)}</option>)}
                  {edit.role && !knownEmployeeRole(edit.role) && <option value={edit.role}>{edit.role}</option>}
                </Select>
              </Field>
            </section>

            <section className="space-y-3 border-t border-gray-100 pt-5">
              <SectionHeading as="h3" size="sm" title={t('salarySection')} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('salaryType')} htmlFor="salary-edit-type">
                  <Select id="salary-edit-type" value={edit.salary_type} onChange={(event) => set({ salary_type: event.target.value })}>
                    <option value="daily">{t('daily')}</option>
                    <option value="monthly">{t('monthly')}</option>
                  </Select>
                </Field>
                <Field label={t('amount')} htmlFor="salary-edit-amount" hint={t('zeroBaseHelp')}>
                  <CurrencyInput id="salary-edit-amount" value={edit.amount} onValueChange={(amount) => set({ amount })} />
                </Field>
              </div>
            </section>

            <section className="space-y-3 border-t border-gray-100 pt-5">
              <SectionHeading as="h3" size="sm" title={t('kpi')} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('kpiPercent')} htmlFor="salary-edit-kpi">
                  <Input id="salary-edit-kpi" type="number" required min="0" max="100" step="0.01" inputMode="decimal" value={edit.kpi} onChange={(event) => set({ kpi: event.target.value })} onWheel={(event) => event.currentTarget.blur()} trailingAddon="%" />
                </Field>
                <Field label={t('kpiBasis')} htmlFor="salary-edit-kpi-basis" hint={t(edit.kpi_basis === 'owner_profit' ? 'kpiBasisOwnerHelp' : 'kpiBasisOverallHelp')}>
                  <Select id="salary-edit-kpi-basis" value={edit.kpi_basis} onChange={(event) => set({ kpi_basis: event.target.value as KpiBasis })}>
                    <option value="overall_profit">{t('kpiBasisOverall')}</option>
                    <option value="owner_profit">{t('kpiBasisOwner')}</option>
                  </Select>
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2" role="group" aria-label={t('kpiPools')}>
                <span className="text-sm font-medium text-gray-700">{t('kpiPools')}</span>
                <Checkbox label={t('poolGameClub')} checked={edit.kpi_game_club} onChange={(event) => set({ kpi_game_club: event.target.checked })} />
                <Checkbox label={t('poolBar')} checked={edit.kpi_bar} onChange={(event) => set({ kpi_bar: event.target.checked })} />
              </div>
            </section>

            <p className="text-xs leading-5 text-gray-500">{t('rateHelp')}</p>
          </fieldset>
          {error && <InlineAlert variant="danger">{error}</InlineAlert>}
        </form>
      )}
    </Modal>
  );
}
