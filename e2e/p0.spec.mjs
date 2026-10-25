// P0 cases from .claude/skills/qa/references/cases.md, run in a browser on the fixed fixture (e2e/fixture.mjs)
// against the app's own schema, RLS and RPCs in PGlite (e2e/fake-supabase.mjs). Each test names its catalog cases.
// Expected figures are worked out from the fixture, never read off the screen.
import { test, expect } from '@playwright/test';
import { englishCookie, expectDashboardAmount, open, pageText, resetDatabase, restAs, signIn, uzs } from './helpers.mjs';
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
    await expect(page).toHaveURL(/\/$/);
    expect(leaked).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test('DASH-001 the dashboard headline figures equal the fixture arithmetic', async ({ page }) => {
  await page.goto('/');
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome);
  await expectDashboardAmount(page, 'Bar Sales', expected.barSales);
  await expectDashboardAmount(page, 'Total Expenses', expected.totalExpenses);
  await expectDashboardAmount(page, 'Net Profit', expected.netProfit);
  await expectDashboardAmount(page, 'Active Debts', expected.activeDebts);
  await expectDashboardAmount(page, 'PlayStation Income', expected.playstationIncome);
  // Accounting profit and cash left are different numbers: bar money left deducts the purchase, not the cost of goods.
  await expectDashboardAmount(page, 'Bar Money Left', expected.barSales - expected.stockPurchaseCost);
  await expectDashboardAmount(page, 'Bar Net Profit', expected.barSales - expected.barCost);
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
  await expectDashboardAmount(page, 'Net Profit', expected.netProfit + 100_000);
  await expectDashboardAmount(page, 'Total Expenses', expected.totalExpenses);
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
  await dialog.getByRole('button', { name: 'Save Expense' }).click();
  await expect(page.getByText('Expense registered successfully.')).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(posts).toHaveLength(1);
  const rows = await (await restAs(accounts.owner, 'GET', `expenses?select=amount,category,payment_source&club_id=eq.${clubs.arcade.id}&date=eq.${today}&order=created_at.asc`)).json();
  expect(rows).toHaveLength(expenses.length + 1);
  expect(rows.at(-1)).toEqual({ amount: 25000, category: 'cleaning', payment_source: 'game_club' });
  await open(page, 'Dashboard');
  await expectDashboardAmount(page, 'Total Expenses', expected.totalExpenses + 25_000);
  await expectDashboardAmount(page, 'Net Profit', expected.netProfit - 25_000);
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome);
});

