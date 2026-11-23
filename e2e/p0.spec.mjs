// P0 cases from .claude/skills/qa/references/cases.md, run in a browser on the fixed fixture (e2e/fixture.mjs)
// against the app's own schema, RLS and RPCs in PGlite (e2e/fake-supabase.mjs). Each test names its catalog cases.
// Expected figures are worked out from the fixture, never read off the screen.
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { test, expect } from '@playwright/test';
import { englishCookie, expectDashboardAmount, expectGameClubExpenses, open, openCommandPalette, pageText, resetDatabase, restAs, signIn, uzs, openTab } from './helpers.mjs';
import { clubs, dailyCash, debts, expected, expenses, products, purchase, today } from './fixture.mjs';
import { accounts, pendingAccount, storageStatePath } from './settings.mjs';

test.beforeEach(async () => { await resetDatabase(); });

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [{ name: englishCookie.name, value: englishCookie.value, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] } });

  test('AUTH-001 a visitor is sent to /login with no club data, and signing in opens the dashboard', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const leaked = [];
    page.on('response', async response => {
      if (!response.url().includes('/rest/v1/')) return;
      const body = await response.text().catch(() => '');
      if (body.includes(clubs.arcade.id)) leaked.push(response.url());
    });
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/debts');
    await expect(page).toHaveURL(/\/login\?next=%2Fdebts$/);
    expect(await page.content()).not.toContain('E2E Alibek');
    await signIn(page, accounts.owner);
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(leaked).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test('DASH-001 the dashboard headline figures equal the fixture arithmetic', async ({ page }) => {
  await page.goto('/');
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome);
  await expectDashboardAmount(page, 'Game Club Net Profit', expected.gameClubNetProfit);
  await expectGameClubExpenses(page, expected.gameClubExpenses);
  // Profit counts new debts as income; money left counts only cash collected, including debt payments.
  await expectDashboardAmount(page, 'Total Money Left', expected.gameClubMoneyLeft);
  await expectDashboardAmount(page, 'Active Debts', expected.activeDebts);
  await expectDashboardAmount(page, 'Bar Sales', expected.barSales);
  // Accounting profit and cash left are different numbers: bar money left deducts the purchase, not the cost of goods.
  await expectDashboardAmount(page, 'Bar Money Left', expected.barSales - expected.stockPurchaseCost);
  await expectDashboardAmount(page, 'Bar Net Profit', expected.barNetProfit);
});

test('INC-001 XAPP-001 editing the day\'s cash entry moves every game club total once', async ({ page }) => {
  await page.goto('/daily-cash');
  await expect(page.getByRole('heading', { name: 'Daily Cash Entry', level: 1 })).toBeVisible();
  const cash = page.locator('#daily-cash-cash_income');
  await expect(cash).toHaveValue(uzs(dailyCash.arcade.cash_income));
  await cash.fill(String(dailyCash.arcade.cash_income + 100_000));
  await expect(cash).toHaveValue(uzs(dailyCash.arcade.cash_income + 100_000));
  const writes = [];
  // A correction goes through /api/daily-cash so the club group is told; nothing writes the table from the browser.
  page.on('request', request => {
    if (['POST', 'PATCH'].includes(request.method()) && (request.url().includes('/rest/v1/daily_cash_entries') || request.url().endsWith('/api/daily-cash'))) writes.push(`${request.method()} ${request.url()}`);
  });
  await page.getByRole('button', { name: 'Save Entry' }).click();
  await expect(page.getByText('Entry updated.')).toBeVisible();
  expect(writes).toEqual([expect.stringMatching(/^PATCH .*\/api\/daily-cash$/)]);
  await open(page, 'Dashboard');
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome + 100_000);
  await expectDashboardAmount(page, 'Game Club Net Profit', expected.gameClubNetProfit + 100_000);
  await expectDashboardAmount(page, 'Total Money Left', expected.gameClubMoneyLeft + 100_000);
  await expectGameClubExpenses(page, expected.gameClubExpenses);
});

test('EXP-001 XAPP-001 an expense saves once and lowers net profit by its amount', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Register Expense' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register Expense' });
  await dialog.locator('#expense-amount').fill('25000');
  await expect(dialog.locator('#expense-amount')).toHaveValue('25 000');
  await dialog.locator('#expense-category').selectOption('cleaning');
  const posts = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/expenses')) posts.push(request.url()); });
  // A note of fewer than 3 words is refused with a popup, before any request.
  await dialog.locator('#expense-comment').fill('cleaning');
  await dialog.getByRole('button', { name: 'Save Expense' }).click();
  const notePopup = page.getByRole('dialog', { name: 'Please add a note' });
  await expect(notePopup).toContainText('So far: 1 of 3 words.');
  await notePopup.getByRole('button', { name: 'Write the note' }).click();
  await expect(dialog.getByText('Write at least 3 words (1 of 3)')).toBeVisible();
  expect(posts).toHaveLength(0);
  await dialog.locator('#expense-comment').fill('Cleaning service for both halls');
  await dialog.getByRole('button', { name: 'Save Expense' }).click();
  await expect(page.getByText('Expense registered successfully.')).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(posts).toHaveLength(1);
  const rows = await (await restAs(accounts.owner, 'GET', `expenses?select=amount,category,payment_source&club_id=eq.${clubs.arcade.id}&date=eq.${today}&order=created_at.asc`)).json();
  expect(rows).toHaveLength(expenses.length + 1);
  expect(rows.at(-1)).toEqual({ amount: 25000, category: 'cleaning', payment_source: 'game_club' });
  await open(page, 'Dashboard');
  await expectGameClubExpenses(page, expected.gameClubExpenses + 25_000);
  await expectDashboardAmount(page, 'Game Club Net Profit', expected.gameClubNetProfit - 25_000);
  await expectDashboardAmount(page, 'Total Money Left', expected.gameClubMoneyLeft - 25_000);
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome);
});

test('EXP-010 a Game Club expense can be paid from PlayStation money, a Bar expense cannot', async ({ page }) => {
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Register Expense' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register Expense' });
  await dialog.locator('#expense-amount').fill('25000');
  const playstation = dialog.getByRole('radio', { name: 'PlayStation' });
  await playstation.click();
  await expect(playstation).toHaveAttribute('aria-checked', 'true');
  // Bar money has no PlayStation method, so the choice falls back to the club's default.
  await dialog.getByRole('radio', { name: 'Bar Money' }).click();
  await expect(playstation).toBeHidden();
  // Bar money pays only for cleaning and food/drinks.
  await expect(dialog.locator('#expense-category option:not([disabled])')).toHaveText(['Cleaning', 'Food / Drinks']);
  await dialog.getByRole('radio', { name: 'Game Club Money' }).click();
  await playstation.click();
  // No category yet: the expense cannot be saved.
  await expect(dialog.getByRole('button', { name: 'Save Expense' })).toBeDisabled();
  await dialog.locator('#expense-category').selectOption('repair');
  await dialog.locator('#expense-comment').fill('New controller for the console');
  await dialog.getByRole('button', { name: 'Save Expense' }).click();
  await expect(page.getByText('Expense registered successfully.')).toBeVisible();
  const rows = await (await restAs(accounts.owner, 'GET', `expenses?select=amount,payment_method,payment_source&club_id=eq.${clubs.arcade.id}&date=eq.${today}&order=created_at.asc`)).json();
  expect(rows.at(-1)).toEqual({ amount: 25000, payment_method: 'playstation', payment_source: 'game_club' });
  await open(page, 'Dashboard');
  await expectGameClubExpenses(page, expected.gameClubExpenses + 25_000);
});

test('EXP-011 an expense can be paid from the reserve US dollars at an entered rate, up to the dollars held', async ({ page }) => {
  const bought = await restAs(accounts.owner, 'POST', 'rpc/record_money_exchange', {
    p_id: crypto.randomUUID(), p_club_id: clubs.arcade.id, p_date: today, p_from_method: 'cash', p_to_method: 'usd',
    p_from_amount: 1_000_000, p_rate: 12_500, p_comment: 'Cash moved into dollars for parts',
  });
  expect(bought.ok).toBe(true);
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Register Expense' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register Expense' });
  // Dollars are the reserve's own money, apart from Game Club and Bar: only the reserve offers them.
  await expect(dialog.getByRole('radio', { name: /US dollars/ })).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'Reserve', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: /UZS/ })).toBeVisible();
  const dollars = dialog.getByRole('radio', { name: /US dollars/ });
  await expect(dollars).toContainText('$80');
  await dollars.click();
  // The rate starts from the latest exchange.
  await expect(dialog.locator('#expense-usd-rate')).toHaveValue(/12\s?500/);
  await dialog.locator('#expense-amount').fill('100');
  await expect(dialog.getByText('Only $80 is left in this payment method.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save Expense' })).toBeDisabled();
  await dialog.locator('#expense-amount').fill('20');
  await dialog.locator('#expense-usd-rate').fill('12600');
  await expect(dialog.getByText('Recorded as 252 000 UZS in expenses')).toBeVisible();
  await dialog.locator('#expense-category').selectOption('repair');
  await dialog.locator('#expense-comment').fill('Spare parts bought abroad in dollars');
  await dialog.getByRole('button', { name: 'Save Expense' }).click();
  await expect(page.getByText('Expense registered successfully.')).toBeVisible();
  const rows = await (await restAs(accounts.owner, 'GET', `expenses?select=amount,payment_method,usd_amount,usd_rate&club_id=eq.${clubs.arcade.id}&date=eq.${today}&order=created_at.asc`)).json();
  expect(rows.at(-1)).toEqual({ amount: 252000, payment_method: 'usd', usd_amount: 20, usd_rate: 12600 });
});

test('EXP-008 a planned expense is set up in Settings, picked in the expense form and compared in Financial analysis', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Add planned expense' }).click();
  const presetDialog = page.getByRole('dialog', { name: 'Add planned expense' });
  await presetDialog.locator('#expense-preset-name').fill('iCafe');
  await presetDialog.locator('#expense-preset-category').selectOption('equipment');
  await presetDialog.getByRole('radio', { name: 'Cash' }).click();
  await presetDialog.locator('#expense-preset-amount').fill('500000');
  await expect(presetDialog.locator('#expense-preset-amount')).toHaveValue('500 000');
  await presetDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Planned expense saved')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Planned expenses' }).getByText('iCafe')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Planned expenses' }).getByText('Cash')).toBeVisible();

  await page.goto('/reports');
  await page.getByRole('button', { name: 'Register Expense' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register Expense' });
  await dialog.getByRole('radio', { name: 'iCafe' }).click();
  await expect(dialog.locator('#expense-category')).toHaveValue('equipment');
  await expect(dialog.locator('#expense-category')).toBeDisabled();
  // The plan's usual method is preselected.
  await expect(dialog.getByRole('radio', { name: 'Cash' })).toBeChecked();
  await expect(dialog.locator('#expense-amount')).toHaveAttribute('placeholder', uzs(500_000));
  await dialog.locator('#expense-amount').fill('650000');
  await dialog.locator('#expense-comment').fill('New iCafe licence for all computers');
  await dialog.getByRole('button', { name: 'Save Expense' }).click();
  await expect(page.getByText('Expense registered successfully.')).toBeVisible();
  const [linked] = await (await restAs(accounts.owner, 'GET', `expenses?select=amount,category,preset_id&club_id=eq.${clubs.arcade.id}&preset_id=not.is.null`)).json();
  expect(linked).toMatchObject({ amount: 650000, category: 'equipment' });

  const month = today.slice(0, 7);
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  await page.goto(`/financial-analysis?from=${month}-01&to=${month}-${lastDay}`);
  const plan = page.getByRole('region', { name: 'Game Club' }).filter({ hasText: 'iCafe' });
  await expect(plan).toContainText(`${uzs(650_000)} of ${uzs(500_000)}`);
  await expect(plan).toContainText(`+${uzs(150_000)}`);

  // With a payment linked, the plan keeps its category and money source (093); the amount stays editable.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Edit iCafe' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit planned expense' });
  await expect(editDialog.locator('#expense-preset-category')).toBeDisabled();
  await expect(editDialog.locator('#expense-preset-amount')).toBeEnabled();
});

