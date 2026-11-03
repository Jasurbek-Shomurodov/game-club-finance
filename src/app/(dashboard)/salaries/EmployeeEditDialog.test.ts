import { describe, expect, it } from 'vitest';
import type { SalaryEmployee, SalaryRate } from '@/lib/calculations/salaries';
import { employeeEditChanges, employeeEditState, withEditDate, withLandedEmployeeChange } from './EmployeeEditDialog';

const employee: SalaryEmployee = { id: 'one', club_id: 'club', name: 'Ali', job_title: 'Admin', joined_on: '2026-09-01' };
const rate: SalaryRate = { id: 'rate', employee_id: 'one', effective_date: '2026-09-01', salary_type: 'daily', amount: 100000, kpi_percent: 5, active: true };

describe('a partly saved employee edit', () => {
  const edit = { ...employeeEditState(employee, rate), role: 'Manager', amount: '150 000', salary_type: 'monthly', kpi: '7' };

  it('starts with every part changed', () => {
    expect(employeeEditChanges(edit)).toEqual({ role: true, salary: true, kpi: true });
  });

  it('retries only what did not land', () => {
    const roleLanded = withLandedEmployeeChange(edit, 'role');
    expect(employeeEditChanges(roleLanded)).toEqual({ role: false, salary: true, kpi: true });
    const salaryLanded = withLandedEmployeeChange(roleLanded, 'salary');
    expect(employeeEditChanges(salaryLanded)).toEqual({ role: false, salary: false, kpi: true });
    expect(employeeEditChanges(withLandedEmployeeChange(salaryLanded, 'kpi'))).toEqual({ role: false, salary: false, kpi: false });
  });

  it('keeps what the owner typed', () => {
    expect(withLandedEmployeeChange(edit, 'salary')).toMatchObject({ role: 'Manager', amount: '150 000', kpi: '7' });
  });

  it('keeps KPI settings of the same rate when the salary lands', () => {
    expect(withLandedEmployeeChange({ ...edit, rate: { ...rate, kpi_basis: 'owner_profit' } }, 'salary').rate?.kpi_basis).toBe('owner_profit');
  });
});

describe('choosing when an employee edit starts', () => {
  const later: SalaryRate = { ...rate, id: 'later', effective_date: '2026-10-01', amount: 200000, kpi_percent: 9 };
  const start = employeeEditState(employee, later, { rates: [rate, later], today: '2026-11-03' });

  it('defaults to today and compares against the rate in force on the chosen date', () => {
    expect(start.date).toBe('2026-11-03');
    const backdated = withEditDate(start, '2026-09-15');
    expect(backdated.rate?.id).toBe('rate');
    expect(backdated).toMatchObject({ amount: '100 000', kpi: '5' });
    expect(employeeEditChanges(backdated)).toEqual({ role: false, salary: false, kpi: false });
  });

  it('keeps what the owner already typed', () => {
    const backdated = withEditDate({ ...start, amount: '250 000' }, '2026-09-15');
    expect(backdated).toMatchObject({ amount: '250 000', kpi: '5' });
    expect(employeeEditChanges(backdated)).toEqual({ role: false, salary: true, kpi: false });
  });
});
