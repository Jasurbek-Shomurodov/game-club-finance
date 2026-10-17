#!/usr/bin/env node
/**
 * Seed test/demo data for the game-club-finance app.
 * Usage: node scripts/seed-test-data.cjs --confirm --club-id=<uuid>
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 * NEVER run on production without --confirm and explicit review.
 */

const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const args = process.argv.slice(2);
const clubIdArg = args.find((arg) => arg.startsWith('--club-id='))?.slice('--club-id='.length);
if (!args.includes('--confirm')) {
  console.error('⚠️  Safety check: pass --confirm to run seed script.');
  console.error('   Example: node scripts/seed-test-data.cjs --confirm --club-id=<uuid>');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(url, key);

const today = new Date().toISOString().split('T')[0];

async function getTargetClubId() {
  // No default club: the service role bypasses RLS, so the target must be named
  // explicitly and checked to exist before any row is written or deleted.
  if (!clubIdArg) {
    console.error('❌ Pass --club-id=<uuid> to choose the club explicitly.');
    process.exit(1);
  }

  const { data, error } = await supabase
    .from('clubs')
    .select('id, name')
    .eq('id', clubIdArg)
    .maybeSingle();

  if (error || !data?.id) {
    console.error('❌ No club with that --club-id.');
    process.exit(1);
  }

  console.log(`Target club: ${data.name} (${data.id}) at ${new URL(url).host}`);
  return data.id;
}

async function seed() {
  const clubId = await getTargetClubId();
  console.log('🌱 Seeding test data for', today, '...\n');

  // 1. Insert products
  console.log('📦 Inserting products...');
  const products = [
    { name: '[TEST] Coca-Cola 0.5L', category: 'drinks', sale_price: 8000, cost_price: 4500, current_stock: 50, low_stock_threshold: 10, is_active: true },
    { name: '[TEST] Pepsi 0.5L', category: 'drinks', sale_price: 7500, cost_price: 4000, current_stock: 40, low_stock_threshold: 10, is_active: true },
    { name: '[TEST] Red Bull', category: 'energy', sale_price: 18000, cost_price: 10000, current_stock: 24, low_stock_threshold: 5, is_active: true },
    { name: '[TEST] Snickers', category: 'snacks', sale_price: 5000, cost_price: 2800, current_stock: 30, low_stock_threshold: 8, is_active: true },
    { name: "[TEST] Lay's Chips", category: 'snacks', sale_price: 9000, cost_price: 5500, current_stock: 20, low_stock_threshold: 5, is_active: true },
    { name: '[TEST] Water 1.5L', category: 'drinks', sale_price: 4000, cost_price: 1800, current_stock: 60, low_stock_threshold: 15, is_active: true },
    { name: '[TEST] Sprite 0.5L', category: 'drinks', sale_price: 7500, cost_price: 4000, current_stock: 35, low_stock_threshold: 8, is_active: true },
    { name: '[TEST] Monster Energy', category: 'energy', sale_price: 20000, cost_price: 12000, current_stock: 18, low_stock_threshold: 5, is_active: true },
    { name: '[TEST] KitKat', category: 'snacks', sale_price: 6000, cost_price: 3500, current_stock: 25, low_stock_threshold: 6, is_active: true },
    { name: '[TEST] Oreo', category: 'snacks', sale_price: 7000, cost_price: 4000, current_stock: 22, low_stock_threshold: 5, is_active: true },
  ].map((product) => ({ ...product, club_id: clubId }));

  const { data: insertedProducts, error: productsError } = await supabase
    .from('products')
    .insert(products)
    .select('id, name, sale_price, cost_price, current_stock');

  if (productsError) { console.error('❌ Products error:', productsError.message); process.exit(1); }
  console.log(`   ✅ Inserted ${insertedProducts.length} products`);

  const p = (name) => insertedProducts.find((pr) => pr.name === name);

  // 2. Daily cash entry
  console.log('💰 Inserting daily cash entry...');
  const { error: cashError } = await supabase.from('daily_cash_entries').upsert({
    club_id: clubId,
    date: today,
    cash_income: 1_200_000,
    terminal_income: 850_000,
    card_income: 350_000,
    playstation_income: 250_000,
    comment: '[TEST DATA] Demo daily cash entry',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'club_id,date' });
  if (cashError) { console.error('❌ Cash error:', cashError.message); process.exit(1); }
  console.log('   ✅ Daily cash entry: 1,200,000 cash + 850,000 terminal + 350,000 card + 250,000 PlayStation = 2,650,000 UZS');

  // 3. Stock purchases
  console.log('🛒 Inserting stock purchases...');
  const cocaCola = p('[TEST] Coca-Cola 0.5L');
  const redBull = p('[TEST] Red Bull');
  const { error: purchasesError } = await supabase.from('stock_purchases').insert([
    {
      club_id: clubId,
      date: today,
      product_id: cocaCola.id,
      quantity: 24,
      cost_price: 4500,
      sale_price: 8000,
      payment_method: 'cash',
      comment: '[TEST DATA] Demo purchase',
    },
    {
      club_id: clubId,
      date: today,
      product_id: redBull.id,
      quantity: 12,
      cost_price: 10000,
      sale_price: 18000,
      payment_method: 'card',
      comment: '[TEST DATA] Demo purchase',
    },
  ]);
  if (purchasesError) { console.error('❌ Purchases error:', purchasesError.message); process.exit(1); }
  console.log('   ✅ 2 stock purchases inserted');

  // 4. Closing stock count
  console.log('📊 Inserting closing stock count...');
  const snickers = p('[TEST] Snickers');
  const water = p('[TEST] Water 1.5L');
  const closingEntries = [
    {
      club_id: clubId,
      date: today,
      product_id: cocaCola.id,
      previous_stock: 50,
      added_today: 24,
      closing_stock: 62,
      sold_quantity: 12,
      sale_price: 8000,
      cost_price: 4500,
      bar_income: 96000,
      bar_cost: 54000,
      bar_profit: 42000,
      updated_at: new Date().toISOString(),
    },
    {
      club_id: clubId,
      date: today,
      product_id: snickers.id,
      previous_stock: 30,
      added_today: 0,
      closing_stock: 18,
      sold_quantity: 12,
      sale_price: 5000,
      cost_price: 2800,
      bar_income: 60000,
      bar_cost: 33600,
      bar_profit: 26400,
      updated_at: new Date().toISOString(),
    },
    {
      club_id: clubId,
      date: today,
      product_id: water.id,
      previous_stock: 60,
      added_today: 0,
      closing_stock: 48,
      sold_quantity: 12,
      sale_price: 4000,
      cost_price: 1800,
      bar_income: 48000,
      bar_cost: 21600,
      bar_profit: 26400,
      updated_at: new Date().toISOString(),
    },
  ];
  const { error: stockError } = await supabase
    .from('daily_stock_counts')
    .upsert(closingEntries, { onConflict: 'club_id,date,product_id' });
  if (stockError) { console.error('❌ Stock counts error:', stockError.message); process.exit(1); }
  console.log('   ✅ Closing stock for 3 products (bar income: 204,000 UZS)');

  // 5. Expenses
  console.log('💸 Inserting expenses...');
  const { error: expensesError } = await supabase.from('expenses').insert([
    { club_id: clubId, date: today, amount: 300000, category: 'salary', payment_method: 'cash', comment: '[TEST DATA] Staff salary' },
    { club_id: clubId, date: today, amount: 120000, category: 'cleaning', payment_method: 'cash', comment: '[TEST DATA] Cleaning service' },
    { club_id: clubId, date: today, amount: 80000, category: 'electricity', payment_method: 'card', comment: '[TEST DATA] Electricity bill' },
  ]);
  if (expensesError) { console.error('❌ Expenses error:', expensesError.message); process.exit(1); }
  console.log('   ✅ 3 expenses inserted (total: 500,000 UZS)');

  // 6. Debts
  console.log('📋 Inserting debts...');
  const { data: insertedDebts, error: debtsError } = await supabase
    .from('new_debts')
    .insert([
      { club_id: clubId, person_name: '[TEST] Alibek Karimov', amount: 500000, remaining_amount: 500000, paid_amount: 0, date: today, category: 'other', status: 'unpaid', comment: '[TEST DATA]' },
      { club_id: clubId, person_name: '[TEST] Sardor Yusupov', amount: 300000, remaining_amount: 300000, paid_amount: 0, date: today, category: 'other', status: 'unpaid', comment: '[TEST DATA]' },
    ])
    .select('id, person_name, remaining_amount');
  if (debtsError) { console.error('❌ Debts error:', debtsError.message); process.exit(1); }
  console.log(`   ✅ ${insertedDebts.length} debts inserted`);

  // 7. Partial debt payment
  console.log('💳 Inserting partial debt payment...');
  const firstDebt = insertedDebts[0];
  const { error: paymentError } = await supabase.from('debt_payments').insert({
    club_id: clubId,
    debt_id: firstDebt.id,
    amount: 200000,
    payment_method: 'cash',
    date: today,
    comment: '[TEST DATA] Partial payment',
  });
  if (paymentError) { console.error('❌ Debt payment error:', paymentError.message); process.exit(1); }
  console.log(`   ✅ Partial payment 200,000 for ${firstDebt.person_name}`);

  console.log('\n✅ Test data seeded successfully!\n');
  console.log('Summary for', today, ':');
  console.log('  Game Club Income: 2,400,000 UZS');
  console.log('  Bar Income (closing stock): 204,000 UZS');
  console.log('  Total Income: 2,604,000 UZS');
  console.log('  Total Expenses: 500,000 UZS');
  console.log('  Net Profit: 2,104,000 UZS');
  console.log('  Active Debts: 800,000 UZS (Alibek 300,000 remaining + Sardor 300,000)');
  console.log('\nAll test records are prefixed with [TEST] or [TEST DATA] for easy identification.');
  console.log('Run `npm run reset:test-data` to remove all test data.\n');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
