import { describe, expect, it } from 'vitest';
import { buildSalaryNotification } from './salaryNotification';

const base = { addedBy: 'Owner', employee: 'Izzat' };

describe('buildSalaryNotification', () => {
  it('describes a salary payment with its source and method', () => {
    const text = buildSalaryNotification({ ...base, event: 'payment', amount: 150000, date: '2026-10-01', comment: 'аванс', paymentMethod: 'cash', paymentSource: 'bar' });
    expect(text).toContain('Выплата зарплаты');
    expect(text).toContain('Сотрудник: Izzat');
    expect(text).toContain('Источник: Бар');
    expect(text).toContain('Способ оплаты: Наличные');
    expect(text).toContain('Комментарий: аванс');
    expect(text.endsWith('Добавил(а): Owner')).toBe(true);
  });
  it('omits payment details for bonuses and fines', () => {
    expect(buildSalaryNotification({ ...base, event: 'bonus', amount: 1000, date: '2026-10-01', comment: null })).not.toContain('Источник');
    expect(buildSalaryNotification({ ...base, event: 'fine', amount: 1000, date: '2026-10-01', comment: null })).toContain('Штраф');
  });
  it('reports KPI, salary and activation changes', () => {
    const kpi = buildSalaryNotification({ ...base, event: 'kpi_changed', kpi: 5, kpiSettings: { basis: 'owner_profit', gameClub: false, bar: true } });
    expect(kpi).toContain('KPI: 5%');
    expect(kpi).toContain('Прибыль владельца');
    expect(kpi).toContain('Источник прибыли: Бар');
    expect(kpi).not.toContain('Игровой клуб');
    expect(buildSalaryNotification({ ...base, event: 'salary_changed', salaryType: 'monthly', amount: 3000000 })).toContain('Месячная зарплата');
    expect(buildSalaryNotification({ ...base, event: 'deactivated' })).toContain('деактивирован');
    expect(buildSalaryNotification({ ...base, event: 'activated' })).toContain('активирован');
  });
  it('announces a new employee with terms', () => {
    const text = buildSalaryNotification({ ...base, event: 'employee_added', role: 'Manager', salaryType: 'daily', amount: 100000, kpi: 3, kpiSettings: { basis: 'overall_profit', gameClub: true, bar: true }, date: '2026-10-01' });
    expect(text).toContain('Добавлен сотрудник');
    expect(text).toContain('Должность: Менеджер');
  });
  it('describes deleted payroll records', () => {
    const entry = buildSalaryNotification({ ...base, event: 'entry_deleted', kind: 'payment', amount: 500000, date: '2026-10-02', reason: 'Paid twice' });
    expect(entry).toContain('Удалена выплата зарплаты');
    expect(entry).toContain('Сумма: 500 000 сум');
    expect(entry).toContain('Причина: Paid twice');
    expect(buildSalaryNotification({ ...base, event: 'rate_deleted', effectiveDate: '2026-10-01', reason: 'Wrong rate' })).toContain('Удалено изменение зарплаты');
  });
});
