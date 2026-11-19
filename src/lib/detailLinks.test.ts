import { describe, expect, it } from 'vitest';
import {
  closingStockHref,
  dailyReportHref,
  dayRange,
  employeeSalaryHref,
  moneyDetailLineHref,
  moneyDetailsHref,
  reportsHref,
  stockPurchaseHref,
} from './detailLinks';

const november = { from: '2026-11-01', to: '2026-11-30' };

describe('detail links', () => {
  it('opens each side’s money details for the period', () => {
    expect(moneyDetailsHref('game_club', november)).toBe('/game-club-money-details?from=2026-11-01&to=2026-11-30');
    expect(moneyDetailsHref('bar', dayRange('2026-11-05'))).toBe('/bar-money-details?from=2026-11-05&to=2026-11-05');
  });

  it('narrows reports to a category, the paying side and a tab', () => {
    expect(reportsHref(november)).toBe('/reports?from=2026-11-01&to=2026-11-30');
    expect(reportsHref(november, { category: 'expense:salary', source: 'bar' }))
      .toBe('/reports?from=2026-11-01&to=2026-11-30&category=expense%3Asalary&source=bar');
    expect(reportsHref(november, { view: 'writeOffs', source: null })).toBe('/reports?from=2026-11-01&to=2026-11-30&view=writeOffs');
  });

  it('opens an employee\u2019s own salary page', () => {
    expect(employeeSalaryHref('emp-1')).toBe('/salaries/employees/emp-1');
  });

  it('opens a day in closing stock and the daily report', () => {
    expect(closingStockHref('2026-11-05')).toBe('/closing-stock?date=2026-11-05');
    expect(dailyReportHref('2026-11-05')).toBe('/daily-report?date=2026-11-05');
  });

  it('prefills the purchase form with the missing units', () => {
    expect(stockPurchaseHref({ id: 'cola', shortfall: 12 })).toBe('/stock-purchase?product=cola&quantity=12');
    expect(stockPurchaseHref({ id: 'cola', shortfall: 2.5 })).toBe('/stock-purchase?product=cola&quantity=3');
    expect(stockPurchaseHref({ id: 'cola', shortfall: 0 })).toBe('/stock-purchase?product=cola');
  });
});

describe('money details lines', () => {
  it('opens purchases and bar sales in closing stock', () => {
    expect(moneyDetailLineHref('bar', '2026-11-05', { kind: 'purchase' })).toBe('/closing-stock?date=2026-11-05');
    expect(moneyDetailLineHref('bar', '2026-11-05', { kind: 'collected', key: 'barSales' })).toBe('/closing-stock?date=2026-11-05');
  });

  it('opens expenses and income on that day in reports', () => {
    expect(moneyDetailLineHref('bar', '2026-11-05', { kind: 'expense', category: 'rent' }))
      .toBe('/reports?from=2026-11-05&to=2026-11-05&category=expense%3Arent&source=bar');
    expect(moneyDetailLineHref('game_club', '2026-11-05', { kind: 'collected', key: 'cash' }))
      .toBe('/reports?from=2026-11-05&to=2026-11-05&category=income');
    expect(moneyDetailLineHref('game_club', '2026-11-05', { kind: 'collected', key: 'debtPayments' }))
      .toBe('/reports?from=2026-11-05&to=2026-11-05&category=debt_payment');
  });
});
