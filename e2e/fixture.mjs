// The fixed state every browser test starts from: two clubs, an owner, an admin and a viewer, and one business day
// of income, expenses, a purchase, closing stock counts and debts with totals worked out by hand below. Account rows
// and ledgers are seeded as the database superuser (triggers still run); the stock purchase and the closing stock
// counts go through the app's own atomic RPCs as the owner, so product stock and cost basis are what production
// would hold. Every test's expectations come from this file, never from the screen.
import { accounts } from './settings.mjs';

/** The clubs' business date (Asia/Tashkent, business day starting at midnight), as the app computes it. */
export const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const id = n => `e2e00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const clubs = {
  // Not "Pixel": clubs named so enter sold quantities instead of closing counts on the Closing Stock page.
  arcade: { id: id(1), name: 'E2E Arcade' },
  bunker: { id: id(2), name: 'E2E Bunker' },
};
export const products = {
  cola: { id: id(10), club: 'arcade', name: 'E2E Cola 0.5L', category: 'drinks', sale_price: 8000, cost_price: 4500, current_stock: 50, low_stock_threshold: 10 },
  snickers: { id: id(11), club: 'arcade', name: 'E2E Snickers', category: 'snacks', sale_price: 5000, cost_price: 2800, current_stock: 30, low_stock_threshold: 8 },
  water: { id: id(12), club: 'bunker', name: 'E2E Water 1.5L', category: 'drinks', sale_price: 4000, cost_price: 1800, current_stock: 60, low_stock_threshold: 15 },
};
export const dailyCash = {
  arcade: { cash_income: 1_200_000, terminal_income: 850_000, card_income: 350_000, playstation_income: 250_000 },
  bunker: { cash_income: 500_000, terminal_income: 0, card_income: 0, playstation_income: 0 },
};
// Cola: 50 on hand + 24 bought = 74, 62 counted → 12 sold. Snickers: 30, 18 counted → 12 sold.
export const purchase = { product: 'cola', quantity: 24, cost_price: 4500, payment_method: 'cash' };
export const closing = { cola: { closing_stock: 62, sold_quantity: 12 }, snickers: { closing_stock: 18, sold_quantity: 12 } };
export const expenses = [
  { id: id(20), amount: 120_000, category: 'cleaning', payment_method: 'cash', payment_source: 'game_club', comment: 'E2E cleaning' },
  { id: id(21), amount: 80_000, category: 'electricity', payment_method: 'card', payment_source: 'game_club', comment: 'E2E electricity' },
];
export const debts = [
  { id: id(30), person_name: 'E2E Alibek', amount: 500_000, payment: { id: id(31), amount: 200_000, payment_method: 'cash' } },
  { id: id(32), person_name: 'E2E Sardor', amount: 300_000, payment: null },
];

/** What the fixture adds up to for club E2E Arcade's current business month, per src/lib/calculations/dashboardMetrics.ts. */
const arcadeCash = dailyCash.arcade;
const debtIncome = debts.reduce((sum, debt) => sum + debt.amount, 0); // 800 000
const barSales = closing.cola.sold_quantity * products.cola.sale_price + closing.snickers.sold_quantity * products.snickers.sale_price; // 156 000
const barCost = closing.cola.sold_quantity * products.cola.cost_price + closing.snickers.sold_quantity * products.snickers.cost_price; // 87 600
const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0); // 200 000
export const expected = {
  /** "Game Club Income": cash + terminal + card + new debts. */
  gameClubIncome: arcadeCash.cash_income + arcadeCash.terminal_income + arcadeCash.card_income + debtIncome, // 3 200 000
  playstationIncome: arcadeCash.playstation_income,
  barSales,
  barCost,
  stockPurchaseCost: purchase.quantity * purchase.cost_price, // 108 000
  totalExpenses,
  /** "Net Profit": accounting profit = game club income (with PlayStation) + bar sales − cost of goods − expenses. */
  netProfit: arcadeCash.cash_income + arcadeCash.terminal_income + arcadeCash.card_income + arcadeCash.playstation_income + debtIncome + barSales - barCost - totalExpenses, // 3 318 400
  activeDebts: debts.reduce((sum, debt) => sum + debt.amount - (debt.payment?.amount ?? 0), 0), // 600 000
  colaStock: products.cola.current_stock + purchase.quantity - closing.cola.sold_quantity, // 62
  bunkerGameClubIncome: dailyCash.bunker.cash_income, // 500 000
};

/** Seeds the fixture into a fresh fake (e2e/fake-supabase.mjs). */
export async function seed(fake) {
  for (const account of Object.values(accounts)) await fake.addUser(account);
  const { owner, admin, viewer } = accounts;
  const q = (sql, params) => fake.query(sql, params);
  // The owner owns both clubs globally and locally; the admin and viewer belong to E2E Arcade only.
  await q(`update public.profiles set role = 'owner' where id = $1`, [owner.id]);
  for (const club of Object.values(clubs)) await q(`insert into public.clubs (id, name, address) values ($1, $2, 'E2E street 1')`, [club.id, club.name]);
  await q(`insert into public.club_memberships (club_id, user_id, role) values ($1, $2, 'owner'), ($3, $2, 'owner'), ($1, $4, 'admin'), ($1, $5, 'viewer')`,
    [clubs.arcade.id, owner.id, clubs.bunker.id, admin.id, viewer.id]);
  for (const product of Object.values(products)) {
    await q(`insert into public.products (id, club_id, name, category, sale_price, cost_price, current_stock, low_stock_threshold, is_active, tracks_inventory)
      values ($1, $2, $3, $4, $5, $6, $7, $8, true, true)`,
      [product.id, clubs[product.club].id, product.name, product.category, product.sale_price, product.cost_price, product.current_stock, product.low_stock_threshold]);
  }
  for (const [club, entry] of Object.entries(dailyCash)) {
    await q(`insert into public.daily_cash_entries (club_id, date, cash_income, terminal_income, card_income, playstation_income, comment, created_by)
      values ($1, $2, $3, $4, $5, $6, 'E2E fixture', $7)`,
      [clubs[club].id, today, entry.cash_income, entry.terminal_income, entry.card_income, entry.playstation_income, owner.id]);
  }
  for (const expense of expenses) {
    await q(`insert into public.expenses (id, club_id, date, amount, category, payment_method, payment_source, comment, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [expense.id, clubs.arcade.id, today, expense.amount, expense.category, expense.payment_method, expense.payment_source, expense.comment, owner.id]);
  }
  for (const debt of debts) {
    await q(`insert into public.new_debts (id, club_id, person_name, amount, remaining_amount, date, category, status, comment, created_by)
      values ($1, $2, $3, $4, $4, $5, 'other', 'unpaid', 'E2E fixture', $6)`, [debt.id, clubs.arcade.id, debt.person_name, debt.amount, today, owner.id]);
    // The payment's trigger updates the parent debt: the ledger is append-only.
    if (debt.payment) await q(`insert into public.debt_payments (id, club_id, debt_id, amount, payment_method, date, comment) values ($1, $2, $3, $4, $5, $6, 'E2E fixture')`,
      [debt.payment.id, clubs.arcade.id, debt.id, debt.payment.amount, debt.payment.payment_method, today]);
  }
  // Through the atomic RPCs as the owner, exactly as the Stock Purchase and Closing Stock pages save.
  await fake.asUser(owner, async tx => {
    await tx.query(`select public.record_stock_purchase(p_club_id => $1, p_date => $2, p_product_id => $3, p_quantity => $4, p_cost_price => $5, p_sale_price => $6, p_payment_method => $7, p_comment => 'E2E fixture')`,
      [clubs.arcade.id, today, products[purchase.product].id, purchase.quantity, purchase.cost_price, products[purchase.product].sale_price, purchase.payment_method]);
    const counts = Object.entries(closing).map(([key, count]) => ({ product_id: products[key].id, closing_stock: count.closing_stock, sold_quantity: count.sold_quantity, adjustment_quantity: 0, giveaway_quantity: 0 }));
    await tx.query(`select public.save_closing_stock_counts(p_club_id => $1, p_date => $2, p_counts => $3::jsonb)`, [clubs.arcade.id, today, JSON.stringify(counts)]);
  });
}
