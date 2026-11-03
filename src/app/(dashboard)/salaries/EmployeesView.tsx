'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Gamepad2, History, Pencil, Power, Trash2, Users, Wine } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  Disclosure,
  EmployeeCardGridSkeleton,
  EmptyState,
  IconButton,
  Modal,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { salaryBalance, salaryEarnings, type SalaryEmployee, type SalaryMonth } from '@/lib/calculations/salaries';
import { formatCurrency, formatDateOnly } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { useSalaryText, type EmployeeRateSummary, type SavingTarget } from './shared';

/** Payment source look, matching the Owner Profit cards: Game Club is the brand colour, Bar is orange. */
const PAYMENT_SOURCES = {
  game_club: { icon: Gamepad2, bubble: 'bg-primary-50 text-primary-600', bar: 'bg-primary-500' },
  bar: { icon: Wine, bubble: 'bg-orange-50 text-orange-600', bar: 'bg-orange-500' },
} as const;

export interface EmployeesViewProps {
  employees: SalaryEmployee[];
  summaries: Map<string, EmployeeRateSummary>;
  balances: Record<string, SalaryMonth[]>;
  /** Payments through today per employee, split by the profit source they came from. */
  paidBySource: Record<string, { game_club: number; bar: number }>;
  loading: boolean;
  loadError: boolean;
  isOwner: boolean;
  savingTarget: SavingTarget | null;
  onEdit: (employee: SalaryEmployee) => void;
  onSetActive: (employee: SalaryEmployee, active: boolean) => void;
  onDelete: (employee: SalaryEmployee) => void;
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
  employee, summary, balances, paidBySource, isOwner, savingTarget, onEdit, onSetActive, onDelete,
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
  const earnings = salaryEarnings(balances[employee.id] ?? []);
  const balanceLabel = t(balance < 0 ? 'advance' : 'balance');
  const [showBalance, setShowBalance] = useState(false);
  const paidSources = (['game_club', 'bar'] as const).map((source) => ({ source, amount: paidBySource[employee.id]?.[source] ?? 0 }));
  const breakdown: [string, string, string?][] = [
    [t('earnedBase'), currency(earnings.base)],
    [t('earnedKpi'), currency(earnings.kpi)],
    ...(earnings.bonus ? [[t('breakdownBonuses'), `+${currency(earnings.bonus)}`] as [string, string]] : []),
    ...(earnings.fine ? [[t('breakdownFines'), `−${currency(earnings.fine)}`, 'text-danger-600'] as [string, string, string]] : []),
  ];