test('EXP-009 an owner moves an expense to another date from Entry details', async ({ page }) => {
  const [cleaning] = expenses;
  // The 1st of this month, or of last month when today is the 1st; never after today.
  const [year, month, day] = today.split('-').map(Number);
  const target = day > 1 ? `${today.slice(0, 7)}-01` : new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  const targetLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${target}T00:00:00Z`));
  await page.goto('/reports');
  await page.getByText(cleaning.comment).click();
  const details = page.getByRole('dialog', { name: 'Entry details' });
  await details.getByRole('button', { name: 'Date', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: 'Select date' });
  if (day === 1) await calendar.getByRole('button', { name: 'Previous month' }).click();
  await calendar.getByRole('button', { name: targetLabel, exact: true }).click();
  // The fixture's cash arrives today: on the target date there is none yet, and a
  // method never goes negative on any day (146), so the move is refused.
  await expect(details.getByRole('alert')).toHaveText('This payment method does not hold enough money for this expense.');
  let [row] = await (await restAs(accounts.owner, 'GET', `expenses?select=date&id=eq.${cleaning.id}`)).json();
  expect(row.date).toBe(today);

  // With the target day's own cash collected, the same move goes through.
  expect((await restAs(accounts.owner, 'POST', 'daily_cash_entries', {
    club_id: clubs.arcade.id, date: target, cash_income: cleaning.amount, terminal_income: 0, card_income: 0, playstation_income: 0,
  })).ok).toBe(true);
  await details.getByRole('button', { name: 'Date', exact: true }).click();
  if (day === 1) await calendar.getByRole('button', { name: 'Previous month' }).click();
  await calendar.getByRole('button', { name: targetLabel, exact: true }).click();
  await expect(page.getByText('Date changed')).toBeVisible();
  [row] = await (await restAs(accounts.owner, 'GET', `expenses?select=date&id=eq.${cleaning.id}`)).json();
  expect(row.date).toBe(target);
});

test('EXP-012 an owner moves an expense to another category from Entry details', async ({ page }) => {
  const [cleaning] = expenses;
  await page.goto('/reports');
  await page.getByText(cleaning.comment).click();
  const details = page.getByRole('dialog', { name: 'Entry details' });
  await details.getByRole('combobox', { name: 'Category' }).selectOption('marketing');
  await expect(page.getByText('Category changed')).toBeVisible();
  const [row] = await (await restAs(accounts.owner, 'GET', `expenses?select=category&id=eq.${cleaning.id}`)).json();
  expect(row.category).toBe('marketing');
});

test('EXP-014 an owner changes a salary payment\'s method from Entry details', async ({ page }) => {
  const employee = crypto.randomUUID();
  const entry = crypto.randomUUID();
  expect((await restAs(accounts.owner, 'POST', 'rpc/save_salary_employee', {
    p_club_id: clubs.arcade.id, p_employee_id: employee, p_name: 'E2E Izzat', p_job_title: '',
    p_effective_date: today, p_salary_type: 'daily', p_amount: 100000, p_kpi_percent: 0, p_active: true,
  })).ok).toBe(true);
  expect((await restAs(accounts.owner, 'POST', 'rpc/record_salary_entry_with_status', {
    p_club_id: clubs.arcade.id, p_employee_id: employee, p_request_id: entry, p_date: today,
    p_kind: 'payment', p_amount: 50000, p_comment: '', p_payment_method: 'cash', p_payment_source: 'game_club',
  })).ok).toBe(true);
  await page.goto('/reports');
  await page.getByText('E2E Izzat').click();
  const details = page.getByRole('dialog', { name: 'Entry details' });
  await expect(details.getByRole('combobox', { name: 'Category' })).toHaveCount(0);
  await details.getByRole('combobox', { name: 'Payment method' }).selectOption('terminal');
  await expect(page.getByText('Payment method updated')).toBeVisible();
  const [salary] = await (await restAs(accounts.owner, 'GET', `salary_entries?select=payment_method&id=eq.${entry}`)).json();
  const [expense] = await (await restAs(accounts.owner, 'GET', `expenses?select=payment_method&salary_entry_id=eq.${entry}`)).json();
  expect([salary.payment_method, expense.payment_method]).toEqual(['terminal', 'terminal']);
});

test('EXP-013 an owner deletes an expense from the Reports list', async ({ page }) => {
  const [cleaning] = expenses;
  await page.goto('/reports');
  await page.getByRole('button', { name: /^Delete: Cleaning · / }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete' });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/entry deleted/i)).toBeVisible();
  await expect(page.getByText(cleaning.comment)).toHaveCount(0);
  expect(await (await restAs(accounts.owner, 'GET', `expenses?select=id&id=eq.${cleaning.id}`)).json()).toEqual([]);
});

test('HIST-001 a deleted expense stays readable in the owner\'s edit history', async ({ page }) => {
  const [cleaning] = expenses;
  const deleted = await restAs(accounts.owner, 'DELETE', `expenses?id=eq.${cleaning.id}&club_id=eq.${clubs.arcade.id}`);
  expect(await deleted.json()).toHaveLength(1);
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'Edit history', level: 1 })).toBeVisible();
  const entry = page.getByRole('listitem').filter({ hasText: cleaning.comment });
  await expect(entry).toContainText('Deleted');
  await expect(entry).toContainText('Expense');
  await expect(entry).toContainText(uzs(cleaning.amount));
  await expect(entry).toContainText(accounts.owner.name);
  // The history is append-only: not even the owner can erase it through the API.
  await restAs(accounts.owner, 'DELETE', `entry_audit_logs?club_id=eq.${clubs.arcade.id}`);
  expect(await (await restAs(accounts.owner, 'GET', `entry_audit_logs?select=id&club_id=eq.${clubs.arcade.id}`)).json()).toHaveLength(1);
});

test('DASH-009 a payment in a money-flow category opens its details, from the list and from the chart', async ({ page }) => {
  const [cleaning] = expenses;
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open Cleaning' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Cleaning' });
  // From the Payments list: the payment's details, then Back to the category.
  await dialog.getByRole('listitem').getByRole('button', { name: new RegExp(cleaning.comment) }).click();
  await expect(dialog.getByText('Date and time')).toBeVisible();
  await expect(dialog.getByText(cleaning.comment)).toBeVisible();
  await expect(dialog.getByText(uzs(cleaning.amount))).toBeVisible();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog.getByText('Payments')).toBeVisible();
  // From the chart: the comment's flow opens the same details.
  await dialog.getByRole('button', { name: `Open ${cleaning.comment}` }).click();
  await expect(dialog.getByText('Date and time')).toBeVisible();
});

test('STOCK-001 STOCK-002 STOCK-003 a purchase and a closing count go through the atomic RPCs and agree with the stock math', async ({ page }) => {
  // E2E Bunker's product has no closing yet today, so a purchase dated today is allowed.
  await page.goto('/stock-purchase');
  await page.getByRole('combobox', { name: 'Club' }).selectOption({ label: clubs.bunker.name });
  await expect(page.getByRole('heading', { name: 'Stock Purchase', level: 1 })).toBeVisible();
  await page.locator('#purchase-product').selectOption({ label: products.water.name });
  await page.locator('#purchase-quantity').fill('10');
  await page.locator('#purchase-cost').fill(String(products.water.cost_price));
  const rpcs = [];
  page.on('request', request => { if (request.method() === 'POST' && /\/rest\/v1\/rpc\/(record_stock_purchase|save_closing_stock_counts)$/.test(request.url())) rpcs.push(request.url().split('/').pop()); });
  await page.getByRole('button', { name: 'Record Purchase' }).click();
  await expect(page.getByText('Purchase recorded')).toBeVisible();
  const [product] = await (await restAs(accounts.owner, 'GET', `products?select=current_stock,cost_price&id=eq.${products.water.id}`)).json();
  expect(Number(product.current_stock)).toBe(products.water.current_stock + 10);
  expect(Number(product.cost_price)).toBe(products.water.cost_price);

  // Purchases and the closing count are two tabs of the Bar section.
  await openTab(page, 'Closing Stock');
  const closingInput = page.getByRole('textbox', { name: `Closing Stock · ${products.water.name}` });
  await expect(closingInput).toBeVisible();
  // 60 on hand + 10 bought, 65 counted: 5 sold.
  await closingInput.fill('65');
  await page.getByRole('button', { name: 'Save Stock Counts' }).click();
  await expect(page.getByText('Stock counts saved')).toBeVisible();
  expect(rpcs).toEqual(['record_stock_purchase', 'save_closing_stock_counts']);
  const [count] = await (await restAs(accounts.owner, 'GET', `daily_stock_counts?select=previous_stock,added_today,closing_stock,sold_quantity,sale_price,cost_price,bar_income,bar_cost&club_id=eq.${clubs.bunker.id}&product_id=eq.${products.water.id}&date=eq.${today}`)).json();
  expect(Object.fromEntries(Object.entries(count).map(([key, value]) => [key, Number(value)]))).toEqual({
    previous_stock: 60, added_today: 10, closing_stock: 65, sold_quantity: 5, sale_price: products.water.sale_price, cost_price: products.water.cost_price,
    bar_income: 5 * products.water.sale_price, bar_cost: 5 * products.water.cost_price,
  });
  await open(page, 'Dashboard');
  await expectDashboardAmount(page, 'Bar Sales', 5 * products.water.sale_price);
  await expectDashboardAmount(page, 'Inventory Value', 65 * products.water.cost_price);
  await expectDashboardAmount(page, 'Game Club Income', expected.bunkerGameClubIncome);
});

test('STOCK-008 a write-off removes units from closing stock without a sale, charges its cost to bar profit and shows in Reports', async ({ page }) => {
  // E2E Arcade saved today's count in the fixture: cola closes at 62 with 12 sold.
  await page.goto('/closing-stock');
  await expect(page.getByRole('heading', { name: 'Closing Stock', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Write-off' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#write-off-product').selectOption(products.cola.id);
  await dialog.getByRole('radio', { name: 'Expired' }).click();
  await dialog.getByRole('textbox', { name: 'Quantity (pcs)' }).fill('3');
  await dialog.locator('#write-off-note').fill('E2E sour');
  await dialog.getByRole('button', { name: 'Write off' }).click();
  await expect(page.getByText('Write-off saved')).toBeVisible();

  const [count] = await (await restAs(accounts.owner, 'GET', `daily_stock_counts?select=adjustment_quantity,adjustment_reason,closing_stock,sold_quantity,bar_income,bar_cost,writeoff_cost&club_id=eq.${clubs.arcade.id}&product_id=eq.${products.cola.id}&date=eq.${today}`)).json();
  expect({ ...count, adjustment_quantity: Number(count.adjustment_quantity), closing_stock: Number(count.closing_stock), sold_quantity: Number(count.sold_quantity), bar_income: Number(count.bar_income), bar_cost: Number(count.bar_cost), writeoff_cost: Number(count.writeoff_cost) }).toEqual({
    adjustment_quantity: -3, adjustment_reason: 'expired: E2E sour', closing_stock: expected.colaStock - 3, sold_quantity: 12, bar_income: 12 * products.cola.sale_price,
    // The written-off units are charged to bar profit at cost, with no income.
    bar_cost: (12 + 3) * products.cola.cost_price, writeoff_cost: 3 * products.cola.cost_price,
  });

  await page.goto('/reports?view=writeOffs');
  await expect(page.getByRole('cell', { name: products.cola.name })).toBeVisible();
  const text = await pageText(page);
  expect(text).toContain(uzs(3 * products.cola.cost_price));
  expect(text).toContain('E2E sour');
});

test('DEBT-001 DEBT-002 a debt and a payment on it update the balance through the ledger', async ({ page }) => {
  await page.goto('/debts');
  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Add Debt', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add Debt' });
  await dialog.locator('#debt-person').fill('E2E Debtor');
  await dialog.locator('#debt-amount').fill('100000');
  await dialog.locator('#debt-comment').fill('Played four hours, pays tomorrow');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Debt saved')).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'E2E Debtor' });
  await expect(row).toContainText(uzs(100_000));
  await row.getByRole('button', { name: 'Accept payment' }).click();
  const payment = page.getByRole('dialog', { name: 'Partial Payment' });
  await payment.locator('#payment-amount').fill('40000');
  await payment.locator('#payment-comment').fill('Paid part of it in cash');
  await payment.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Payment recorded')).toBeVisible();
  await expect(row).toContainText(uzs(60_000));
  await expect(row).toContainText(`Paid Amount: ${uzs(40_000)} / ${uzs(100_000)}`);
  // The database updated the parent from the payment insert; the page made no second write and offers no edit or delete of history.
  const [debt] = await (await restAs(accounts.owner, 'GET', `new_debts?select=amount,paid_amount,remaining_amount,status,debt_payments(amount)&person_name=eq.E2E%20Debtor`)).json();
  expect({ ...debt, amount: Number(debt.amount), paid_amount: Number(debt.paid_amount), remaining_amount: Number(debt.remaining_amount) })
    .toEqual({ amount: 100000, paid_amount: 40000, remaining_amount: 60000, status: 'partial', debt_payments: [{ amount: 40000 }] });
  await expect(page.locator('#main-content').getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  await open(page, 'Dashboard');
  await expectDashboardAmount(page, 'Active Debts', expected.activeDebts + 60_000);
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome + 100_000);
});

test('AUTH-002 switching club shows only that club\'s figures and no row of the other club', async ({ page }) => {
  await page.goto('/');
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome);
  const arcadeIds = [products.cola.id, products.snickers.id, ...expenses.map(expense => expense.id), ...debts.map(debt => debt.id)];
  const leaked = [];
  // Only requests sent after the switch count: one the first club's dashboard
  // started earlier (its restock sales) may still be answering, and rightly holds that club's rows.
  const sentAfterSwitch = new WeakSet();
  page.on('request', request => sentAfterSwitch.add(request));
  page.on('response', async response => {
    if (!response.url().includes('/rest/v1/') || !sentAfterSwitch.has(response.request())) return;
    const body = await response.text().catch(() => '');
    if (arcadeIds.some(id => body.includes(id))) leaked.push(response.url());
  });
  await page.getByRole('combobox', { name: 'Club' }).selectOption({ label: clubs.bunker.name });
  await expectDashboardAmount(page, 'Game Club Income', expected.bunkerGameClubIncome);
  await expectDashboardAmount(page, 'Game Club Net Profit', expected.bunkerGameClubIncome);
  await expectGameClubExpenses(page, 0);
  await expectDashboardAmount(page, 'Active Debts', 0);
  await open(page, 'Debts');
  await expect(page.locator('#main-content')).not.toContainText('E2E Alibek');
  await open(page, 'Bar', 'Closing Stock');
  await openTab(page, 'Products');
  await expect(page.locator('#main-content')).toContainText(products.water.name);
  await expect(page.locator('#main-content')).not.toContainText(products.cola.name);
  expect(leaked).toEqual([]);
});

test('SET-001 the Settings health check shows every migration applied and confirms the 050/051 functions', async ({ page }) => {
  await page.goto('/settings');
  const health = page.locator('[aria-busy]').filter({ has: page.getByRole('heading', { name: 'Database health' }) });
  const calls = [];
  page.on('request', request => { if (request.url().includes('/rest/v1/rpc/get_migration_health')) calls.push(request.postDataJSON()); });
  await health.getByRole('button', { name: 'Run health check' }).click();
  await expect(health.getByText(/Owner-profit checks passed/)).toBeVisible();
  await expect(health.getByText('Matches app version')).toHaveCount(3);
  for (const name of ['050 · get_owner_profit_snapshot', '051 · withdraw_owner_money_for_month', '051 · enforce_owner_withdrawal_month_balance']) await expect(health).toContainText(name);
  // The test database is migrated without CLI history, like a SQL Editor install: the schema probes still prove every migration,
  // except data-only migrations after the newest one with probes, which nothing later can vouch for.
  const manifest = JSON.parse(await readFile(new URL('../src/lib/supabase/migrationManifest.json', import.meta.url), 'utf8'));
  const lastProbed = manifest.findLastIndex((entry) => entry.probes.length > 0);
  const unverifiable = manifest.length - 1 - lastProbed;
  if (unverifiable === 0) await expect(health.getByText(/^All \d+ migrations are applied\.$/)).toBeVisible();
  else for (const entry of manifest.slice(lastProbed + 1)) await expect(health).toContainText(entry.file.replace(/\.sql$/, ''));
  await expect(health.getByText('Not applied', { exact: true })).toHaveCount(1);
  await expect(health.getByText('Function missing')).toHaveCount(0);
  expect(calls).toEqual([{ p_club_id: clubs.arcade.id }]);
});

test('REP-008 each side has its own money flow, and a category in it opens its payments', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/financial-analysis');
  await expect(page.getByRole('heading', { name: 'Financial Analysis', level: 1 })).toBeVisible();
  const flowTitle = (text) => page.locator('#main-content svg title', { hasText: new RegExp(`^${text} `) });

  // The game club flow: its income, including new debts, against what it paid for and kept.
  const debtIncome = debts.reduce((sum, debt) => sum + debt.amount, 0);
  await expect(flowTitle(`New debts: ${uzs(debtIncome)}`)).toHaveCount(1);
  await expect(flowTitle(`Game club profit: ${uzs(expected.gameClubNetProfit)}`)).toHaveCount(1);
  // The bar has its own flow; nothing adds the two sides together.
  await expect(flowTitle(`Bar profit: ${uzs(expected.barNetProfit)}`)).toHaveCount(1);
  await expect(flowTitle(`Bar goods cost: ${uzs(expected.barCost)}`)).toHaveCount(1);

  // A category: the money that paid it, and its payments listed below.
  const [cleaning] = expenses;
  await page.getByRole('button', { name: 'Open Cleaning' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Cleaning' })).toBeVisible();
  await expect(dialog.locator('title', { hasText: new RegExp(`^Paid from game club: ${uzs(cleaning.amount)} `) })).toHaveCount(1);
  await expect(dialog.getByRole('listitem').filter({ hasText: cleaning.comment })).toContainText(uzs(cleaning.amount));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('OWN-006 unspent dollars show on Owner Profit, and the methods plus dollars equal Game Club profit', async ({ page }) => {
  await page.goto('/money-taken');
  const table = page.getByRole('table').first();
  const row = name => table.getByRole('row').filter({ hasText: name });
  await expect(row('Cash')).toContainText(uzs(1_280_000));
  await expect(row('US dollars')).toHaveCount(0);

  const bought = await restAs(accounts.owner, 'POST', 'rpc/record_money_exchange', {
    p_id: crypto.randomUUID(), p_club_id: clubs.arcade.id, p_date: today, p_from_method: 'cash', p_to_method: 'usd',
    p_from_amount: 1_000_000, p_rate: 12_500, p_comment: 'Cash moved into dollars for rent',
  });
  expect(bought.ok).toBe(true);
  await page.reload();

  // Game Club profit is unchanged; the million left cash and sits in the dollars row.
  await expect(row('Game Club').first()).toContainText(uzs(expected.gameClubMoneyLeft));
  await expect(row('Cash')).toContainText(uzs(280_000));
  await expect(row('US dollars')).toContainText(uzs(1_000_000));
  await expect(row('US dollars')).toContainText('Held $80');
  // Dollars cannot be withdrawn: the picker still offers only what is left in cash.
  await expect(page.getByRole('radio', { name: /Cash/ })).toContainText(uzs(280_000));
  await expect(page.getByRole('radio', { name: /US dollars/ })).toHaveCount(0);
});

test('OWN-007 a cash shortage recorded on Owner Profit leaves the cash it was missing from and shows as actually lost', async ({ page }) => {
  await page.goto('/money-taken');
  const table = page.getByRole('table').first();
  const row = name => table.getByRole('row').filter({ hasText: name });
  await expect(row('Cash')).toContainText(uzs(1_280_000));

  const shortages = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Shortages · / }) });
  await expect(shortages).toContainText('No shortages this month.');
  await shortages.getByRole('button', { name: 'Shortage' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Cash/ }).click();
  await dialog.getByLabel('Missing amount (UZS)').fill('200000');
  await dialog.getByRole('radio', { name: 'Handed over short' }).click();
  await dialog.getByLabel('What happened').fill('Cash was short at the evening handover');
  await dialog.getByRole('button', { name: `Record shortage of ${uzs(200_000)} UZS` }).click();
  await expect(dialog).toBeHidden();

  // A shortage is an expense in every balance: cash and Game Club profit both lose it.
  await expect(row('Cash')).toContainText(uzs(1_080_000));
  await expect(row('Game Club').first()).toContainText(uzs(expected.gameClubMoneyLeft - 200_000));
  await expect(shortages).toContainText('Handed over short');
  await expect(shortages).toContainText('Cash was short at the evening handover');
  await expect(shortages.getByText('Actually lost', { exact: true })).toBeVisible();
  // Its expense is removed only together with the shortage, never on its own.
  const rpc = await restAs(accounts.owner, 'POST', 'rpc/update_expense_category', {
    p_club_id: clubs.arcade.id, p_expense_id: crypto.randomUUID(), p_category: 'shortage',
  });
  expect(rpc.ok).toBe(false);
});

test('OWN-008 profit put into the reserve leaves the month, and a purchase paid from the reserve does not touch it', async ({ page }) => {
  await page.goto('/money-taken');
  const table = page.getByRole('table').first();
  const row = name => table.getByRole('row').filter({ hasText: name });
  await expect(row('Cash')).toContainText(uzs(1_280_000));

  await page.getByRole('radio', { name: /Cash/ }).first().click();
  await page.getByLabel('Withdrawal amount (UZS)').fill('500000');
  await page.getByRole('button', { name: `Put ${uzs(500_000)} UZS into reserve` }).click();
  await expect(page.getByText('Money put into the reserve.')).toBeVisible();

  // The cash it came from now has 500 000 less left to take, shown in its own column.
  await expect(row('Cash')).toContainText(uzs(780_000));
  await expect(table.getByRole('columnheader', { name: 'Into reserve' })).toBeVisible();
  const reserve = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Reserve' }) });
  await expect(reserve).toContainText(uzs(500_000));

  // A purchase from the reserve: it is an expense, but the month keeps its profit.
  const bought = await page.request.post('/api/expenses', { data: {
    id: crypto.randomUUID(), clubId: clubs.arcade.id, date: today, amount: 300_000, category: 'equipment',
    paymentMethod: 'cash', paymentSource: 'game_club', comment: 'New gaming mouse and keyboards for hall', fromReserve: true,
  } });
  expect(bought.status()).toBe(201);
  const tooMuch = await page.request.post('/api/expenses', { data: {
    id: crypto.randomUUID(), clubId: clubs.arcade.id, date: today, amount: 300_000, category: 'equipment',
    paymentMethod: 'cash', paymentSource: 'game_club', comment: 'Another set of keyboards for hall', fromReserve: true,
  } });
  expect((await tooMuch.json()).code).toBe('RESERVE_INSUFFICIENT');
  await page.reload();
  await expect(row('Cash')).toContainText(uzs(780_000));
  await expect(reserve).toContainText(uzs(200_000));

  // Everything left of the Bar's month goes in with one click, and nothing is left to take.
  await reserve.getByRole('button', { name: `Put all in · ${uzs(48_000)}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Put into reserve' }).click();
  await expect(page.getByText('Money put into the reserve.')).toBeVisible();
  await expect(row('Bar')).toContainText(uzs(48_000));
  await expect(reserve.getByRole('button', { name: `Put all in · ${uzs(0)}` }).last()).toBeDisabled();

  // The reserve has its own page: an overview of what it holds, and its history on a second tab.
  await reserve.getByRole('link', { name: 'Charts and history' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reserve' })).toBeVisible();
  // Two pots, whatever side or method the money came from: sums and dollars.
  const held = page.getByRole('region', { name: 'In the reserve now' });
  await expect(held).toContainText('UZS');
  await expect(held).toContainText('US dollars');
  await expect(page.getByRole('heading', { name: 'Reserve over time' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Reserve history' })).toHaveCount(0);
  await page.getByRole('radio', { name: /^History · \d+/ }).click();
  await expect(page).toHaveURL(/\/reserve\?view=history$/);
  const history = page.getByRole('list', { name: 'Reserve history' });
  await expect(history).toContainText('Paid from reserve');
  await expect(history).toContainText(uzs(300_000));
});

test('SAL-007 an employee\'s history is its own page, and every salary tab has its own address', async ({ page, context }) => {
  const employeeId = 'e2e00000-0000-4000-8000-00000000c0de';
  await context.addCookies([englishCookie]);
  await page.goto('/salaries/employees');
  const salaries = await page.request.post('/api/salaries', { data: {
    clubId: clubs.arcade.id, employeeId, action: 'save_employee', name: 'E2E Izzat', jobTitle: 'Admin',
    date: `${today.slice(0, 7)}-01`, salaryType: 'daily', amount: 100_000, kpi: 0, active: true,
  } });
  expect(salaries.status()).toBe(200);

  // The card's History opens the employee's own page: their name, a way back, no section tabs.
  await page.reload();
  await page.locator(`main a[href="/salaries/employees/${employeeId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/salaries/employees/${employeeId}$`));
  await expect(page.getByRole('heading', { name: 'E2E Izzat' })).toBeVisible();
  await expect(page.getByText('Activity calendar')).toBeVisible();
  await expect(page.getByRole('radiogroup')).toHaveCount(0);
  await page.locator('main a[href="/salaries/employees"]').first().click();

  // The club-wide tabs keep the address in step, so reload, Back and Forward land on the same tab.
  await expect(page).toHaveURL(/\/salaries\/employees$/);
  await page.getByRole('radio', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/salaries\/history$/);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'History', checked: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/salaries\/employees$/);
  await expect(page.getByRole('radio', { name: 'Employees', checked: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('radio', { name: 'History', checked: true })).toBeVisible();
});

test('SAL-008 deactivating an employee asks for the date', async ({ page, context }) => {
  const employeeId = 'e2e00000-0000-4000-8000-00000000c0e0';
  await context.addCookies([englishCookie]);
  await page.goto('/salaries/employees');
  const salaries = await page.request.post('/api/salaries', { data: {
    clubId: clubs.arcade.id, employeeId, action: 'save_employee', name: 'E2E Sardor', jobTitle: 'Admin',
    date: `${today.slice(0, 7)}-01`, salaryType: 'daily', amount: 100_000, kpi: 0, active: true,
  } });
  expect(salaries.status()).toBe(200);
  await page.reload();

  const card = page.locator('article', { hasText: 'E2E Sardor' });
  await expect(card.getByText('Total earned')).toBeVisible();
  await expect(card.getByText('Paid out')).toBeVisible();
  await card.getByRole('button', { name: 'Deactivate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Deactivate · E2E Sardor' });
  await expect(dialog.getByRole('button', { name: 'Deactivate from' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByText(/Deactivated employees/).click();
  await expect(card.getByRole('button', { name: 'Activate' })).toBeVisible();
  await expect(card.getByText('Deactivated from')).toBeVisible();
  await card.getByRole('button', { name: 'Activate' }).click();
  const activation = page.getByRole('dialog', { name: 'Activate · E2E Sardor' });
  await expect(activation.getByRole('button', { name: 'Activate from' })).toBeVisible();
  await activation.getByRole('button', { name: 'Cancel' }).click();
  await expect(activation).toBeHidden();

  await card.getByRole('button', { name: 'Delete' }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete this employee?' });
  await deletion.getByLabel('Reason').fill('Left the club');
  await deletion.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card).toBeHidden();
});

test('SAL-009 the card\'s pencil edits role, salary and KPI in one dialog', async ({ page, context }) => {
  const employeeId = 'e2e00000-0000-4000-8000-00000000c0df';
  await context.addCookies([englishCookie]);
  await page.goto('/salaries/employees');
  const salaries = await page.request.post('/api/salaries', { data: {
    clubId: clubs.arcade.id, employeeId, action: 'save_employee', name: 'E2E Nodir', jobTitle: 'Admin',
    date: `${today.slice(0, 7)}-01`, salaryType: 'daily', amount: 100_000, kpi: 0, active: true,
  } });
  expect(salaries.status()).toBe(200);
  await page.reload();

  await page.getByRole('button', { name: 'Edit employee · E2E Nodir' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit employee · E2E Nodir' });
  // Nothing changed yet, so there is nothing to save.
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await dialog.getByLabel('Role').selectOption('Manager');
  await dialog.getByLabel('Amount').fill('150000');
  await dialog.getByLabel('KPI from owner profit (%)').fill('5');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const card = page.locator('article').filter({ hasText: 'E2E Nodir' });
  await expect(card.getByText('Manager')).toBeVisible();
  await expect(card.getByText(`${uzs(150_000)} UZS`)).toBeVisible();
  await expect(card.getByText('5%')).toBeVisible();
});

test('SET-006 the brand page has its own tab after Google Maps, and the club page no longer carries it', async ({ page, context }) => {
  await context.addCookies([englishCookie]);
  await page.goto('/showcase');
  await expect(page.getByRole('heading', { name: 'Page settings' })).toBeVisible();
  await expect(page.getByLabel('Brand name')).toHaveCount(0);
  // The section's own tabs: each translated field on the page has an RU / UZ / EN group of its own.
  const tabs = page.getByRole('radiogroup', { name: 'Public page' });
  await expect(tabs.getByRole('radio')).toHaveText(['Page', 'Game library', 'Google Maps', 'Brand page']);

  await tabs.getByRole('radio', { name: 'Brand page' }).click();
  await expect(page).toHaveURL(/\/showcase\/brand$/);
  await expect(page.getByLabel('Brand name')).toBeVisible();
  await page.reload();
  await expect(tabs.getByRole('radio', { name: 'Brand page', checked: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Page settings' })).toHaveCount(0);
});

test('SET-007 Add PlayStation opens prefilled, and PS3, PS4 or PS5 is the only console choice', async ({ page, context }) => {
  await context.addCookies([englishCookie]);
  await page.goto('/showcase');
  const addPlaystation = page.getByRole('button', { name: 'Add PlayStation' });
  await expect(page.getByRole('heading', { name: 'Page settings' })).toBeVisible();
  // Zones appear once the club's page has been saved.
  if (!await addPlaystation.isVisible()) await page.getByRole('button', { name: 'Save' }).first().click();
  await addPlaystation.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: 'PS5', checked: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /^PS\d$/ })).toHaveCount(3);
  await expect(dialog.getByLabel('Console model', { exact: true }).locator('input')).toHaveCount(0);
  await expect(dialog.getByLabel('Controllers')).toHaveValue('2');
  await expect(dialog.locator('img[src="/playstation/ps5.svg"]')).toBeVisible();

  await dialog.getByRole('radio', { name: 'PS3' }).click();
  await expect(dialog.locator('img[src="/playstation/ps3.svg"]')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('main img[src="/playstation/ps3.svg"]')).toBeVisible();
  await expect(page.locator('main').getByText('PlayStation 3').first()).toBeVisible();
});

test('SET-008 saving a zone keeps unsaved page settings', async ({ page, context }) => {
  await context.addCookies([englishCookie]);
  await page.goto('/showcase');
  const addPlaystation = page.getByRole('button', { name: 'Add PlayStation' });
  await expect(page.getByRole('heading', { name: 'Page settings' })).toBeVisible();
  if (!await addPlaystation.isVisible()) await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(addPlaystation).toBeVisible();

  await page.locator('#showcase-address').fill('Unsaved draft address');
  await addPlaystation.click();
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('main').getByText('PlayStation 5').first()).toBeVisible();
  await expect(page.locator('#showcase-address')).toHaveValue('Unsaved draft address');
});

test('REP-009 the exchange form keeps cents and fractional rates and caps the amount at the available money', async ({ page, context }) => {
  await context.addCookies([englishCookie]);
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Exchange', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // From cash (the default) into dollars, so a rate is needed.
  await dialog.getByRole('radio', { name: 'US dollars' }).last().click();

  const rate = dialog.locator('#exchange-rate');
  await rate.pressSequentially('1234.5');
  await expect(rate).toHaveValue('1 234,5');
  await rate.pressSequentially('67');
  // A third decimal is dropped, and the digits never run into the whole part.
  await expect(rate).toHaveValue('1 234,56');
  await rate.press('Home');
  await rate.press('ArrowRight');
  await rate.pressSequentially('0');
  await expect(rate).toHaveValue('10 234,56');

  // More than the cash on hand is cut back to what is available.
  const hint = dialog.getByText(/^Available: /);
  await expect(hint).toBeVisible();
  const availableCash = (await hint.textContent()).replace(/^Available: /, '').replace(/ so.m$| UZS$| сум$/, '').trim();
  const amount = dialog.locator('#exchange-amount');
  await amount.fill('');
  await amount.pressSequentially('999999999');
  await expect(amount).toHaveValue(availableCash);
});

test.describe('a new sign-up with no club', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('AUTH-004 sees the approval screen on any path and cannot publish a brand page', async ({ page, context }) => {
    await context.addCookies([englishCookie]);
    await page.goto('/login?next=/daily-cash');
    await page.locator('#login-email').fill(pendingAccount.email);
    await page.locator('#login-password').fill(pendingAccount.password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for owner approval', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/daily-cash$/);

    const brand = { owner_id: pendingAccount.id, slug: 'stolen-brand', name: 'Pixel Gaming', is_published: true };
    expect((await restAs(pendingAccount, 'POST', 'showcase_brands', brand)).status).toBe(403);
  });
});

test.describe('as an admin', () => {
  test.use({ storageState: storageStatePath('admin') });

  test('STOCK-009 an admin records and adds to a write-off on its own page but cannot reduce it or see its cost', async ({ page }) => {
    // The owner writes off 2 colas: 62 counted becomes 60, 12 still sold.
    const saved = await restAs(accounts.owner, 'POST', 'rpc/save_closing_stock_counts', {
      p_club_id: clubs.arcade.id,
      p_date: today,
      p_counts: [{ product_id: products.cola.id, closing_stock: expected.colaStock - 2, sold_quantity: 12, adjustment_quantity: -2, adjustment_reason: 'shortage', giveaway_quantity: 0 }],
    });
    expect(saved.status).toBe(200);

    // Closing Stock keeps its button for admins too; the cost and badges stay owner-only.
    await page.goto('/closing-stock');
    await expect(page.getByRole('heading', { name: 'Closing Stock', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Write-off' })).toBeVisible();
    expect(await pageText(page)).not.toContain('Shortage');

    // Write-offs is a tab of the bar section.
    await openTab(page, 'Write-offs');
    await expect(page).toHaveURL(/\/write-offs$/);
    // Today's table and the month ledger below it both list the owner's write-off.
    await expect(page.getByRole('heading', { name: 'Write-offs and corrections by month' })).toBeVisible();
    await expect(page.getByRole('cell', { name: products.cola.name })).toHaveCount(2);
    const writeOffsText = await pageText(page);
    // Money stays the owner's: an admin reads units only.
    expect(writeOffsText).not.toContain('Loss at cost');
    expect(writeOffsText).not.toContain('Value at cost');

    await page.getByRole('button', { name: 'Write off bar stock' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#write-off-product').selectOption(products.cola.id);
    // Reducing the owner's write-off is refused before it reaches the database.
    await dialog.getByRole('textbox', { name: 'Quantity (pcs)' }).fill('1');
    await expect(dialog.getByRole('button', { name: 'Update write-off' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: /^Remove write-off/ })).toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Quantity (pcs)' }).fill('3');
    await dialog.locator('#write-off-note').fill('E2E one more missing');
    await dialog.getByRole('button', { name: 'Update write-off' }).click();
    await expect(page.getByText('Write-off saved')).toBeVisible();

    const [count] = await (await restAs(accounts.owner, 'GET', `daily_stock_counts?select=adjustment_quantity,adjustment_reason,closing_stock,sold_quantity,writeoff_cost&club_id=eq.${clubs.arcade.id}&product_id=eq.${products.cola.id}&date=eq.${today}`)).json();
    expect({ ...count, adjustment_quantity: Number(count.adjustment_quantity), closing_stock: Number(count.closing_stock), sold_quantity: Number(count.sold_quantity), writeoff_cost: Number(count.writeoff_cost) }).toEqual({
      adjustment_quantity: -3, adjustment_reason: 'shortage: E2E one more missing', closing_stock: expected.colaStock - 3, sold_quantity: 12, writeoff_cost: 3 * products.cola.cost_price,
    });

    // The database refuses a reduction from an admin, whatever the browser sends.
    const reduced = await restAs(accounts.admin, 'POST', 'rpc/save_closing_stock_counts', {
      p_club_id: clubs.arcade.id,
      p_date: today,
      p_counts: [{ product_id: products.cola.id, closing_stock: expected.colaStock - 1, sold_quantity: 12, adjustment_quantity: -1, adjustment_reason: 'shortage', giveaway_quantity: 0 }],
    });
    expect(reduced.status).toBe(403);

    await page.goto('/reports?view=writeOffs');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    expect(await pageText(page)).not.toContain('Write-offs');
  });
});

test('NAV-001 the bar, owner money, reports and team sections each open from one sidebar item and switch by tabs', async ({ page }) => {
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation');
  // The pages inside a section are no longer separate sidebar items.
  for (const label of ['Closing Stock', 'Stock Purchase', 'Products', 'Promotions', 'Reserve', 'Edit history']) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }
  await open(page, 'Bar', 'Closing Stock');
  await expect(nav.getByRole('link', { name: 'Bar', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const tab of ['Stock Purchase', 'Products', 'Promotions']) {
    await openTab(page, tab);
    await expect(nav.getByRole('link', { name: 'Bar', exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await expect(page).toHaveURL(/\/promotions$/);

  await open(page, 'Owner Profit');
  await openTab(page, 'Reserve');
  await expect(page).toHaveURL(/\/reserve$/);
  await expect(nav.getByRole('link', { name: 'Owner Profit', exact: true })).toHaveAttribute('aria-current', 'page');
  await openTab(page, 'Owner Profit');

  // The day and month profit reports are tabs of Reports, next to its own views.
  await open(page, 'Reports');
  const reportTabs = page.getByRole('radiogroup', { name: 'Reports view' });
  await reportTabs.getByRole('radio', { name: 'Day', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Daily Report', level: 1 })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute('aria-current', 'page');
  await reportTabs.getByRole('radio', { name: 'Month', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Monthly Report', level: 1 })).toBeVisible();
  await reportTabs.getByRole('radio', { name: 'Collected', exact: true }).click();
  await expect(page).toHaveURL(/\/reports\?view=collected$/);
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

  // The Team item carries the count of open access requests, so match it by its start.
  const team = nav.getByRole('link', { name: /^Team/ });
  await team.click();
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
  await openTab(page, 'Edit history');
  await expect(page).toHaveURL(/\/history$/);
  await expect(team).toHaveAttribute('aria-current', 'page');
});

test.describe('as a viewer', () => {
  test.use({ storageState: storageStatePath('viewer') });

  test('AUTH-003 EXP-002 a viewer sees read-only pages and every write is refused by the server', async ({ page }) => {
    // Viewers get no write pages at all: the sidebar hides them and a direct visit is sent to an allowed page.
    await page.goto('/stock-purchase');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page).not.toHaveURL(/stock-purchase/);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Daily Cash', exact: true })).toHaveCount(0);
    // Of the Bar section a viewer has the catalog only: the item opens it, with no tabs to the write pages.
    await open(page, 'Bar', 'Products');
    await expect(page.getByRole('radiogroup', { name: 'Section pages' })).toHaveCount(0);
    await open(page, 'Debts');
    await expect(page.locator('#main-content')).toContainText('E2E Alibek');
    await expect(page.getByRole('button', { name: 'Accept payment' })).toHaveCount(0);
    // The expense route runs as the viewer: RLS refuses the insert.
    const response = await page.request.post('/api/expenses', { data: { clubId: clubs.arcade.id, date: today, amount: 1000, category: 'cleaning', paymentMethod: 'cash', paymentSource: 'game_club', comment: 'Cleaning service for both halls' } });
    expect(response.status()).toBe(403);
    // Straight to the database API with the viewer's own token: RLS, not the UI, is the boundary.
    expect((await restAs(accounts.viewer, 'POST', 'new_debts', { club_id: clubs.arcade.id, person_name: 'E2E Intruder', amount: 1, remaining_amount: 1, date: today, category: 'other', status: 'unpaid', comment: 'Played four hours, pays tomorrow', created_by: accounts.viewer.id })).status).toBe(403);
    expect((await restAs(accounts.viewer, 'POST', 'rpc/record_stock_purchase', { p_club_id: clubs.arcade.id, p_date: today, p_product_id: products.cola.id, p_quantity: 1, p_cost_price: 1 })).status).toBe(403);
    // A member of E2E Arcade only: the other club's ledgers are invisible, not just empty on screen.
    expect(await (await restAs(accounts.viewer, 'GET', `products?select=id&club_id=eq.${clubs.bunker.id}`)).json()).toEqual([]);
    const rows = await (await restAs(accounts.owner, 'GET', `expenses?select=id&club_id=eq.${clubs.arcade.id}`)).json();
    // The owner-only health check is refused to a member, not reported as missing migrations.
    expect((await restAs(accounts.viewer, 'POST', 'rpc/get_migration_health', { p_club_id: clubs.arcade.id })).status).toBe(403);
    // The edit history is a tab of the owner-only Team section: no nav link, and RLS returns no rows to a member.
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
    expect(await (await restAs(accounts.viewer, 'GET', `entry_audit_logs?select=id&club_id=eq.${clubs.arcade.id}`)).json()).toEqual([]);
    expect(rows).toHaveLength(expenses.length);
  });
});

test('I18N-003 switching language keeps the figures and formats money as 1 000 000', async ({ page }) => {
  await page.goto('/');
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome);
  await page.getByRole('group', { name: 'Language / Язык / Til' }).getByRole('button', { name: 'Русский' }).click();
  await expect(page.getByRole('heading', { name: 'Панель управления', level: 1 })).toBeVisible();
  await expectDashboardAmount(page, 'Доход клуба', expected.gameClubIncome);
  expect(uzs(expected.gameClubIncome)).toBe('3 450 000');
  await page.getByRole('group', { name: 'Language / Язык / Til' }).getByRole('button', { name: "O'zbekcha" }).click();
  await expect(page.getByRole('heading', { name: 'Boshqaruv paneli', level: 1 })).toBeVisible();
  await expectDashboardAmount(page, 'Klub daromadi', expected.gameClubIncome);
  expect(await pageText(page)).not.toMatch(/\b(dashboard|common|nav)\.[a-zA-Z]+\b/);
});

test('DASH-010 the month picker shows an earlier month', async ({ page }) => {
  await page.goto('/dashboard');
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome);

  const [year, month] = today.split('-').map(Number);
  const label = date => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  // Exact: the month's calendar days are buttons named "2 November 2026: …" too.
  await page.getByRole('button', { name: label(new Date(Date.UTC(year, month - 1, 1))), exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Select month' });
  // Next month cannot be picked; January looks back a year.
  await expect(picker.getByRole('button', { name: label(new Date(Date.UTC(year, month, 1))) })).toHaveCount(month === 12 ? 0 : 1);
  if (month < 12) await expect(picker.getByRole('button', { name: label(new Date(Date.UTC(year, month, 1))) })).toBeDisabled();
  if (month === 1) await picker.getByRole('button', { name: 'Previous year' }).click();
  await picker.getByRole('button', { name: label(new Date(Date.UTC(year, month - 2, 1))) }).click();

  // The fixture has nothing before this month: the figures are that month's.
  await expectDashboardAmount(page, 'Game Club Income', 0);
  await expect(page.getByRole('button', { name: label(new Date(Date.UTC(year, month - 2, 1))), exact: true })).toBeVisible();
});

test('NET-001 losing the connection is said on the page, and the notice leaves when it returns', async ({ page, context }) => {
  await page.goto('/debts');
  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
  await expect(page.getByText('You are offline')).toHaveCount(0);
  await context.setOffline(true);
  await expect(page.getByRole('alert').filter({ hasText: 'You are offline' })).toBeVisible();
  // The page already loaded stays on screen under the notice.
  await expect(page.locator('#main-content')).toContainText('E2E Alibek');
  await context.setOffline(false);
  await expect(page.getByText('You are offline')).toHaveCount(0);
});

test('EXP-001 Debts export downloads the list as a spreadsheet file', async ({ page }) => {
  await page.goto('/debts');
  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`debts-${today}.xlsx`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const sheet = workbook.worksheets[0];
  const row = number => sheet.getRow(number).values.slice(1);
  // A title block (title, club and date, export note, a gap), the header, one row per debt, then the totals.
  expect(sheet.getCell('A1').value).toBe('Debts');
  expect(row(5)).toEqual(['Person Name', 'Date', 'Amount (UZS)', 'Paid Amount (UZS)', 'Remaining (UZS)', 'Status', 'Comment']);
  expect(sheet.rowCount).toBe(5 + debts.length + 1);
  const people = Array.from({ length: debts.length }, (_, index) => sheet.getCell(6 + index, 1).value);
  expect(people).toContain('E2E Alibek');
  // Amounts are real numbers a spreadsheet can add up.
  expect(typeof sheet.getCell(6, 3).value).toBe('number');
  expect(sheet.getCell(6 + debts.length, 1).value).toBe('Total');
});

test('CMD-001 the command palette finds pages and actions from the keyboard', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  const palette = page.getByRole('dialog', { name: 'Search and commands' });
  const search = palette.getByRole('combobox');
  // The heading is server-rendered, so it can show before the shortcut listener
  // is attached; a press in that gap is lost. Press again until the palette opens.
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press('Control+k');
    await expect(search).toBeFocused({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  // Nothing typed: the quick actions, then every page.
  await expect(palette.getByRole('option').first()).toHaveText('Add an expense');
  await expect(palette.getByRole('option', { name: 'Edit history' })).toHaveCount(1);

  await search.fill('month');
  await expect(palette.getByRole('option')).toHaveText(['Monthly Report']);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Monthly Report', level: 1 })).toBeVisible();
  await expect(palette).toHaveCount(0);

  // The button in the top bar opens it too; arrows move, Enter runs the action and its form opens.
  await page.getByRole('button', { name: 'Search and commands' }).click();
  await expect(search).toHaveValue('');
  await search.fill('deb');
  await expect(palette.getByRole('option')).toHaveText(['Add a debt', 'Debts']);
  await page.keyboard.press('ArrowDown');
  await expect(palette.getByRole('option', { name: 'Debts' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Add Debt' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Names too: a person who owes, a product. The list opens narrowed to the one picked.
  await page.keyboard.press('Control+k');
  await search.fill('alibek');
  await expect(palette.getByRole('group', { name: 'People who owe' }).getByRole('option')).toHaveText([/E2E Alibek/]);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('E2E Alibek');
  await expect(page.locator('#main-content')).not.toContainText('E2E Sardor');
  await page.keyboard.press('Control+k');
  await search.fill(products.cola.name);
  await palette.getByRole('group', { name: 'Products' }).getByRole('option', { name: products.cola.name }).first().click();
  await expect(page.getByRole('heading', { name: 'Products', level: 1 })).toBeVisible();
  await expect(page.locator('#main-content')).toContainText(products.cola.name);
  await expect(page.locator('#main-content')).not.toContainText(products.snickers.name);

  await page.keyboard.press('Control+k');
  await search.fill('zzzz');
  await expect(palette.getByRole('status')).toHaveText('Nothing matches. Try another word.');
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('UI-001 every core page fits 375 px with no horizontal scroll', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [path, heading] of [['/', 'Dashboard'], ['/showcase/brand', 'Public page'], ['/daily-cash', 'Daily Cash Entry'], ['/closing-stock', 'Closing Stock'], ['/stock-purchase', 'Stock Purchase'], ['/reports', 'Reports'], ['/debts', 'Debts'], ['/history', 'Edit history'], ['/products', 'Products'], ['/salaries/history', 'History'], ['/daily-report', 'Daily Report'], ['/monthly-report', 'Monthly Report']]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${path} overflows` }).toBe(0);
    }
    expect(errors).toEqual([]);
  });

  test('NAV-002 the bottom bar opens the everyday screens, hands the rest to the menu and stays clear of the Save bar', async ({ page }) => {
    await page.goto('/dashboard');
    const bar = page.getByRole('navigation', { name: 'Quick navigation' });
    // Three screens around the quick-add button; Reports and the rest are in the menu.
    await expect(bar.getByRole('link')).toHaveText(['Dashboard', 'Daily Cash', 'Bar']);
    await expect(bar.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');

    await bar.getByRole('link', { name: 'Daily Cash' }).click();
    await expect(page.getByRole('heading', { name: 'Daily Cash Entry', level: 1 })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Daily Cash' })).toHaveAttribute('aria-current', 'page');

    // The bar steps aside while a field is typed in, and returns afterwards.
    const field = page.locator('#main-content input:not([type="hidden"]):visible').first();
    await field.focus();
    await expect(bar).toHaveCount(0);
    await field.blur();
    await expect(bar).toBeVisible();

    await bar.getByRole('link', { name: 'Bar' }).click();
    await expect(page.getByRole('heading', { name: 'Closing Stock', level: 1 })).toBeVisible();
    // A section item stays lit on the section's other tabs.
    await openTab(page, 'Products');
    await expect(bar.getByRole('link', { name: 'Bar' })).toHaveAttribute('aria-current', 'page');

    // The Save bar of Closing Stock sits on top of the bottom bar, not under it.
    await openTab(page, 'Closing Stock');
    const save = page.getByRole('button', { name: 'Save Stock Counts' }).last();
    await save.scrollIntoViewIfNeeded();
    const [saveBox, barBox] = [await save.boundingBox(), await bar.boundingBox()];
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(barBox.y + 1);
    expect(Math.round(barBox.y + barBox.height)).toBe(812);

    // Everything else is in the menu; while it is open there is one set of links.
    await bar.getByRole('button', { name: 'More' }).click();
    const menu = page.getByRole('dialog', { name: 'Main navigation' });
    await expect(bar).toHaveCount(0);
    await menu.getByRole('link', { name: 'Debts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current', 'page');
  });

  test('NAV-003 the quick-add button opens a form from anywhere', async ({ page }) => {
    await page.goto('/dashboard');
    const bar = page.getByRole('navigation', { name: 'Quick navigation' });
    await bar.getByRole('button', { name: 'Quick add' }).click();
    const sheet = page.getByRole('dialog', { name: 'Quick add' });
    await expect(sheet.getByRole('button').filter({ hasText: /\S/ })).toHaveText(['Add an expense', "Enter today's cash", 'Count closing stock', 'Record a stock purchase', 'Add a debt']);
    await sheet.getByRole('button', { name: 'Add an expense' }).click();
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Register Expense' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Already on the page: the form still opens.
    await bar.getByRole('button', { name: 'Quick add' }).click();
    await page.getByRole('dialog', { name: 'Quick add' }).getByRole('button', { name: 'Add an expense' }).click();
    await expect(page.getByRole('dialog', { name: 'Register Expense' })).toBeVisible();
    await page.keyboard.press('Escape');

    // A later visit does not reopen it.
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Register Expense' })).toHaveCount(0);
  });

  test('UI-002 tables are cards on a phone: no cell of a row is off to the side', async ({ page }) => {
    for (const [path, heading] of [['/products', 'Products'], ['/closing-stock', 'Closing Stock'], ['/stock-purchase', 'Stock Purchase'], ['/reports', 'Reports']]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page.locator('#main-content table td:visible').first()).toBeVisible();
      // Every cell that is shown ends inside the screen, so nothing is reached by scrolling a table sideways.
      const offScreen = await page.locator('#main-content table td').evaluateAll(cells => cells
        .filter(cell => cell.getClientRects().length > 0)
        .filter(cell => cell.getBoundingClientRect().right > window.innerWidth + 1 || cell.getBoundingClientRect().left < -1)
        .map(cell => cell.textContent.trim().slice(0, 40)));
      expect(offScreen, `${path} has cells off screen`).toEqual([]);
    }
    // The count a bartender types is on screen with the product it belongs to.
    await page.goto('/closing-stock');
    const count = page.getByRole('textbox', { name: `Closing Stock · ${products.cola.name}` });
    await count.scrollIntoViewIfNeeded();
    await expect(count).toBeInViewport({ ratio: 1 });
  });
});

test('REP-010 a collector takes money from the admin, and a bill is paid from what was collected', async ({ page }) => {
  // Today's Arcade money left: cash 1 200 000 + 200 000 debt payment - 120 000 cleaning = 1 280 000,
  // terminal 850 000, card 350 000 - 80 000 = 270 000, PlayStation 250 000: 2 650 000 with the admin.
  await page.goto('/reports');
  const whereabouts = page.locator('section').filter({ hasText: 'Money still in the club’s kassa' }).first();
  await expect(whereabouts).toContainText(uzs(expected.gameClubMoneyLeft));

  await page.getByRole('button', { name: 'Collect money' }).click();
  const dialog = page.getByRole('dialog', { name: 'Collect money from the admin' });
  // Every method starts at everything the kassa holds.
  await expect(dialog.locator('#collect-cash')).toHaveValue(uzs(1_280_000));
  await expect(dialog.locator('#collect-terminal')).toHaveValue(uzs(850_000));
  await dialog.locator('#collect-cash').fill('1000000');
  await dialog.getByRole('button', { name: 'Mark as collected' }).click();
  await expect(page.getByText('Money collected')).toBeVisible();

  // 280 000 cash stays with the admin; 1 000 000 + 850 000 + 270 000 + 250 000 is collected.
  await expect(whereabouts).toContainText(uzs(280_000));
  await expect(whereabouts).toContainText(uzs(2_370_000));
  const rows = await (await restAs(accounts.owner, 'GET', `money_collections?select=payment_method,amount&club_id=eq.${clubs.arcade.id}&order=payment_method.asc`)).json();
  expect(rows).toEqual([
    { payment_method: 'card', amount: 270000 },
    { payment_method: 'cash', amount: 1000000 },
    { payment_method: 'playstation', amount: 250000 },
    { payment_method: 'terminal', amount: 850000 },
  ]);

  // A bill paid from collected money cannot spend more than was collected, and leaves the admin's kassa alone.
  const bill = amount => page.request.post('/api/expenses', { data: {
    id: crypto.randomUUID(), clubId: clubs.arcade.id, date: today, amount, category: 'repair',
    paymentMethod: 'cash', paymentSource: 'game_club', comment: 'Server bill for three days', fromCollected: true,
  } });
  expect((await (await bill(1_000_001)).json()).code).toBe('COLLECTED_INSUFFICIENT');
  expect((await bill(900_000)).status()).toBe(201);
  await page.reload();
  await expect(whereabouts).toContainText(uzs(280_000));
  await expect(whereabouts).toContainText(uzs(1_470_000));

  // The Collected tab lists the collection and what it paid for.
  await page.getByText('Taken by the collector, not yet in the reserve').click();
  await expect(page).toHaveURL(/view=collected/);
  await expect(page.getByRole('table').filter({ hasText: 'Collected by' })).toContainText(uzs(2_370_000));
  // The card first, then the split bar's legend naming the same share.
  await expect(page.getByText('Paid from collected').first()).toBeVisible();
});

// The reserve (/reserve) is the home of everything done with reserve money: paying from it and returning it to profit.
const month = today.slice(0, 7);
const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
/** Puts or returns reserve money through /api/reserve, as the Owner Profit and Reserve pages do. Bar money has no method. */
async function moveReserve(page, kind, source, amount, method = source === 'bar' ? null : 'cash') {
  const response = await page.request.post('/api/reserve', { data: { clubId: clubs.arcade.id, kind, month, source, comment: '', parts: [{ id: crypto.randomUUID(), method, amount }] } });
  expect(response.status(), `${kind} of ${amount} from ${source}`).toBe(200);
}

/** The accessible name of a tile or card on the Reserve page: its label, then the figure and the unit. Read by name,
 * because the figure rolls to its value and the rolling digits are in the element's text. */
const tileName = (label, amount) => new RegExp(`^${label}\\s${uzs(amount).replace(/ /g, '\\s')}\\sUZS$`);

test('RES-001 money returned from the reserve leaves it and is back in the month\'s owner profit', async ({ page }) => {
  await page.goto('/reserve');
  await expect(page.getByRole('heading', { name: 'Reserve', level: 1 })).toBeVisible();
  // 500 000 of the month's cash (1 280 000 left) and the Bar's whole 48 000 go into the reserve.
  await moveReserve(page, 'deposit', 'game_club', 500_000);
  await moveReserve(page, 'deposit', 'bar', expected.barSales - expected.stockPurchaseCost);
  await page.reload();
  const held = page.getByRole('region', { name: 'In the reserve now' });
  await expect(held.getByRole('button', { name: tileName('UZS', 548_000) })).toBeVisible();

  await page.getByRole('button', { name: 'Return to profit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Return to profit' });
  // The reserve has no month of its own: the month the money goes back to is chosen here, this month first.
  await expect(dialog.getByRole('button', { name: monthLabel })).toBeVisible();
  await expect(dialog).toContainText(`The money joins owner profit for ${monthLabel}`);
  const side = dialog.getByRole('radiogroup', { name: 'Profit source' });
  await expect(side.getByRole('radio')).toHaveText(['Game Club', 'Bar']);
  await expect(side.getByRole('radio', { name: 'Game Club' })).toBeChecked();
  await side.getByRole('radio', { name: 'Bar' }).click();
  await expect(dialog.getByText(`In the reserve: ${uzs(48_000)} UZS`)).toBeVisible();
  await side.getByRole('radio', { name: 'Game Club' }).click();
  await expect(dialog.getByRole('radio', { name: /^Cash/ })).toBeChecked();
  await expect(dialog.getByText(`In the reserve: ${uzs(500_000)} UZS`)).toBeVisible();

  // More than the method holds is refused before any request.
  const amount = dialog.locator('#reserve-return-amount');
  await amount.fill('600000');
  await expect(dialog.getByText(`Enter at most ${uzs(500_000)}.`)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Return', exact: true })).toBeDisabled();
  await amount.fill('200000');
  await expect(amount).toHaveValue(uzs(200_000));
  await dialog.getByRole('button', { name: 'Return', exact: true }).click();
  await expect(dialog).toBeHidden();

  // 548 000 − 200 000 stays in the reserve.
  await expect(held.getByRole('button', { name: tileName('UZS', 348_000) })).toBeVisible();
  await expect(held.getByRole('button', { name: tileName('Returned to profit', 200_000) })).toBeVisible();

  // The month has it back: cash left to take is 1 280 000 − 500 000 + 200 000.
  await openTab(page, 'Owner Profit');
  const table = page.getByRole('table').first();
  await expect(table.getByRole('row').filter({ hasText: 'Cash' })).toContainText(uzs(980_000));
  await expect(page.getByRole('link', { name: tileName('In the reserve', 348_000) })).toBeVisible();
});

test('RES-002 a purchase paid on the Reserve page lowers the reserve and leaves the month\'s profit alone', async ({ page }) => {
  await page.goto('/reserve');
  await expect(page.getByRole('heading', { name: 'Reserve', level: 1 })).toBeVisible();
  await moveReserve(page, 'deposit', 'game_club', 500_000);
  await page.reload();
  const held = page.getByRole('region', { name: 'In the reserve now' });
  await expect(held.getByRole('button', { name: tileName('UZS', 500_000) })).toBeVisible();

  await page.getByRole('button', { name: 'Pay from reserve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Pay from reserve' });
  // The expense form opens already paying from the reserve's sums.
  await expect(dialog.getByRole('radio', { name: 'Reserve', exact: true })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^UZS/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^UZS/ })).toContainText(`${uzs(500_000)} UZS`);
  await dialog.locator('#expense-amount').fill('300000');
  await dialog.locator('#expense-category').selectOption('equipment');
  await dialog.locator('#expense-comment').fill('New gaming mouse and keyboards for hall');
  const posts = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/expenses')) posts.push(request.postDataJSON()); });
  await dialog.getByRole('button', { name: 'Save Expense' }).click();
  await expect(dialog).toBeHidden();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ amount: 300000, category: 'equipment', fromReserve: true });

  // 500 000 − 300 000 is left, and the purchase is in the reserve's own history.
  await expect(held.getByRole('button', { name: tileName('UZS', 200_000) })).toBeVisible();
  await expect(held.getByRole('button', { name: tileName('Paid from reserve', 300_000) })).toBeVisible();
  await page.getByRole('radio', { name: /^History · 2$/ }).click();
  const history = page.getByRole('list', { name: 'Reserve history' });
  await expect(history).toContainText('Paid from reserve');
  await expect(history).toContainText(uzs(300_000));

  // It is an expense, but the month keeps its profit: cash left to take is still 1 280 000 − 500 000.
  await openTab(page, 'Owner Profit');
  const table = page.getByRole('table').first();
  await expect(table.getByRole('row').filter({ hasText: 'Cash' })).toContainText(uzs(780_000));
  await expect(page.getByRole('link', { name: tileName('In the reserve', 200_000) })).toBeVisible();
});

test('RES-003 the Put in, Returned and Paid tiles each open the history narrowed to that kind', async ({ page }) => {
  await page.goto('/reserve');
  await expect(page.getByRole('heading', { name: 'Reserve', level: 1 })).toBeVisible();
  await moveReserve(page, 'deposit', 'game_club', 500_000);
  await moveReserve(page, 'return', 'game_club', 100_000);
  const bought = await page.request.post('/api/expenses', { data: {
    id: crypto.randomUUID(), clubId: clubs.arcade.id, date: today, amount: 150_000, category: 'equipment',
    paymentMethod: 'cash', paymentSource: 'game_club', comment: 'New gaming mouse and keyboards for hall', fromReserve: true,
  } });
  expect(bought.status()).toBe(201);
  await page.reload();

  const held = page.getByRole('region', { name: 'In the reserve now' });
  const history = page.getByRole('list', { name: 'Reserve history' });
  const filter = page.getByRole('radiogroup', { name: 'Show' });
  for (const [tile, amount, kind, label] of [
    ['Put in', 500_000, 'Put in', 'Put into reserve'],
    ['Returned to profit', 100_000, 'Returned', 'Returned to profit'],
    ['Paid from reserve', 150_000, 'Paid', 'Paid from reserve'],
  ]) {
    await held.getByRole('button', { name: tileName(tile, amount) }).click();
    await expect(page).toHaveURL(/\/reserve\?view=history$/);
    await expect(filter.getByRole('radio', { name: kind, exact: true })).toBeChecked();
    // One entry of that kind, and nothing of the other two.
    await expect(history.getByRole('button', { name: /^Delete: / })).toHaveCount(1);
    await expect(history).toContainText(label);
    await expect(history).toContainText(uzs(amount));
    await page.getByRole('radio', { name: 'Overview' }).click();
    await expect(page).toHaveURL(/\/reserve$/);
  }
  // The filter itself shows all three again.
  await page.getByRole('radio', { name: /^History · 3$/ }).click();
  await filter.getByRole('radio', { name: 'All' }).click();
  await expect(history.getByRole('button', { name: /^Delete: / })).toHaveCount(3);
});

test('RES-004 the Reserve page confirms a return with a toast', async ({ page }) => {
  await page.goto('/reserve');
  await moveReserve(page, 'deposit', 'game_club', 500_000);
  await page.reload();
  await page.getByRole('button', { name: 'Return to profit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Return to profit' });
  await dialog.locator('#reserve-return-amount').fill('200000');
  await dialog.getByRole('button', { name: 'Return', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Money returned to owner profit.' })).toBeVisible();
});

test('SYS-001 the owner opens System sanity checks from the command palette and all seven pass', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  const palette = await openCommandPalette(page);
  await palette.getByRole('combobox').fill('sanity');
  await expect(palette.getByRole('option')).toHaveText(['System sanity checks']);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/test-checklist$/);
  await expect(page.getByRole('heading', { name: 'System sanity checks', level: 1 })).toBeVisible();
  const checks = page.getByRole('list', { name: 'System sanity checks' });
  await expect(checks.getByRole('listitem')).toHaveCount(7);
  // The fixture's day is consistent, so every check passes on its own figures.
  await expect(page.getByRole('status').filter({ hasText: 'All 7 checks passed' })).toBeVisible();
  await expect(checks.getByText('Passed', { exact: true })).toHaveCount(7);
  await expect(checks.getByRole('listitem').first()).toContainText(`Total ${uzs(expected.gameClubIncome - debts.reduce((sum, debt) => sum + debt.amount, 0))} UZS`);
});

test('MD-001 the dashboard\'s income cards open the month\'s money details, and Best day jumps to that day', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const [year, monthNumber] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const range = `from=${month}-01&to=${month}-${String(lastDay).padStart(2, '0')}`;
  const main = page.locator('#main-content');
  const collected = dailyCash.arcade.cash_income + dailyCash.arcade.terminal_income + dailyCash.arcade.card_income + dailyCash.arcade.playstation_income
    + debts.reduce((sum, debt) => sum + (debt.payment?.amount ?? 0), 0); // 2 850 000

  await page.goto('/dashboard');
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome);
  await main.getByRole('link', { name: /^Game Club Income/ }).click();
  await expect(page).toHaveURL(new RegExp(`/game-club-money-details\\?${range}$`));
  await expect(page.getByRole('heading', { name: 'Total Money Left calculation', level: 1 })).toBeVisible();
  // The headline: what was collected, less what the game club paid, is the money left.
  await expectDashboardAmount(page, 'Total Money Left', expected.gameClubMoneyLeft);
  await expectDashboardAmount(page, 'Total collected', collected);
  await expectDashboardAmount(page, 'Game club expenses', expected.gameClubExpenses);
  // The fixture has one business day, closed until it is asked for.
  const day = main.getByRole('button', { name: /Left for day/ });
  await expect(day).toHaveCount(1);
  await expect(day).toContainText(`${uzs(expected.gameClubMoneyLeft)} UZS`);
  await expect(day).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('region', { name: 'Day by day' }).getByRole('button', { name: /^Best day · / }).click();
  await expect(day).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator(`#money-day-${today}-panel`);
  await expect(panel.getByRole('link', { name: /^Cash/ })).toContainText(`${uzs(dailyCash.arcade.cash_income)} UZS`);
  // Money taken away prints with a real minus sign.
  await expect(panel.getByRole('listitem').filter({ hasText: expenses[0].comment })).toContainText(`− ${uzs(expenses[0].amount)} UZS`);
  await expect(page.locator(`#money-day-${today}`)).toBeInViewport();

  // The bar has the same page of its own.
  await page.goto('/dashboard');
  await expectDashboardAmount(page, 'Bar Sales', expected.barSales);
  await main.getByRole('link', { name: /^Bar Sales/ }).click();
  await expect(page).toHaveURL(new RegExp(`/bar-money-details\\?${range}$`));
  await expect(page.getByRole('heading', { name: 'Bar Money Left calculation', level: 1 })).toBeVisible();
  await expectDashboardAmount(page, 'Bar Money Left', expected.barSales - expected.stockPurchaseCost);
  await expectDashboardAmount(page, 'Total deductions', expected.stockPurchaseCost);
  await page.getByRole('region', { name: 'Day by day' }).getByRole('button', { name: /^Best day · / }).click();
  await expect(page.locator(`#money-day-${today}-panel`)).toContainText(`${products[purchase.product].name} × ${purchase.quantity}`);
  expect(errors).toEqual([]);
});

test('SAL-010 a history row opens its details with a link to the employee, and a KPI of 12,5 saves as 12.5', async ({ page }) => {
  const employee = crypto.randomUUID();
  expect((await restAs(accounts.owner, 'POST', 'rpc/save_salary_employee', {
    p_club_id: clubs.arcade.id, p_employee_id: employee, p_name: 'E2E Izzat', p_job_title: 'Admin',
    p_effective_date: today, p_salary_type: 'daily', p_amount: 100000, p_kpi_percent: 0, p_active: true,
  })).ok).toBe(true);
  expect((await restAs(accounts.owner, 'POST', 'rpc/record_salary_entry_with_status', {
    p_club_id: clubs.arcade.id, p_employee_id: employee, p_request_id: crypto.randomUUID(), p_date: today,
    p_kind: 'payment', p_amount: 50000, p_comment: '', p_payment_method: 'cash', p_payment_source: 'game_club',
  })).ok).toBe(true);

  await page.goto('/salaries/history');
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
  const row = page.locator('#main-content').getByRole('button', { name: /^Payment E2E Izzat/ });
  // A payment takes from what the employee is owed: a real minus sign, and a space before the unit.
  await expect(row).toContainText(`−${uzs(50_000)} UZS`);
  await row.click();
  const dialog = page.getByRole('dialog', { name: 'Payment' });
  await expect(dialog).toContainText('E2E Izzat');
  await expect(dialog).toContainText(`${uzs(50_000)} UZS`);
  await expect(dialog).toContainText('Entry type');
  await expect(dialog).toContainText('Cash');
  await expect(dialog.getByRole('link', { name: 'Open the employee' })).toHaveAttribute('href', `/salaries/employees/${employee}`);
  await dialog.getByRole('link', { name: 'Open the employee' }).click();
  await expect(page).toHaveURL(new RegExp(`/salaries/employees/${employee}$`));
  await expect(page.getByRole('heading', { name: 'E2E Izzat' })).toBeVisible();

  // Daily operations: the KPI percent is typed the way it is written here, with a comma.
  await page.goto('/salaries/operations');
  await expect(page.getByRole('heading', { name: 'Daily operations', level: 1 })).toBeVisible();
  await page.locator('#salary-employee-name').fill('E2E Kamola');
  await page.locator('#salary-employee-role').selectOption('Admin');
  await page.locator('#salary-amount').fill('90000');
  await page.locator('#salary-kpi').fill('12,5');
  await expect(page.locator('#salary-kpi')).toHaveValue('12,5');
  await page.locator('#main-content').getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => {
    const [saved] = await (await restAs(accounts.owner, 'GET', `salary_employees?select=id&club_id=eq.${clubs.arcade.id}&name=eq.E2E%20Kamola`)).json();
    if (!saved) return [];
    const rates = await (await restAs(accounts.owner, 'GET', `salary_rates?select=amount,kpi_percent&employee_id=eq.${saved.id}`)).json();
    return rates.map(rate => [Number(rate.amount), Number(rate.kpi_percent)]);
  }).toEqual([[90000, 12.5]]);
});

test('NAV-004 the assistant, daily operations, game library and Google Maps pages each open with one title and no error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [path, heading] of [['/assistant', 'AI Assistant'], ['/salaries/operations', 'Daily operations'], ['/showcase/games', 'Public page'], ['/showcase/google', 'Public page']]) {
    const response = await page.goto(path);
    expect(response.status(), path).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    // Past its loading state: the skeleton is gone and the page's own content is there.
    await expect(page.locator('#main-content [aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 }), `${path} has one title`).toHaveCount(1);
    // The route announcer is an empty alert; anything with words in it is an error shown to the user.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ }), `${path} shows an error`).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('STOCK-010 the Closing Stock "More actions" menu works from the keyboard', async ({ page }) => {
  await page.goto('/closing-stock');
  await expect(page.getByRole('heading', { name: 'Closing Stock', level: 1 })).toBeVisible();
  // The header keeps the two everyday actions; the rest are behind "More actions".
  await expect(page.getByRole('button', { name: 'Save Stock Counts' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Write-off' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bulk Update' })).toHaveCount(0);
  const more = page.getByRole('button', { name: 'More actions' });
  const menu = page.getByRole('menu', { name: 'More actions' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // Enter opens it with the first action focused; Escape closes it and gives the focus back.
  await expect(async () => {
    await more.focus();
    if (!(await menu.isVisible())) await page.keyboard.press('Enter');
    await expect(menu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const bulk = menu.getByRole('menuitem', { name: 'Bulk Update' });
  await expect(bulk).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // Arrow down opens it too, and the arrows stay inside the menu.
  await page.keyboard.press('ArrowDown');
  await expect(bulk).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').and(page.locator(':focus'))).toHaveCount(1);
  await page.keyboard.press('Home');
  await expect(bulk).toBeFocused();
  // Enter on the action runs it: the bulk update form opens.
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test.describe('as a viewer', () => {
  test.use({ storageState: storageStatePath('viewer') });

  test('SYS-001 a viewer who opens /test-checklist is sent to the dashboard', async ({ page }) => {
    await page.goto('/test-checklist');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByRole('list', { name: 'System sanity checks' })).toHaveCount(0);
    // Nor is it offered: the palette has no such page for a member.
    const palette = await openCommandPalette(page);
    await palette.getByRole('combobox').fill('sanity');
    await expect(palette.getByRole('status')).toHaveText('Nothing matches. Try another word.');
  });
});

test.describe('a visitor of the public site', () => {
  test.use({ storageState: { cookies: [{ name: englishCookie.name, value: englishCookie.value, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] } });

  test('PUB-001 an unknown club page is a 404 in the public site\'s look, with a way home and no admin link', async ({ page }) => {
    const response = await page.goto('/club/no-such-club');
    expect(response.status()).toBe(404);
    await expect(page).toHaveURL(/\/club\/no-such-club$/);
    await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'To the home page' })).toHaveAttribute('href', '/');
    // A visitor is never pointed at the admin app.
    await expect(page.getByRole('link', { name: 'Back to dashboard' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /login|sign in/i })).toHaveCount(0);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

    test('PUB-002 the Sections menu button opens the section links of a club page', async ({ page }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Public reads are cached for a minute by slug, so each run publishes under a slug of its own.
      const slug = `e2e-arcade-${Date.now().toString(36)}`;
      expect((await restAs(accounts.owner, 'POST', 'club_showcases', {
        club_id: clubs.arcade.id, slug, is_published: true, headline: 'E2E Arcade', phone: '+998901234567', address: 'E2E street 1',
      })).status).toBe(201);
      const response = await page.goto(`/club/${slug}`);
      expect(response.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'E2E Arcade', level: 1 })).toBeVisible();

      // At this width the section links are not in the bar: they are behind the menu button.
      const bar = page.getByRole('banner');
      const menu = bar.getByRole('button', { name: 'Sections menu' });
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(bar.getByRole('link', { name: 'Contacts' })).toHaveCount(0);
      await expect(async () => {
        if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
        await expect(menu).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 });
      }).toPass({ timeout: 15000 });
      const contacts = bar.getByRole('link', { name: 'Contacts' });
      await expect(contacts).toBeVisible();
      await expect(contacts).toHaveAttribute('href', '#contacts');
      await expect(bar.getByRole('link', { name: 'Call us' })).toHaveAttribute('href', 'tel:+998901234567');
      // A link takes the visitor to its section and puts the menu away.
      await contacts.click();
      await expect(page).toHaveURL(/#contacts$/);
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(bar.getByRole('link', { name: 'Contacts' })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      expect(errors).toEqual([]);
    });

    test('PUB-003 a club page lists prices by zone, what the club offers, and writes the booking request for Telegram', async ({ page }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // A fresh slug reads past the minute-long public cache. The club's page exists already when PUB-002 ran first.
      const slug = `e2e-prices-${Date.now().toString(36)}`;
      const settings = {
        slug, is_published: true, telegram_url: 'https://t.me/e2e_arcade', address: 'E2E street 1', amenities: ['wifi', 'parking'],
        yandex_maps_url: 'https://yandex.uz/maps/org/e2e_arcade/1234567890/',
        translations: { branch: { en: 'Centre' }, landmark: { en: 'Next to the fountain' } },
      };
      const updated = await restAs(accounts.owner, 'PATCH', `club_showcases?club_id=eq.${clubs.arcade.id}`, settings);
      expect(updated.status).toBe(200);
      if ((await updated.json()).length === 0) {
        expect((await restAs(accounts.owner, 'POST', 'club_showcases', { club_id: clubs.arcade.id, ...settings })).status).toBe(201);
      }
      for (const offer of [
        { title: 'VIP · 1 hour', price: 20000, sort_order: 1 },
        { title: 'VIP · 2+1 hours', badge: '2+1', price: 40000, sort_order: 2 },
        { title: 'Combo: pizza night', badge: 'COMBO', price: 90000, sort_order: 3 },
        { title: 'Standard · 1 hour', price: 10000, time_window: '06:00 – 18:00', sort_order: 4 },
        { title: 'Standard · 1 hour', price: 15000, time_window: '18:00 – 06:00', sort_order: 5 },
        { title: 'Standard · Night package', price: 50000, time_window: '23:00 – 06:00', sort_order: 6 },
      ]) expect((await restAs(accounts.owner, 'POST', 'showcase_offers', { club_id: clubs.arcade.id, ...offer })).status).toBe(201);

      expect((await page.goto(`/club/${slug}`)).status()).toBe(200);
      const prices = page.locator('#prices');
      // On a phone the price list is one small table per zone: the hour rate, then each package with what it saves.
      // (The same figures are also one table for the whole club, shown from tablet width up.)
      await expect(prices.getByText('VIP', { exact: true }).locator('visible=true')).toBeVisible();
      await expect(prices.getByText('save 20 000').locator('visible=true')).toBeVisible();
      // A zone with a day and a night rate reads across: a column per time of day, a package sold at
      // other hours keeping its own time.
      const standard = prices.getByRole('table', { name: 'Standard' });
      await expect(standard.getByRole('columnheader', { name: '18:00 – 06:00' })).toBeVisible();
      const hour = standard.getByRole('row').filter({ hasText: 'One hour' });
      await expect(hour.getByRole('cell')).toHaveText([/10 000/, /15 000/]);
      await expect(standard.getByRole('row').filter({ hasText: 'Night package' })).toContainText('23:00 – 06:00');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await expect(prices.getByRole('heading', { name: 'Combo: pizza night' })).toBeVisible();
      await expect(page.locator('#amenities').getByText('Free Wi-Fi')).toBeVisible();
      await expect(page.locator('#contacts').getByText('Next to the fountain')).toBeVisible();
      // The club's place on the map is framed once the page runs, behind a placeholder until the map has drawn.
      await expect(page.locator('#contacts iframe')).toHaveAttribute('src', 'https://yandex.uz/map-widget/v1/?oid=1234567890&ol=biz&z=16');

      // The bottom bar's booking button opens the form; the link carries the request as a Telegram draft.
      await page.getByRole('navigation', { name: 'Quick actions' }).getByRole('button', { name: 'Book a seat' }).click();
      const form = page.getByRole('dialog', { name: 'Book a seat' });
      await form.getByRole('radio', { name: 'VIP' }).click();
      await form.getByRole('radio', { name: 'Tomorrow' }).click();
      await form.getByRole('button', { name: 'More people' }).click();
      await expect(form.getByText('Zone: VIP')).toBeVisible();
      await expect(form.getByText('People: 2')).toBeVisible();
      const send = form.getByRole('link', { name: 'Send in Telegram' });
      const href = await send.getAttribute('href');
      expect(href.startsWith('https://t.me/e2e_arcade?text=')).toBe(true);
      expect(decodeURIComponent(href)).toContain('Zone: VIP');
      await page.keyboard.press('Escape');
      await expect(form).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});
