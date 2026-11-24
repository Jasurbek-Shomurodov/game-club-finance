import { describe, expect, it } from 'vitest';
import { buildSalaryNotification } from './salaryNotification';

const base = { addedBy: 'Owner', employee: 'Izzat' };
const TODAY = '2026-11-15';

describe('buildSalaryNotification', () => {
  it('describes a salary payment with its source, method, date and comment', () => {
    expect(buildSalaryNotification({ ...base, event: 'payment', amount: 150000, date: '2026-10-01', comment: 'аванс', paymentMethod: 'cash', paymentSource: 'bar' }).split('\n')).toEqual([
      '💵 Зарплата Izzat: 150 000 сум',
      'Бар · Наличные · 1 октября',
      'Owner: аванс',
    ]);
  });

  it('announces a "did not come" day without an amount', () => {
    expect(buildSalaryNotification({ ...base, event: 'absence', amount: 0, date: '2026-10-01', comment: null }).split('\n')[0]).toContain('Не пришёл(а) на работу');
    expect(buildSalaryNotification({ ...base, event: 'entry_deleted', kind: 'absence', amount: 0, date: '2026-10-01', reason: 'ошибка' }).split('\n')[0]).not.toContain(':');
  });
  it('gives bonuses and fines only their date', () => {
    expect(buildSalaryNotification({ ...base, event: 'bonus', amount: 1000, date: '2026-10-01', comment: null }).split('\n')).toEqual([
      '🎁 Премия Izzat: 1 000 сум', '1 октября', 'Owner',
    ]);
    expect(buildSalaryNotification({ ...base, event: 'fine', amount: 1000, date: '2026-10-01', comment: 'опоздание' })).toContain('⚠️ Штраф Izzat: 1 000 сум');
  });

  it('reports KPI, salary and activation changes with a date', () => {
    expect(buildSalaryNotification({ ...base, event: 'kpi_changed', kpi: 5, kpiSettings: { basis: 'owner_profit', gameClub: false, bar: true } }, TODAY).split('\n')).toEqual([
      '📈 Новый KPI: Izzat',
      'KPI 5% от прибыли владельца (выведенные деньги) · Бар · с 15 ноября',
      'Owner',
    ]);
    expect(buildSalaryNotification({ ...base, event: 'salary_changed', salaryType: 'monthly', amount: 3000000, date: '2026-10-01' }).split('\n')).toEqual([
      '💼 Новая зарплата: Izzat', '3 000 000 сум в месяц · с 1 октября', 'Owner',
    ]);
    expect(buildSalaryNotification({ ...base, event: 'deactivated' }, TODAY)).toBe('⏸ Сотрудник деактивирован: Izzat\nС 15 ноября\nOwner');
    expect(buildSalaryNotification({ ...base, event: 'activated', date: '2026-09-15' })).toContain('С 15 сентября');
  });

  it('announces a new job title, with the old one when there was one', () => {
    expect(buildSalaryNotification({ ...base, event: 'role_changed', role: 'Admin', previousRole: 'Cleaner' }, TODAY))
      .toBe('🏷 Новая должность: Izzat\nУборщик → Админ · 15 ноября\nOwner');
    expect(buildSalaryNotification({ ...base, event: 'role_changed', role: 'Кассир', previousRole: null }, TODAY))
      .toBe('🏷 Новая должность: Izzat\nКассир · 15 ноября\nOwner');
  });

  it('announces a new employee with terms', () => {
    expect(buildSalaryNotification({ ...base, event: 'employee_added', role: 'Manager', salaryType: 'daily', amount: 100000, kpi: 3, kpiSettings: { basis: 'overall_profit', gameClub: true, bar: true }, date: '2026-10-01' }).split('\n')).toEqual([
      '👤 Новый сотрудник: Izzat',
      'Менеджер · 100 000 сум в день · с 1 октября',
      'KPI 3% от общей прибыли (ежедневно) · Игровой клуб + Бар',
      'Owner',
    ]);
    expect(buildSalaryNotification({ ...base, event: 'employee_updated', role: '', salaryType: 'daily', amount: 1, kpi: 0, kpiSettings: { basis: 'game_club_income', gameClub: true, bar: false }, date: '2026-10-01' })).toContain('Без KPI');
  });

  it('describes deleted payroll records with the date and reason', () => {
    expect(buildSalaryNotification({ ...base, event: 'entry_deleted', kind: 'payment', amount: 500000, date: '2026-10-02', reason: 'Paid twice' }).split('\n')).toEqual([
      '🗑 Удалена зарплата Izzat: 500 000 сум', '2 октября · причина: Paid twice', 'Удалил(а) Owner',
    ]);
    expect(buildSalaryNotification({ ...base, event: 'rate_deleted', effectiveDate: '2026-10-01', reason: 'Wrong rate' })).toContain('Действовало с 1 октября · причина: Wrong rate');
    expect(buildSalaryNotification({ ...base, event: 'employee_deleted', reason: 'Left the club' }, TODAY)).toContain('15 ноября · причина: Left the club');
  });
});
