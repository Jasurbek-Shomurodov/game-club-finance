'use client';

import { useTranslations } from 'next-intl';
import { Check, History, Pencil, Power, Users, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  Disclosure,
  EmployeeCardGridSkeleton,
  EmptyState,
  Field,
  IconButton,
  Select,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { salaryBalance, type SalaryEmployee, type SalaryMonth } from '@/lib/calculations/salaries';
import { formatCurrency, formatDateOnly } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { employeeRoles, knownEmployeeRole, useSalaryText, type EmployeeRateSummary, type SavingTarget } from './shared';

export interface EmployeesViewProps {
  employees: SalaryEmployee[];
  summaries: Map<string, EmployeeRateSummary>;
  balances: Record<string, SalaryMonth[]>;
  loading: boolean;
  loadError: boolean;
  isOwner: boolean;
  savingTarget: SavingTarget | null;
  roleEdit: { id: string; role: string } | null;
  roleError: string;
  onRoleEditChange: (edit: { id: string; role: string } | null) => void;
  onSaveRole: () => void;
  onSetActive: (employee: SalaryEmployee, active: boolean) => void;
}

/** Employee cards: active and upcoming staff first, deactivated staff collapsed below. */
export function EmployeesView({ employees, summaries, loading, loadError, ...cardProps }: EmployeesViewProps) {
  const t = useTranslations('salaries');
  const tc = useTranslations('common');
  if (loading) return <EmployeeCardGridSkeleton />;
  if (loadError) return null;
  if (employees.length === 0) return <Card><EmptyState icon={Users} title={t('emptyTitle')} description={t('emptyDescription')} /></Card>;

  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
  const live = sorted.filter((employee) => summaries.get(employee.id)?.display?.active);
  const inactive = sorted.filter((employee) => !summaries.get(employee.id)?.display?.active);
  const inactiveDue = inactive.reduce((sum, employee) => sum + Math.max(0, salaryBalance(cardProps.balances[employee.id] ?? [])), 0);
  const card = (employee: SalaryEmployee) => <EmployeeCard key={employee.id} employee={employee} summary={summaries.get(employee.id)} {...cardProps} />;

  return (
    <>
      {live.length > 0 && <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{live.map(card)}</div>}
      {inactive.length > 0 && (
        <Disclosure
          summary={(
            <>
              {t('deactivatedSection', { count: inactive.length })}
              {inactiveDue > 0 && (
                <span className="font-semibold tabular-nums text-warning-600">
                  {t('deactivatedDue', { amount: `${formatCurrency(inactiveDue)} ${tc('currency')}` })}
                </span>
              )}
            </>
          )}
        >
          <div className="mt-3 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{inactive.map(card)}</div>
        </Disclosure>
      )}
    </>
  );
}

function EmployeeCard({
  employee, summary, balances, isOwner, savingTarget, roleEdit, roleError, onRoleEditChange, onSaveRole, onSetActive,
}: Omit<EmployeesViewProps, 'employees' | 'summaries' | 'loading' | 'loadError'> & { employee: SalaryEmployee; summary: EmployeeRateSummary | undefined }) {
  const t = useTranslations('salaries');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { roleLabel, kpiSummary, currency } = useSalaryText();
  const saving = savingTarget !== null;
  const rate = summary?.display;
  const status = summary?.status ?? 'inactive';
  const upcoming = status === 'upcoming';
  const balance = salaryBalance(balances[employee.id] ?? []);

  return (
    <Card as="article" padding="lg">
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
                onClick={() => onRoleEditChange({ id: employee.id, role: knownEmployeeRole(employee.job_title) ?? '' })}
              />
            )}
          </div>
        </div>
        <Badge variant={status === 'upcoming' ? 'info' : status === 'active' ? 'success' : 'neutral'}>{t(status)}</Badge>
      </div>
      {isOwner && roleEdit?.id === employee.id && (
        <Card as="form" tone="muted" padding="sm" className="mb-4" onSubmit={(event) => { event.preventDefault(); onSaveRole(); }}>
          <Field label={t('role')} htmlFor={`employee-role-${employee.id}`} error={roleError || undefined}>
            <div className="flex flex-wrap gap-2">
              <Select id={`employee-role-${employee.id}`} className="min-w-0 flex-1" required disabled={saving} value={roleEdit.role} onChange={(event) => onRoleEditChange({ ...roleEdit, role: event.target.value })}>
                <option value="">{t('selectRole')}</option>
                {employeeRoles.map((option) => <option key={option} value={option}>{t(`roles.${option}`)}</option>)}
              </Select>
              <IconButton type="submit" variant="soft" label={tc('save')} icon={<Check size={18} />} loading={savingTarget === 'role'} disabled={!roleEdit.role || (saving && savingTarget !== 'role')} />
              <IconButton label={tc('cancel')} icon={<X size={18} />} disabled={saving} onClick={() => onRoleEditChange(null)} />
            </div>
          </Field>
        </Card>
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
            {formatCurrency(Math.abs(balance))}
            <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{tc('currency')}</span>
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
            onClick={() => onSetActive(employee, !rate?.active)}
            icon={<Power size={16} aria-hidden="true" />}
          >
            {t(rate?.active ? 'deactivate' : 'activate')}
          </Button>
        )}
      </div>
    </Card>
  );
}
