#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const readXlsxFile = require('read-excel-file/node');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_WORKBOOK = '';
const DEFAULT_SOURCE_SHEET = '31.05.2026';
const DEFAULT_TARGET_DATE = '2026-06-01';

function parseArgs(argv) {
  const args = {
    apply: false,
    workbook: DEFAULT_WORKBOOK,
    sourceSheet: DEFAULT_SOURCE_SHEET,
    date: DEFAULT_TARGET_DATE,
    clubId: '',
  };

  argv.forEach((arg) => {
    if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--workbook=')) args.workbook = arg.slice('--workbook='.length);
    else if (arg.startsWith('--source-sheet=')) args.sourceSheet = arg.slice('--source-sheet='.length);
    else if (arg.startsWith('--date=')) args.date = arg.slice('--date='.length);
    else if (arg.startsWith('--club-id=')) args.clubId = arg.slice('--club-id='.length);
  });

  return args;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        if (index === -1) return [line, ''];
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(',', '.').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readItems(workbookPath, sourceSheet) {
  const rows = await readXlsxFile(workbookPath, { sheet: sourceSheet });

  return rows
    .slice(1)
    .map((row, index) => {
      const name = String(row[0] ?? '').trim();
      const salePrice = asNumber(row[1]);
      const costPrice = asNumber(row[2]);
      const openingStock = asNumber(row[3]);
      const soldQty = asNumber(row[4]);
      const receivedQty = asNumber(row[5]);
      const juneOpeningStock = openingStock - soldQty + receivedQty;

      return {
        source_row: index + 2,
        name,
        category: 'bar',
        sale_price: salePrice,
        cost_price: costPrice,
        current_stock: juneOpeningStock,
        low_stock_threshold: 5,
        is_active: true,
      };
    })
    .filter((item) => item.name && (item.sale_price > 0 || item.cost_price > 0));
}

function productKey(product) {
  return [
    String(product.name).trim().toLowerCase(),
    Number(product.sale_price).toFixed(2),
    Number(product.cost_price).toFixed(2),
  ].join('|');
}

async function getTargetClubId(supabase, args, supabaseUrl) {
  // No default club: the service role bypasses RLS, so the target must be named
  // explicitly and checked to exist before any row is written.
  if (!args.clubId) {
    throw new Error('Pass --club-id=<uuid> to choose the club explicitly.');
  }

  const { data, error } = await supabase
    .from('clubs')
    .select('id, name')
    .eq('id', args.clubId)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error('No club with that --club-id.');
  }

  console.log(`Target club: ${data.name} (${data.id}) at ${new URL(supabaseUrl).host}`);
  return data.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.workbook) {
    throw new Error('Pass the workbook path with --workbook=/absolute/path/to/file.xlsx');
  }
  const env = {
    ...loadEnvFile(path.join(process.cwd(), '.env.local')),
    ...process.env,
  };

  const items = await readItems(args.workbook, args.sourceSheet);
  const duplicateNames = items
    .map((item) => item.name)
    .filter((name, index, names) => names.indexOf(name) !== index);

  console.log(`Workbook: ${args.workbook}`);
  console.log(`Source sheet: ${args.sourceSheet}`);
  console.log(`Target date: ${args.date}`);
  console.log(`Bar items found: ${items.length}`);
  console.log(`Duplicate item names kept as separate price/cost rows: ${new Set(duplicateNames).size}`);
  console.table(
    items.slice(0, 10).map((item) => ({
      row: item.source_row,
      name: item.name,
      sale_price: item.sale_price,
      cost_price: item.cost_price,
      june_opening_stock: item.current_stock,
    }))
  );

  if (!args.apply) {
    console.log('\nDry run only. Re-run with --apply to write products and 2026-06-01 stock counts.');
    return;
  }

  if (!args.clubId) {
    throw new Error('Pass --club-id=<uuid> to choose the club explicitly.');
  }

  // Closing stock counts are written only by save_closing_stock_counts for
  // signed-in users (migration 086), so this direct import needs the service role.
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase URL/key. Expected NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const clubId = await getTargetClubId(supabase, args, supabaseUrl);

  const { data: existingProducts, error: existingError } = await supabase
    .from('products')
    .select('id,name,sale_price,cost_price')
    .eq('club_id', clubId);
  if (existingError) throw existingError;

  const byKey = new Map((existingProducts ?? []).map((product) => [productKey(product), product]));
  const productsToInsert = items.filter((item) => !byKey.has(productKey(item)));

  if (productsToInsert.length > 0) {
    const { data: insertedProducts, error: insertError } = await supabase
      .from('products')
      .insert(
        productsToInsert.map((item) => ({
          club_id: clubId,
          name: item.name,
          category: item.category,
          sale_price: item.sale_price,
          cost_price: item.cost_price,
          current_stock: item.current_stock,
          low_stock_threshold: item.low_stock_threshold,
          is_active: item.is_active,
        }))
      )
      .select('id,name,sale_price,cost_price');
    if (insertError) throw insertError;
    (insertedProducts ?? []).forEach((product) => byKey.set(productKey(product), product));
  }

  const stockRows = items.map((item) => {
    const product = byKey.get(productKey(item));
    if (!product) throw new Error(`Could not resolve product after insert: ${item.name}`);

    return {
      date: args.date,
      club_id: clubId,
      product_id: product.id,
      previous_stock: item.current_stock,
      added_today: 0,
      closing_stock: item.current_stock,
      sold_quantity: 0,
      sale_price: item.sale_price,
      cost_price: item.cost_price,
      bar_income: 0,
      bar_cost: 0,
      bar_profit: 0,
      created_by: null,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: upsertError } = await supabase
    .from('daily_stock_counts')
    .upsert(stockRows, { onConflict: 'club_id,date,product_id' });
  if (upsertError) throw upsertError;

  const { error: stockUpdateError } = await supabase
    .from('products')
    .upsert(
      items.map((item) => {
        const product = byKey.get(productKey(item));
        return {
          id: product.id,
          club_id: clubId,
          name: item.name,
          category: item.category,
          sale_price: item.sale_price,
          cost_price: item.cost_price,
          current_stock: item.current_stock,
          low_stock_threshold: item.low_stock_threshold,
          is_active: item.is_active,
          updated_at: new Date().toISOString(),
        };
      })
    );
  if (stockUpdateError) throw stockUpdateError;

  console.log(`\nDone. Inserted ${productsToInsert.length} new products.`);
  console.log(`Upserted ${stockRows.length} stock rows for ${args.date}.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
