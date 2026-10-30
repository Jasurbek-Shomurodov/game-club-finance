'use client';

import { useTranslations } from 'next-intl';
import type { SalaryEmployeeStatus, SalaryEntry, SalaryRate } from '@/lib/calculations/salaries';
import { formatCurrency } from '@/lib/formatters';
import { isSalaryErrorCode, type SalaryErrorCode } from '@/app/api/salaries/errors';
import { mutateFinanceRequest } from '@/lib/supabase/client';

export const employeeRoles = ['Manager', 'Admin', 'Cleaner'] as const;

export function knownEmployeeRole(value: string) {
  return employeeRoles.find((role) => role.toLowerCase() === value.trim().toLowerCase());
}

export type SetupMode = 'new' | 'salary' | 'kpi' | 'profile';
export type SalaryView = 'operations' | 'employees' | 'history';
export type EntryKind = SalaryEntry['kind'];
export type SavingTarget = 'entry' | 'employee' | 'deactivate' | 'delete';
export type DeletionTarget = { id: string; employeeId: string; kind: 'entry' | 'rate'; label: string };

/** Rate shown for an employee, the rate in force today, and the resulting status. */
export interface EmployeeRateSummary {
  current: SalaryRate | undefined;
  display: SalaryRate | undefined;
  status: SalaryEmployeeStatus;
}

export class SalaryRequestError extends Error {
  constructor(message: string, readonly code: SalaryErrorCode | null) {
    super(message);
  }
}

export async function postSalary(clubId: string, body: Record<string, unknown>) {
  // A salary write also inserts an expense; clear the browser read cache so the
  // page's reload and other screens see it instead of a cached response.
  const response = await mutateFinanceRequest('/api/salaries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubId, ...body }),
  });
  const payload = await response.json().catch(() => null) as { error?: string; code?: string | null } | null;
  if (!response.ok) {
    const code = isSalaryErrorCode(payload?.code) ? payload.code : response.status === 403 ? 'FORBIDDEN' : null;
    throw new SalaryRequestError(payload?.error ?? `HTTP ${response.status}`, code);
  }
}

const ERROR_KEYS: Record<Exclude<SalaryErrorCode, 'FORBIDDEN' | 'CHECK_FAILED' | 'SERVER_ERROR'>, string> = {
  UNAUTHORIZED: 'errors.unauthorized',
  INVALID_REQUEST: 'errors.invalidRequest',
  OWNER_ONLY: 'errors.ownerOnly',
  PAYMENT_METHOD_DISABLED: 'errors.paymentMethodDisabled',
  REQUEST_CONFLICT: 'errors.requestConflict',
  INVALID_DATE: 'errors.invalidDate',
  INVALID_VALUES: 'errors.invalidValues',
  NOT_FOUND: 'errors.notFound',
  SETTINGS_MISSING: 'errors.settingsMissing',
  LAST_RATE: 'errors.lastRate',
  DAY_COLLECTED: 'errors.dayCollected',
};

/** Translated labels and messages shared by the salary views. */
export function useSalaryText() {
  const t = useTranslations('salaries');
  const tc = useTranslations('common');
  return {
    roleLabel: (value: string) => {
      const known = knownEmployeeRole(value);
      return known ? t(`roles.${known}`) : value || t('noRole');
    },
    kpiSummary: (rate: Pick<SalaryRate, 'kpi_basis' | 'kpi_game_club' | 'kpi_bar'> | undefined) => {
      const pools = [(rate?.kpi_game_club ?? true) && t('poolGameClub'), (rate?.kpi_bar ?? true) && t('poolBar')].filter(Boolean).join(' + ');
      return `${t((rate?.kpi_basis ?? 'overall_profit') === 'owner_profit' ? 'kpiBasisOwnerShort' : 'kpiBasisOverallShort')} · ${pools}`;
    },
    currency: (value: number) => `${formatCurrency(value)} ${tc('currency')}`,
    /** Maps a stable API error code to a translated message; database text is never shown. */
    writeErrorMessage: (error: unknown) => {
      console.error('Salary write failed', error);
      const code = error instanceof SalaryRequestError ? error.code : null;
      if (code === 'FORBIDDEN') return t('permissionError');
      if (code === 'CHECK_FAILED') return t('checkError');
      if (code && code !== 'SERVER_ERROR') return t(ERROR_KEYS[code]);
      return t('saveError');
    },
  };
}