  return (
    <Card as="article" padding="lg">
      <div className="mb-5 flex items-start gap-3">
        <Avatar name={employee.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold text-gray-950">{employee.name}</h2>
          <div className="mt-0.5 flex items-center gap-1 text-sm text-gray-500">
            <span className="break-words">{roleLabel(employee.job_title)}</span>
            {isOwner && (
              <IconButton
                variant="ghost"
                size="sm"
                label={`${t('editEmployeeTitle')} · ${employee.name}`}
                icon={<Pencil size={15} />}
                disabled={saving}
                onClick={() => onEdit(employee)}
              />
            )}
          </div>
        </div>
        <Badge variant={status === 'upcoming' ? 'info' : status === 'active' ? 'success' : 'neutral'}>{t(status)}</Badge>
      </div>
      <dl className="divide-y divide-gray-100 text-sm">
        {[
          [t(upcoming ? 'startsOn' : 'joined'), formatDateOnly(employee.joined_on, locale)],
          [t(rate?.salary_type ?? 'daily'), currency(Number(rate?.amount ?? 0))],
          [t('kpi'), `${Number(rate?.kpi_percent ?? 0)}%`],
          [t('kpiBasis'), kpiSummary(rate)],
          ...(summary?.deactivatesOn ? [[t('deactivatesOn'), formatDateOnly(summary.deactivatesOn, locale)]] : []),
          ...(summary?.deactivatedFrom ? [[t('deactivatedFrom'), formatDateOnly(summary.deactivatedFrom, locale)]] : []),
          [t('earnedBase'), currency(earnings.base)],
          [t('earnedKpi'), currency(earnings.kpi)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-gray-500">{label}</dt>
            <dd className="text-right font-semibold tabular-nums text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-gray-100 pt-3 text-sm">
        <button
          type="button"
          onClick={() => setShowBalance(true)}
          aria-haspopup="dialog"
          className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-4 rounded-lg px-2 py-1 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <span className="flex items-center gap-1 text-gray-500">{balanceLabel}<ChevronRight size={14} aria-hidden="true" /><span className="sr-only">{t('balanceDetailsHint', { label: balanceLabel })}</span></span>
          <span className={cn('text-right text-xl font-bold tracking-tight tabular-nums', balance > 0 ? 'text-warning-600' : 'text-gray-950')}>
            {formatCurrency(Math.abs(balance))}
            <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{tc('currency')}</span>
          </span>
        </button>
      </div>
      <Modal open={showBalance} onClose={() => setShowBalance(false)} title={`${balanceLabel} · ${employee.name}`} size="md">
        <p className="text-sm leading-6 text-gray-700">
          {t(balance < 0 ? 'advanceExplain' : balance > 0 ? 'balanceExplain' : 'settledExplain', { name: employee.name })}
        </p>
        <h3 className="mt-5 text-sm font-semibold text-gray-900">{t('paidBySource')}</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {paidSources.map(({ source, amount }) => {
            const { icon: SourceIcon, bubble, bar } = PAYMENT_SOURCES[source];
            const share = earnings.paid > 0 ? Math.round((amount / earnings.paid) * 100) : 0;
            return (
              <div key={source} className="min-w-0 rounded-2xl border border-gray-100 bg-gray-50/40 p-4">
                <div className="flex items-center gap-2.5">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', bubble)}>
                    <SourceIcon size={16} aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold text-gray-900">{t(source === 'bar' ? 'poolBar' : 'poolGameClub')}</p>
                </div>
                <p className="mt-3 break-words text-2xl font-bold leading-none tracking-tight tabular-nums text-gray-950">
                  {formatCurrency(amount)}
                  <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{tc('currency')}</span>
                </p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                  <div className={cn('h-full rounded-full', bar)} style={{ width: `${share}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-gray-500">{t('paidShare', { percent: share })}</p>
              </div>
            );
          })}
        </div>
        <h3 className="mt-5 text-sm font-semibold text-gray-900">{t('balanceDetails')}</h3>
        <dl className="mt-1 divide-y divide-gray-100 text-sm">
          {breakdown.map(([label, value, tone]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-gray-500">{label}</dt>
              <dd className={cn('text-right font-semibold tabular-nums text-gray-900', tone)}>{value}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 py-2">
            <dt className="font-medium text-gray-700">{t('breakdownEarned')}</dt>
            <dd className="text-right font-semibold tabular-nums text-gray-950">{currency(earnings.earned)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2">
            <dt className="text-gray-500">{t('breakdownPaid')}</dt>
            <dd className="text-right font-semibold tabular-nums text-gray-900">−{currency(earnings.paid)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 pt-3">
            <dt className="font-semibold text-gray-950">{balanceLabel}</dt>
            <dd className={cn('text-right text-lg font-bold tabular-nums', balance > 0 ? 'text-warning-600' : 'text-gray-950')}>{currency(Math.abs(balance))}</dd>
          </div>
        </dl>
      </Modal>
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
        {isOwner && status === 'inactive' && (
          <Button variant="dangerOutline" size="sm" disabled={saving} onClick={() => onDelete(employee)} icon={<Trash2 size={16} aria-hidden="true" />}>
            {t('delete')}
          </Button>
        )}
      </div>
    </Card>
  );
}