test('EXP-008 a planned expense is set up in Settings, picked in the expense form and compared in Financial analysis', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Add planned expense' }).click();
  const presetDialog = page.getByRole('dialog', { name: 'Add planned expense' });
  await presetDialog.locator('#expense-preset-name').fill('iCafe');
  await presetDialog.locator('#expense-preset-category').selectOption('equipment');
  await presetDialog.locator('#expense-preset-amount').fill('500000');
  await expect(presetDialog.locator('#expense-preset-amount')).toHaveValue('500 000');
  await presetDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Planned expense saved')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Planned expenses' }).getByText('iCafe')).toBeVisible();

  await page.goto('/reports');
  await page.getByRole('button', { name: 'Register Expense' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register Expense' });
  await dialog.getByRole('radio', { name: 'iCafe' }).click();
  await expect(dialog.locator('#expense-category')).toHaveValue('equipment');
  await expect(dialog.locator('#expense-category')).toBeDisabled();
  await dialog.locator('#expense-amount').fill('650000');
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
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Debt saved')).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'E2E Debtor' });
  await expect(row).toContainText(uzs(100_000));
  await row.getByRole('button', { name: 'Accept payment' }).click();
  const payment = page.getByRole('dialog', { name: 'Partial Payment' });
  await payment.locator('#payment-amount').fill('40000');
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
  await expectDashboardAmount(page, 'Total Expenses', 0);
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

test('REP-008 a tap on the money flow opens its own Sankey, and one inside it opens the next', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/financial-analysis');
  await expect(page.getByRole('heading', { name: 'Financial Analysis', level: 1 })).toBeVisible();
  const dialog = page.getByRole('dialog');

  // New debts open the game club: its income, including the debts, against what it paid for.
  await page.getByRole('button', { name: 'Open New debts' }).click();
  await expect(dialog.getByRole('heading', { name: 'Game Club', exact: true })).toBeVisible();
  const debtIncome = debts.reduce((sum, debt) => sum + debt.amount, 0);
  await expect(dialog.locator('title', { hasText: new RegExp(`^New debts: ${uzs(debtIncome)} `) })).toHaveCount(1);
  const gameClubLeft = expected.gameClubIncome + expected.playstationIncome - expected.totalExpenses;
  await expect(dialog.locator('title', { hasText: new RegExp(`^Game club profit: ${uzs(gameClubLeft)} `) })).toHaveCount(1);
  await page.keyboard.press('Escape');

  // A category: the money that paid it, and its payments listed below.
  const [cleaning] = expenses;
  await page.getByRole('button', { name: 'Open Cleaning' }).click();
  await expect(dialog.getByRole('heading', { name: 'Cleaning' })).toBeVisible();
  await expect(dialog.locator('title', { hasText: new RegExp(`^Paid from game club: ${uzs(cleaning.amount)} `) })).toHaveCount(1);
  await expect(dialog.getByRole('listitem').filter({ hasText: cleaning.comment })).toContainText(uzs(cleaning.amount));
  await page.keyboard.press('Escape');

  // Bar sales → Bar → Bar profit → Profit, and Back again.
  await page.getByRole('button', { name: 'Open Bar sales' }).click();
  await expect(dialog.getByRole('heading', { name: 'Bar', exact: true })).toBeVisible();
  await expect(dialog.locator('title', { hasText: new RegExp(`^Bar profit: ${uzs(expected.barSales - expected.barCost)} `) })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Open Bar profit' }).click();
  await expect(dialog.getByRole('heading', { name: 'Profit', exact: true })).toBeVisible();
  await expect(dialog.locator('title', { hasText: new RegExp(`^Profit: ${uzs(expected.netProfit)} `) })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog.getByRole('heading', { name: 'Bar', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
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
    const response = await page.request.post('/api/expenses', { data: { clubId: clubs.arcade.id, date: today, amount: 1000, category: 'cleaning', paymentMethod: 'cash', paymentSource: 'game_club' } });
    expect(response.status()).toBe(403);
    // Straight to the database API with the viewer's own token: RLS, not the UI, is the boundary.
    expect((await restAs(accounts.viewer, 'POST', 'new_debts', { club_id: clubs.arcade.id, person_name: 'E2E Intruder', amount: 1, remaining_amount: 1, date: today, category: 'other', status: 'unpaid', created_by: accounts.viewer.id })).status).toBe(403);
    expect((await restAs(accounts.viewer, 'POST', 'rpc/record_stock_purchase', { p_club_id: clubs.arcade.id, p_date: today, p_product_id: products.cola.id, p_quantity: 1, p_cost_price: 1 })).status).toBe(403);
    // A member of E2E Arcade only: the other club's ledgers are invisible, not just empty on screen.
    expect(await (await restAs(accounts.viewer, 'GET', `products?select=id&club_id=eq.${clubs.bunker.id}`)).json()).toEqual([]);
    const rows = await (await restAs(accounts.owner, 'GET', `expenses?select=id&club_id=eq.${clubs.arcade.id}`)).json();
    // The owner-only health check is refused to a member, not reported as missing migrations.
    expect((await restAs(accounts.viewer, 'POST', 'rpc/get_migration_health', { p_club_id: clubs.arcade.id })).status).toBe(403);
    expect(rows).toHaveLength(expenses.length);
  });
});

test('I18N-003 switching language keeps the figures and formats money as 1 000 000', async ({ page }) => {
  await page.goto('/');
  await expectDashboardAmount(page, 'Game Club Income', expected.gameClubIncome);
  await page.getByRole('group', { name: 'Language / Язык / Til' }).getByRole('button', { name: 'Русский' }).click();
  await expect(page.getByRole('heading', { name: 'Панель управления', level: 1 })).toBeVisible();
  await expectDashboardAmount(page, 'Доход клуба', expected.gameClubIncome);
  expect(uzs(expected.gameClubIncome)).toBe('3 200 000');
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
    for (const [path, heading] of [['/', 'Dashboard'], ['/daily-cash', 'Daily Cash Entry'], ['/closing-stock', 'Closing Stock'], ['/stock-purchase', 'Stock Purchase'], ['/reports', 'Reports'], ['/debts', 'Debts']]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${path} overflows` }).toBe(0);
    }
    expect(errors).toEqual([]);
  });
});
