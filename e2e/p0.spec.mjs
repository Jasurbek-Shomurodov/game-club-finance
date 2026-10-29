// P0 cases from .claude/skills/qa/references/cases.md, run in a browser on the fixed fixture (e2e/fixture.mjs)
// against the app's own schema, RLS and RPCs in PGlite (e2e/fake-supabase.mjs). Each test names its catalog cases.
// Expected figures are worked out from the fixture, never read off the screen.
import { test, expect } from '@playwright/test';
import { englishCookie, expectDashboardAmount, expectGameClubExpenses, open, pageText, resetDatabase, restAs, signIn, uzs } from './helpers.mjs';
import { clubs, dailyCash, debts, expected, expenses, products, today } from './fixture.mjs';
import { accounts, storageStatePath } from './settings.mjs';

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
  page.on('request', request => { if (['POST', 'PATCH'].includes(request.method()) && request.url().includes('/rest/v1/daily_cash_entries')) writes.push(request.url()); });
  await page.getByRole('button', { name: 'Save Entry' }).click();
  await expect(page.getByText('Entry updated.')).toBeVisible();
  expect(writes).toHaveLength(1);
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
  // A note of fewer than 5 words is refused with a popup, before any request.
  await dialog.locator('#expense-comment').fill('cleaning');
  await dialog.getByRole('button', { name: 'Save Expense' }).click();
  const notePopup = page.getByRole('dialog', { name: 'Please add a note' });
  await expect(notePopup).toContainText('So far: 1 of 5 words.');
  await notePopup.getByRole('button', { name: 'Write the note' }).click();
  await expect(dialog.getByText('Write at least 5 words (1 of 5)')).toBeVisible();
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
  await expect(page.getByText('Date changed')).toBeVisible();
  const [row] = await (await restAs(accounts.owner, 'GET', `expenses?select=date&id=eq.${cleaning.id}`)).json();
  expect(row.date).toBe(target);
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

  await open(page, 'Closing Stock');
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
  page.on('response', async response => {
    if (!response.url().includes('/rest/v1/')) return;
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
  await open(page, 'Products');
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
  // The test database is migrated without CLI history, like a SQL Editor install: the schema probes still prove every migration.
  await expect(health.getByText(/^All \d+ migrations are applied\.$/)).toBeVisible();
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

test.describe('as a viewer', () => {
  test.use({ storageState: storageStatePath('viewer') });

  test('AUTH-003 EXP-002 a viewer sees read-only pages and every write is refused by the server', async ({ page }) => {
    // Viewers get no write pages at all: the sidebar hides them and a direct visit is sent to an allowed page.
    await page.goto('/stock-purchase');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page).not.toHaveURL(/stock-purchase/);
    for (const label of ['Daily Cash', 'Closing Stock', 'Stock Purchase']) await expect(page.getByRole('navigation').getByRole('link', { name: label, exact: true })).toHaveCount(0);
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
    // The edit history is owner-only: no nav link, and RLS returns no rows to a member.
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Edit history', exact: true })).toHaveCount(0);
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

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('UI-001 every core page fits 375 px with no horizontal scroll', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [path, heading] of [['/', 'Dashboard'], ['/daily-cash', 'Daily Cash Entry'], ['/closing-stock', 'Closing Stock'], ['/stock-purchase', 'Stock Purchase'], ['/reports', 'Reports'], ['/debts', 'Debts'], ['/history', 'Edit history']]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${path} overflows` }).toBe(0);
    }
    expect(errors).toEqual([]);
  });
});
