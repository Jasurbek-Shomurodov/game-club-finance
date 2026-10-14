import { describe, expect, it } from 'vitest';
import type { Product } from '@/types';
import { calculateStockOpeningBalances, summarizeStockRows } from './calculations/stock';
import {
  applyBulkStockOrder,
  applyClosingStockDraft,
  applyClosingStockImport,
  buildEditableClosingStockRows,
  buildClosingStockUpserts,
  calculateBulkStockOrderSummary,
  calculatePurchaseCostsByProduct,
  clearClosingStockDraft,
  closingStockDraftKey,
  closingStockRowTotalsInput,
  isReadOnlyClosingStockProduct,
  normalizeStockAdjustment,
  normalizeStockCount,
  parseClosingStockImportRecords,
  parseClosingStockImportSheetRows,
  readClosingStockDraft,
  saveClosingStockDraft,
  selectClosingStockImportRows,
  validateClosingStockRows,
  type ClosingStockImportSheet,
  type ClosingStockRowData,
  usesSoldQuantityEntry,
  type StorageLike,
} from './closingStock';

describe('closing stock bulk orders', () => {
  it('adds a group order to sold quantities and reduces tracked closing stock', () => {
    const rows = [
      row({
        product: product({ id: 'coke', name: 'Coke', sale_price: 12_000 }),
        previousStock: '10',
        addedToday: '2',
        closingStock: '9',
        soldQuantity: '3',
      }),
      row({
        product: product({ id: 'snickers', name: 'Snickers', sale_price: 9_000 }),
        previousStock: '8',
        addedToday: '0',
        closingStock: '7',
        soldQuantity: '1',
      }),
    ];

    const updated = applyBulkStockOrder(rows, [
      { productId: 'coke', quantity: 1 },
      { productId: 'snickers', quantity: 2 },
    ]);

    expect(updated[0]).toMatchObject({ soldQuantity: '4', closingStock: '8' });
    expect(updated[1]).toMatchObject({ soldQuantity: '3', closingStock: '5' });
    expect(validateClosingStockRows(updated)).toBeNull();
  });

  it('adds made-to-order products without creating a stock balance', () => {
    const updated = applyBulkStockOrder([
      row({
        product: product({ id: 'hot-dog', name: 'Hot dog', tracks_inventory: false }),
        previousStock: '0',
        addedToday: '0',
        closingStock: '0',
        soldQuantity: '4',
      }),
    ], [{ productId: 'hot-dog', quantity: 3 }]);

    expect(updated[0]).toMatchObject({ soldQuantity: '7', closingStock: '0' });
  });

  it('rejects a bulk quantity above the remaining closing stock', () => {
    expect(() => applyBulkStockOrder([
      row({
        product: product({ id: 'fanta', name: 'Fanta' }),
        closingStock: '2',
        soldQuantity: '3',
      }),
    ], [{ productId: 'fanta', quantity: 3 }])).toThrow(/only 2 units are available/i);
  });

  it('calculates the customer total across products and merged lines', () => {
    const rows = [
      row({ product: product({ id: 'coke', sale_price: 12_000 }) }),
      row({ product: product({ id: 'adrenalin', sale_price: 18_000 }) }),
    ];

    expect(calculateBulkStockOrderSummary(rows, [
      { productId: 'coke', quantity: 1 },
      { productId: 'adrenalin', quantity: 2 },
      { productId: 'coke', quantity: 2 },
    ])).toEqual({
      totalQuantity: 5,
      totalPrice: 72_000,
    });
  });
});

describe('closing stock purchase costs', () => {
  it('totals actual ledger cost by product across multiple purchases', () => {
    expect(calculatePurchaseCostsByProduct([
      { product_id: 'cola', quantity: 12, cost_price: 5860 },
      { product_id: 'cola', quantity: 6, cost_price: 6000 },
      { product_id: 'water', quantity: 24, cost_price: 2511 },
    ])).toEqual({
      cola: 106_320,
      water: 60_264,
    });
  });

  it('accepts numeric database strings and ignores invalid values', () => {
    expect(calculatePurchaseCostsByProduct([
      { product_id: 'cola', quantity: '12', cost_price: '5860' },
      { product_id: 'cola', quantity: 'invalid', cost_price: 5000 },
    ])).toEqual({ cola: 70_320 });
  });
});

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('blocked');
  }

  setItem(): void {
    throw new Error('blocked');
  }

  removeItem(): void {
    throw new Error('blocked');
  }
}

function product(overrides: Partial<Product>): Product {
  return {
    id: overrides.id ?? 'product-1',
    club_id: overrides.club_id ?? 'club-1',
    name: overrides.name ?? 'Cola 1.5L',
    category: overrides.category ?? null,
    sale_price: overrides.sale_price ?? 15000,
    cost_price: overrides.cost_price ?? 9000,
    current_stock: overrides.current_stock ?? 0,
    tracks_inventory: overrides.tracks_inventory ?? true,
    low_stock_threshold: overrides.low_stock_threshold ?? null,
    sort_order: overrides.sort_order ?? null,
    is_active: overrides.is_active ?? true,
    is_deleted: overrides.is_deleted ?? false,
    created_at: overrides.created_at ?? '2026-06-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-06-01T00:00:00.000Z',
  };
}

function row(overrides: Partial<ClosingStockRowData>): ClosingStockRowData {
  return {
    product: overrides.product ?? product({}),
    previousStock: overrides.previousStock ?? '10',
    addedToday: overrides.addedToday ?? '5',
    closingStock: overrides.closingStock ?? '12',
    soldQuantity: overrides.soldQuantity ?? '3',
    adjustmentQuantity: overrides.adjustmentQuantity ?? '0',
    adjustmentReason: overrides.adjustmentReason ?? '',
    giveawayQuantity: overrides.giveawayQuantity ?? '0',
    promotionId: overrides.promotionId ?? null,
  };
}

function recordsFromWorkbook(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows;
}

function sheetsFromWorkbook(sheets: Array<{ name: string; rows: unknown[][] }>): ClosingStockImportSheet[] {
  return sheets;
}

describe('closing stock row defaults', () => {
  it('uses direct sales with no stock balance for made-to-order products', () => {
    const rows = buildEditableClosingStockRows({
      products: [product({
        id: 'hot-dog',
        name: 'XOT DOG',
        current_stock: 922,
        tracks_inventory: false,
      })],
      counts: [{ product_id: 'hot-dog', sold_quantity: 4 }],
      purchases: [],
      previousClosings: { 'hot-dog': 922 },
      isCurrentDate: true,
    });

    expect(rows[0]).toMatchObject({
      previousStock: '0',
      addedToday: '0',
      closingStock: '0',
      soldQuantity: '4',
    });
  });

  it('does not leak current stock from later purchases into an unsaved historical date', () => {
    const rows = buildEditableClosingStockRows({
      products: [
        product({
          id: 'cola-05',
          name: 'Koka kola 0.5',
          current_stock: 21,
          cost_price: 5833,
        }),
      ],
      counts: [],
      purchases: [],
      previousClosings: {},
      isCurrentDate: false,
    });

    expect(rows[0]).toMatchObject({
      previousStock: '0',
      addedToday: '0',
      closingStock: '0',
      soldQuantity: '0',
    });
  });

  it('keeps current-date defaults as live stock left after today purchases', () => {
    const rows = buildEditableClosingStockRows({
      products: [
        product({
          id: 'cola-05',
          name: 'Koka kola 0.5',
          current_stock: 21,
          cost_price: 5833,
        }),
      ],
      counts: [],
      purchases: [{ product_id: 'cola-05', quantity: 21 }],
      previousClosings: {},
      isCurrentDate: true,
    });

    expect(rows[0]).toMatchObject({
      previousStock: '0',
      addedToday: '21',
      closingStock: '21',
      soldQuantity: '0',
    });
  });

  it('uses previous saved closing plus same-day purchases for historical defaults', () => {
    const rows = buildEditableClosingStockRows({
      products: [
        product({
          id: 'cola-05',
          name: 'Koka kola 0.5',
          current_stock: 21,
          cost_price: 5833,
        }),
      ],
      counts: [],
      purchases: [{ product_id: 'cola-05', quantity: 4 }],
      previousClosings: { 'cola-05': 10 },
      isCurrentDate: false,
    });

    expect(rows[0]).toMatchObject({
      previousStock: '10',
      addedToday: '4',
      closingStock: '14',
      soldQuantity: '0',
    });
  });

  it('refreshes a current-day saved row from purchases while preserving sold quantity', () => {
    const rows = buildEditableClosingStockRows({
      products: [product({ id: 'cola-05', current_stock: 21, sale_price: 10000, cost_price: 6000 })],
      counts: [
        {
          product_id: 'cola-05',
          previous_stock: 7,
          added_today: 2,
          closing_stock: 6,
          sold_quantity: 3,
        },
      ],
      purchases: [{ product_id: 'cola-05', quantity: 21 }],
      previousClosings: {},
      isCurrentDate: true,
    });

    expect(rows[0]).toMatchObject({
      previousStock: '7',
      addedToday: '21',
      closingStock: '25',
      soldQuantity: '3',
      hasPurchaseMismatch: false,
    });
  });

  it('preserves a historical whole-unit snapshot and exposes a later purchase mismatch', () => {
    const rows = buildEditableClosingStockRows({
      products: [product({ id: 'cola-05', current_stock: 21, sale_price: 10000, cost_price: 6000 })],
      counts: [
        {
          product_id: 'cola-05',
          previous_stock: 7,
          added_today: 2,
          closing_stock: 6,
          sold_quantity: 3,
        },
      ],
      purchases: [{ product_id: 'cola-05', quantity: 21 }],
      previousClosings: {},
      isCurrentDate: false,
    });

    expect(rows[0]).toMatchObject({
      previousStock: '7',
      addedToday: '2',
      closingStock: '6',
      soldQuantity: '3',
      purchaseQuantity: 21,
      hasPurchaseMismatch: true,
    });
  });

  it('preserves the July 4 snapshot when a legacy purchase has fractional quantity', () => {
    const rows = buildEditableClosingStockRows({
      products: [product({ id: 'juice', current_stock: 8, sale_price: 12000, cost_price: 7000 })],
      counts: [
        {
          product_id: 'juice',
          previous_stock: 10,
          added_today: 306,
          closing_stock: 300,
          sold_quantity: 16,
        },
      ],
      purchases: [{ product_id: 'juice', quantity: 305.99 }],
      previousClosings: {},
      isCurrentDate: false,
    });

    expect(rows[0]).toMatchObject({
      previousStock: '10',
      addedToday: '306',
      closingStock: '300',
      soldQuantity: '16',
      purchaseQuantity: 305.99,
      hasPurchaseMismatch: true,
    });
  });

  it('preserves the critical July 4 zero-added snapshot against 3.03 linked purchases', () => {
    const rows = buildEditableClosingStockRows({
      products: [product({ id: 'legacy-item', current_stock: 4, sale_price: 10000, cost_price: 6000 })],
      counts: [
        {
          product_id: 'legacy-item',
          previous_stock: 8,
          added_today: 0,
          closing_stock: 5,
          sold_quantity: 3,
        },
      ],
      purchases: [
        { product_id: 'legacy-item', quantity: 0.01 },
        { product_id: 'legacy-item', quantity: 0.02 },
        { product_id: 'legacy-item', quantity: 3 },
      ],
      previousClosings: {},
      isCurrentDate: false,
    });

    expect(rows[0]).toMatchObject({
      previousStock: '8',
      addedToday: '0',
      closingStock: '5',
      soldQuantity: '3',
      purchaseQuantity: 3.03,
      hasPurchaseMismatch: true,
    });
  });
});

describe('closing stock Excel import', () => {
  it('imports owner closing-stock values from an Excel sheet by product name', () => {
    const rows = [
      row({ product: product({ id: 'cola', name: 'Cola 1.5L' }), previousStock: '10', addedToday: '5' }),
      row({ product: product({ id: 'water', name: 'Water 0.5L' }), previousStock: '20', addedToday: '10', closingStock: '30', soldQuantity: '0' }),
    ];
    const records = recordsFromWorkbook([
      { Product: 'Cola 1.5L', 'Closing Stock': 9 },
      { Product: 'Water 0.5L', 'Closing Stock': 24 },
    ]);

    const importedRows = parseClosingStockImportRecords(records);
    const result = applyClosingStockImport(rows, importedRows, 'closingStock');

    expect(result.matchedCount).toBe(2);
    expect(result.unmatchedImports).toEqual([]);
    expect(result.rows[0]).toMatchObject({ closingStock: '9', soldQuantity: '6' });
    expect(result.rows[1]).toMatchObject({ closingStock: '24', soldQuantity: '6' });
  });

  it('imports admin sold quantities and recalculates closing stock', () => {
    const rows = [
      row({ product: product({ id: 'water', name: 'Water 0.5L' }), previousStock: '20', addedToday: '10' }),
    ];
    const importedRows = parseClosingStockImportRecords([
      { product_id: 'water', sold_quantity: 4 },
    ]);

    const result = applyClosingStockImport(rows, importedRows, 'soldQuantity');

    expect(result.matchedCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ soldQuantity: '4', closingStock: '26' });
  });

  it('supports Russian/Uzbek-style headers from spreadsheets', () => {
    const rows = [
      row({ product: product({ id: 'snickers', name: 'Snickers' }), previousStock: '30', addedToday: '0' }),
    ];
    const importedRows = parseClosingStockImportRecords([
      { Товар: 'Snickers', Продано: '7' },
    ]);

    const result = applyClosingStockImport(rows, importedRows, 'soldQuantity');

    expect(result.matchedCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ soldQuantity: '7', closingStock: '23' });
  });

  it('disambiguates duplicate product names with imported sale and cost prices', () => {
    const rows = [
      row({
        product: product({ id: 'energy-large', name: '18+ ENERGETIK', sale_price: 15000, cost_price: 10200 }),
        previousStock: '62',
        addedToday: '0',
      }),
      row({
        product: product({ id: 'energy-small', name: '18+ ENERGETIK', sale_price: 10000, cost_price: 8300 }),
        previousStock: '19',
        addedToday: '0',
      }),
    ];
    const importedRows = parseClosingStockImportRecords([
      { Product: '18+ ENERGETIK', NARXI: '15,000 sum', 'TAN NARXI': '10,200 sum', OSTATKA: 59 },
      { Product: '18+ ENERGETIK', NARXI: '10,000 sum', 'TAN NARXI': '8,300 sum', OSTATKA: 18 },
    ]);

    const result = applyClosingStockImport(rows, importedRows, 'closingStock');

    expect(result.matchedCount).toBe(2);
    expect(result.rows[0]).toMatchObject({ closingStock: '59', soldQuantity: '3' });
    expect(result.rows[1]).toMatchObject({ closingStock: '18', soldQuantity: '1' });
  });

  it('parses stock tables after title rows and treats generic остаток as closing stock', () => {
    const rows = [
      row({ product: product({ id: 'snickers', name: 'Snickers' }), previousStock: '30', addedToday: '0' }),
    ];
    const importedRows = parseClosingStockImportSheetRows([
      ['Приход/Расход июнь 2026'],
      [],
      ['#', 'Наименование', 'Приход', 'Расход', 'Остаток'],
      [1, 'Snickers', 2, 7, 25],
    ]);

    const result = applyClosingStockImport(rows, importedRows, 'closingStock');

    expect(importedRows).toEqual([
      expect.objectContaining({
        rowNumber: 4,
        product: 'Snickers',
        addedToday: 2,
        soldQuantity: 7,
        closingStock: 25,
      }),
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ addedToday: '2', closingStock: '25', soldQuantity: '7' });
  });

  it('selects the latest dated stock sheet when a workbook starts with a summary tab', () => {
    const appRows = [
      row({ product: product({ id: 'cola', name: 'Coca cola 0,5' }), previousStock: '69', addedToday: '0' }),
      row({ product: product({ id: 'water', name: 'BEZ GAZ 0.5' }), previousStock: '104', addedToday: '0' }),
    ];
    const sheets = sheetsFromWorkbook([
      {
        name: 'ПриходРасход',
        rows: [
          ['', '', '', '', '', '', '', '', '28 дней', 'Комп', 'Бар'],
          ['', '', '', '', 'Категория', 'Приход(Нал)', 'Приход(Карта)', 'QR Code', 'Расход(Комментарий)'],
        ],
      },
      {
        name: '26.06.2026',
        rows: [
          ['Column 1', 'NARXI', 'TAN NARXI', 'OSTATKA', 'SOTILDI', 'KELDI'],
          ['Coca cola 0,5', '10,000 sum', '5,800 sum', 71, 1, ''],
          ['BEZ GAZ 0.5', '5,000 sum', '2,000 sum', 104, 5, ''],
        ],
      },
      {
        name: '27.06.2026',
        rows: [
          ['Column 1', 'NARXI', 'TAN NARXI', 'OSTATKA', 'SOTILDI', 'KELDI'],
          ['Coca cola 0,5', '10,000 sum', '5,800 sum', 64, 7, 2],
          ['BEZ GAZ 0.5', '5,000 sum', '2,000 sum', 96, 8, ''],
        ],
      },
    ]);

    const selection = selectClosingStockImportRows(sheets, '2026-06-29');
    const result = applyClosingStockImport(appRows, selection?.rows ?? [], 'closingStock');

    expect(selection?.sheetName).toBe('27.06.2026');
    expect(result.matchedCount).toBe(2);
    expect(result.rows[0]).toMatchObject({ addedToday: '2', closingStock: '64', soldQuantity: '7' });
    expect(result.rows[1]).toMatchObject({ closingStock: '96', soldQuantity: '8' });
  });

  it('prefers the sheet matching the selected closing-stock date', () => {
    const sheets = sheetsFromWorkbook([
      {
        name: '26.06.2026',
        rows: [
          ['Product', 'OSTATKA'],
          ['Cola 1.5L', 71],
        ],
      },
      {
        name: '27.06.2026',
        rows: [
          ['Product', 'OSTATKA'],
          ['Cola 1.5L', 64],
        ],
      },
    ]);

    const selection = selectClosingStockImportRows(sheets, '2026-06-26');

    expect(selection?.sheetName).toBe('26.06.2026');
    expect(selection?.rows[0]).toMatchObject({ product: 'Cola 1.5L', closingStock: 71 });
  });

  it('can import by row order when no product column is present', () => {
    const rows = [
      row({ product: product({ id: 'cola', name: 'Cola 1.5L' }), previousStock: '10', addedToday: '0' }),
      row({ product: product({ id: 'water', name: 'Water 0.5L' }), previousStock: '20', addedToday: '0' }),
    ];
    const importedRows = parseClosingStockImportRecords([
      { 'Closing Stock': 8 },
      { 'Closing Stock': 15 },
    ]);

    const result = applyClosingStockImport(rows, importedRows, 'closingStock');

    expect(result.matchedCount).toBe(2);
    expect(result.rows[0]).toMatchObject({ closingStock: '8', soldQuantity: '2' });
    expect(result.rows[1]).toMatchObject({ closingStock: '15', soldQuantity: '5' });
  });

  it('normalizes decimal imported stock counts to whole numbers', () => {
    const rows = [
      row({
        product: product({ id: 'cola', name: 'Cola 0.5L' }),
        previousStock: '0',
        addedToday: '21',
        closingStock: '21',
        soldQuantity: '0',
      }),
    ];
    const importedRows = parseClosingStockImportRecords([
      { Product: 'Cola 0.5L', 'Closing Stock': 20.2 },
    ]);

    const result = applyClosingStockImport(rows, importedRows, 'closingStock');

    expect(result.matchedCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ closingStock: '20', soldQuantity: '1' });
  });

  it('reports unmatched product rows instead of silently applying them to the wrong product', () => {
    const rows = [
      row({ product: product({ id: 'cola', name: 'Cola 1.5L' }) }),
    ];
    const importedRows = parseClosingStockImportRecords([
      { Product: 'Unknown Drink', 'Closing Stock': 4 },
    ]);

    const result = applyClosingStockImport(rows, importedRows, 'closingStock');

    expect(result.matchedCount).toBe(0);
    expect(result.rows[0].closingStock).toBe('12');
    expect(result.unmatchedImports).toEqual([
      expect.objectContaining({ product: 'Unknown Drink', closingStock: 4 }),
    ]);
  });
});

describe('closing stock drafts', () => {
  it('saves, reads, applies and clears a draft for a date', () => {
    const storage = new MemoryStorage();
    const date = '2026-06-28';
    const rows = [
      row({ product: product({ id: 'cola', name: 'Cola 1.5L' }), closingStock: '8', soldQuantity: '7' }),
    ];

    expect(saveClosingStockDraft(storage, date, rows, '2026-06-28T12:00:00.000Z')).toBe(true);
    expect(readClosingStockDraft(storage, date)).toEqual({
      version: 1,
      date,
      savedAt: '2026-06-28T12:00:00.000Z',
      rows: [
        {
          productId: 'cola',
          previousStock: '10',
          addedToday: '5',
          adjustmentQuantity: '0',
          adjustmentReason: '',
          giveawayQuantity: '0',
          promotionId: null,
          closingStock: '8',
          soldQuantity: '7',
        },
      ],
    });

    const freshRows = [
      row({ product: product({ id: 'cola', name: 'Cola 1.5L' }), closingStock: '12', soldQuantity: '3' }),
      row({ product: product({ id: 'water', name: 'Water 0.5L' }) }),
    ];
    const appliedRows = applyClosingStockDraft(freshRows, readClosingStockDraft(storage, date));

    expect(appliedRows[0]).toMatchObject({ closingStock: '8', soldQuantity: '7' });
    expect(appliedRows[1]).toBe(freshRows[1]);

    clearClosingStockDraft(storage, date);
    expect(storage.getItem(closingStockDraftKey(date))).toBeNull();
  });

  it('keeps fresh purchase totals when applying a stale same-day draft', () => {
    const storage = new MemoryStorage();
    const date = '2026-07-06';
    const productRow = product({ id: 'burger', name: 'Cheeseburger', sale_price: 20000, cost_price: 16000 });

    saveClosingStockDraft(storage, date, [
      row({
        product: productRow,
        previousStock: '2',
        addedToday: '0',
        closingStock: '1',
        soldQuantity: '1',
      }),
    ]);

    const appliedRows = applyClosingStockDraft([
      row({
        product: productRow,
        previousStock: '2',
        addedToday: '5',
        closingStock: '7',
        soldQuantity: '0',
      }),
    ], readClosingStockDraft(storage, date));

    expect(appliedRows[0]).toMatchObject({
      previousStock: '2',
      addedToday: '5',
      closingStock: '6',
      soldQuantity: '1',
    });
  });

  it('rebases a sold-entry draft onto a corrected previous-day closing', () => {
    const storage = new MemoryStorage();
    const date = '2026-08-27';
    const productRow = product({ id: 'cola-bottle', name: 'Cola bottle' });

    saveClosingStockDraft(storage, date, [
      row({
        product: productRow,
        previousStock: '85',
        addedToday: '0',
        closingStock: '83',
        soldQuantity: '2',
      }),
    ]);

    const appliedRows = applyClosingStockDraft([
      row({
        product: productRow,
        previousStock: '102',
        addedToday: '0',
        closingStock: '102',
        soldQuantity: '0',
      }),
    ], readClosingStockDraft(storage, date), 'soldQuantity');

    expect(appliedRows[0]).toMatchObject({
      previousStock: '102',
      addedToday: '0',
      soldQuantity: '2',
      closingStock: '100',
    });
  });

  it('rebases a closing-entry draft and recalculates sold quantity', () => {
    const storage = new MemoryStorage();
    const date = '2026-08-27';
    const productRow = product({ id: 'water', name: 'Water' });

    saveClosingStockDraft(storage, date, [
      row({
        product: productRow,
        previousStock: '85',
        addedToday: '0',
        closingStock: '83',
        soldQuantity: '2',
      }),
    ]);

    const appliedRows = applyClosingStockDraft([
      row({
        product: productRow,
        previousStock: '102',
        addedToday: '0',
        closingStock: '102',
        soldQuantity: '0',
      }),
    ], readClosingStockDraft(storage, date), 'closingStock');

    expect(appliedRows[0]).toMatchObject({
      previousStock: '102',
      addedToday: '0',
      closingStock: '83',
      soldQuantity: '19',
    });
  });

  it('ignores corrupted drafts or drafts for another date', () => {
    const storage = new MemoryStorage();
    storage.setItem(closingStockDraftKey('2026-06-28'), '{bad json');
    storage.setItem(closingStockDraftKey('2026-06-29'), JSON.stringify({
      version: 1,
      date: '2026-06-28',
      savedAt: '2026-06-29T00:00:00.000Z',
      rows: [],
    }));

    expect(readClosingStockDraft(storage, '2026-06-28')).toBeNull();
    expect(readClosingStockDraft(storage, '2026-06-29')).toBeNull();
  });

  it('returns false when local storage cannot save drafts', () => {
    expect(saveClosingStockDraft(new ThrowingStorage(), '2026-06-28', [row({})])).toBe(false);
    expect(readClosingStockDraft(new ThrowingStorage(), '2026-06-28')).toBeNull();
  });
});

describe('closing stock save payloads', () => {
  it('saves direct made-to-order sales without a finished-goods stock balance', () => {
    const { upserts, savedClosings } = buildClosingStockUpserts({
      date: '2026-07-22',
      createdBy: 'user-1',
      updatedAt: '2026-07-22T18:00:00.000Z',
      rows: [row({
        product: product({
          id: 'hot-dog',
          name: 'XOT DOG',
          tracks_inventory: false,
          current_stock: 922,
          sale_price: 25_000,
          cost_price: 11_000,
        }),
        previousStock: '922',
        closingStock: '918',
        soldQuantity: '4',
      })],
    });

    expect(upserts[0]).toMatchObject({
      previous_stock: 0,
      added_today: 0,
      adjustment_quantity: 0,
      adjustment_reason: null,
      closing_stock: 0,
      sold_quantity: 4,
      bar_income: 100_000,
      bar_cost: 44_000,
      bar_profit: 56_000,
    });
    expect(savedClosings).toEqual({});
  });

  it('builds Supabase upsert rows with calculated sales, cost and profit', () => {
    const { upserts, savedClosings } = buildClosingStockUpserts({
      date: '2026-06-28',
      createdBy: 'user-1',
      updatedAt: '2026-06-28T18:00:00.000Z',
      rows: [
        row({
          product: product({
            id: 'cola',
            name: 'Cola 1.5L',
            sale_price: 15000,
            cost_price: 9000,
          }),
          previousStock: '10',
          addedToday: '5',
          closingStock: '8',
          soldQuantity: '7',
        }),
      ],
    });

    expect(upserts).toEqual([
      {
        date: '2026-06-28',
        product_id: 'cola',
        previous_stock: 10,
        added_today: 5,
        adjustment_quantity: 0,
        adjustment_reason: null,
        giveaway_quantity: 0,
        promotion_id: null,
        closing_stock: 8,
        sold_quantity: 7,
        sale_price: 15000,
        cost_price: 9000,
        bar_income: 105000,
        bar_cost: 63000,
        bar_profit: 42000,
        created_by: 'user-1',
        updated_at: '2026-06-28T18:00:00.000Z',
      },
    ]);
    expect(savedClosings).toEqual({ cola: 8 });
  });

  it('rejects closing stock above available inventory without an adjustment', () => {
    const invalidRow = row({
      product: product({ id: 'cola', sale_price: 15000, cost_price: 9000 }),
      previousStock: '',
      addedToday: 'bad',
      closingStock: '1,000',
      soldQuantity: '0',
    });

    expect(validateClosingStockRows([invalidRow])?.code).toBe('closing_exceeds_available');
    expect(() => buildClosingStockUpserts({
      date: '2026-06-28',
      createdBy: null,
      updatedAt: '2026-06-28T18:00:00.000Z',
      rows: [invalidRow],
    })).toThrow(/explicit adjustment/i);
  });

  it('saves an explicit, explained inventory adjustment', () => {
    const { upserts } = buildClosingStockUpserts({
      date: '2026-06-28',
      createdBy: 'owner-1',
      updatedAt: '2026-06-28T18:00:00.000Z',
      rows: [row({
        previousStock: '10',
        addedToday: '0',
        adjustmentQuantity: '5',
        adjustmentReason: 'Physical count correction',
        closingStock: '13',
        soldQuantity: '2',
      })],
    });

    expect(upserts[0]).toMatchObject({
      previous_stock: 10,
      added_today: 0,
      adjustment_quantity: 5,
      adjustment_reason: 'Physical count correction',
      closing_stock: 13,
      sold_quantity: 2,
    });
  });

  it('maps editable rows into canonical totals input', () => {
    const rows = [
      row({ product: product({ id: 'a', sale_price: 100, cost_price: 40 }), previousStock: '10', addedToday: '2', closingStock: '7', soldQuantity: '5' }),
      row({ product: product({ id: 'b', tracks_inventory: false, sale_price: 50, cost_price: 10 }), previousStock: '0', addedToday: '0', closingStock: '0', soldQuantity: '4' }),
    ];
    const totals = summarizeStockRows(rows.map((item) => closingStockRowTotalsInput(item, item.product.id === 'a' ? 80 : 0)));
    expect(totals).toEqual({ sold: 9, giveaways: 0, giveawayCost: 0, income: 700, profit: 460, stockValue: 280, previous: 10, added: 2, purchaseCost: 80 });
  });

  it('treats promo giveaways as units that left stock unsold', () => {
    const cola = row({
      product: product({ id: 'cola', name: 'Cola', sale_price: 15000, cost_price: 9000 }),
      previousStock: '10',
      addedToday: '2',
      giveawayQuantity: '3',
      promotionId: 'promo-1',
      closingStock: '4',
      soldQuantity: '5',
    });
    expect(validateClosingStockRows([cola])).toBeNull();
    const { upserts } = buildClosingStockUpserts({ date: '2026-06-28', createdBy: null, updatedAt: 'now', rows: [cola] });
    expect(upserts[0]).toMatchObject({
      giveaway_quantity: 3,
      promotion_id: 'promo-1',
      sold_quantity: 5,
      bar_income: 75000,
      bar_cost: 72000,
      bar_profit: 3000,
    });
    const totals = summarizeStockRows([closingStockRowTotalsInput(cola)]);
    expect(totals).toMatchObject({ sold: 5, giveaways: 3, giveawayCost: 27000, income: 75000, profit: 3000 });

    expect(validateClosingStockRows([{ ...cola, closingStock: '10', soldQuantity: '0' }])?.code).toBe('closing_exceeds_available');
    expect(validateClosingStockRows([{ ...cola, soldQuantity: '8' }])?.code).toBe('sold_quantity_mismatch');
    // A promotion link without any giveaway is meaningless and is dropped.
    const none = buildClosingStockUpserts({ date: '2026-06-28', createdBy: null, updatedAt: 'now',
      rows: [{ ...cola, giveawayQuantity: '0', closingStock: '7' }] }).upserts[0];
    expect(none).toMatchObject({ giveaway_quantity: 0, promotion_id: null, sold_quantity: 5, bar_cost: 45000 });
  });

  it('keeps giveaways for made-to-order products and in bulk orders', () => {
    const tea = row({
      product: product({ id: 'tea', tracks_inventory: false, sale_price: 5000, cost_price: 1000 }),
      previousStock: '0', addedToday: '0', closingStock: '0', soldQuantity: '4', giveawayQuantity: '2',
    });
    expect(buildClosingStockUpserts({ date: '2026-06-28', createdBy: null, updatedAt: 'now', rows: [tea] }).upserts[0])
      .toMatchObject({ giveaway_quantity: 2, sold_quantity: 4, bar_income: 20000, bar_cost: 6000 });

    const cola = row({
      product: product({ id: 'cola', sale_price: 100, cost_price: 40 }),
      previousStock: '10', addedToday: '0', giveawayQuantity: '2', closingStock: '8', soldQuantity: '0',
    });
    const [ordered] = applyBulkStockOrder([cola], [{ productId: 'cola', quantity: 3 }]);
    expect(ordered).toMatchObject({ soldQuantity: '3', closingStock: '5', giveawayQuantity: '2' });
  });

  it('rejects a blank closing count instead of recording every unit as sold', () => {
    const blankClosing = row({
      product: product({ id: 'cola', name: 'Cola' }),
      previousStock: '10',
      addedToday: '2',
      closingStock: '',
      soldQuantity: '12',
    });
    const error = validateClosingStockRows([blankClosing]);
    expect(error?.code).toBe('closing_required');
    expect(error?.productId).toBe('cola');
    expect(error?.availableStock).toBe(12);
    expect(() => buildClosingStockUpserts({
      date: '2026-06-28',
      createdBy: null,
      rows: [blankClosing],
    })).toThrow(/closing stock count/i);
  });

  it('rejects a blank sold quantity for a tracked product in sold-entry mode', () => {
    expect(validateClosingStockRows([row({
      previousStock: '10',
      addedToday: '0',
      closingStock: '10',
      soldQuantity: ' ',
    })])?.code).toBe('sold_required');
  });

  it('still allows a blank made-to-order sold quantity, which records no sales', () => {
    expect(validateClosingStockRows([row({
      product: product({ id: 'hot-dog', tracks_inventory: false }),
      previousStock: '0',
      addedToday: '0',
      closingStock: '0',
      soldQuantity: '',
    })])).toBeNull();
  });

  it('requires a reason for every non-zero inventory adjustment', () => {
    const invalidRow = row({
      adjustmentQuantity: '2',
      adjustmentReason: ' ',
      closingStock: '14',
      soldQuantity: '3',
    });
    expect(validateClosingStockRows([invalidRow])?.code).toBe('adjustment_reason_required');
  });

  it('saves stock count quantities as integers', () => {
    const { upserts } = buildClosingStockUpserts({
      date: '2026-06-30',
      createdBy: null,
      updatedAt: '2026-06-30T18:00:00.000Z',
      rows: [
        row({
          product: product({ id: 'cola', sale_price: 10000, cost_price: 5833 }),
          previousStock: '0',
          addedToday: '21',
          closingStock: '20.2',
          soldQuantity: '1',
        }),
      ],
    });

    expect(upserts[0]).toMatchObject({
      previous_stock: 0,
      added_today: 21,
      adjustment_quantity: 0,
      adjustment_reason: null,
      closing_stock: 20,
      sold_quantity: 1,
      bar_income: 10000,
      bar_cost: 5833,
      bar_profit: 4167,
    });
  });
});

it.each([true, false])('preserves archived closing snapshots (current date: %s) and excludes them from writes', (isCurrentDate) => {
  const archived = product({ id: 'archived', is_deleted: true, is_active: false, current_stock: 0, sale_price: 999, cost_price: 888 });
  const rows = buildEditableClosingStockRows({
    products: [archived],
    counts: [{ product_id: archived.id, previous_stock: 10, added_today: 2, closing_stock: 9, sold_quantity: 3, sale_price: 20, cost_price: 8 }],
    purchases: [{ product_id: archived.id, quantity: 100 }],
    previousClosings: {}, isCurrentDate,
  });
  expect(rows[0]).toMatchObject({ previousStock: '10', addedToday: '2', closingStock: '9', soldQuantity: '3', product: { sale_price: 20, cost_price: 8 } });
  expect(buildClosingStockUpserts({ date: '2026-09-01', rows, createdBy: null }).upserts).toEqual([]);
  expect(applyBulkStockOrder(rows, [{ productId: archived.id, quantity: 1 }])).toEqual(rows);
});

describe('opening receipts across skipped closing dates', () => {
  it('shows 9 Fanta and 10 Cappy after six-unit receipts between closings', () => {
    const previousClosings = calculateStockOpeningBalances([
      { product_id: 'fanta', date: '2026-09-12', closing_stock: 3 },
      { product_id: 'cappy', date: '2026-09-12', closing_stock: 4 },
    ], [
      { product_id: 'fanta', date: '2026-09-14', quantity: 6, cost_price: 9170 },
      { product_id: 'cappy', date: '2026-09-14', quantity: 6, cost_price: 14167 },
    ], '2026-09-15', true);
    const rows = buildEditableClosingStockRows({
      products: [product({ id: 'fanta', current_stock: 9 }), product({ id: 'cappy', current_stock: 10 })],
      counts: [], purchases: [], previousClosings, isCurrentDate: true,
    });
    expect(rows.map(({ previousStock, addedToday, closingStock, soldQuantity }) =>
      ({ previousStock, addedToday, closingStock, soldQuantity }))).toEqual([
      { previousStock: '9', addedToday: '0', closingStock: '9', soldQuantity: '0' },
      { previousStock: '10', addedToday: '0', closingStock: '10', soldQuantity: '0' },
    ]);
    const { upserts } = buildClosingStockUpserts({ date: '2026-09-15', rows, createdBy: null });
    expect(upserts.map((r) => r.sold_quantity)).toEqual([0, 0]);
  });

  it('refreshes an existing current closing while preserving recorded sales and adjustments', () => {
    const rows = buildEditableClosingStockRows({
      products: [product({ id: 'fanta', current_stock: 3 })],
      counts: [{ product_id: 'fanta', previous_stock: 3, added_today: 2, closing_stock: 3,
        adjustment_quantity: -1, adjustment_reason: 'Damaged', sold_quantity: 1 }],
      purchases: [{ product_id: 'fanta', quantity: 2 }],
      previousClosings: { fanta: 9 }, isCurrentDate: true,
    });
    expect(rows[0]).toMatchObject({ previousStock: '9', addedToday: '2', closingStock: '9', soldQuantity: '1', adjustmentQuantity: '-1' });
    // Reloading the same canonical values must never apply the six units twice.
    const again = buildEditableClosingStockRows({
      products: [rows[0].product],
      counts: [{ product_id: 'fanta', previous_stock: 9, added_today: 2, closing_stock: 9,
        adjustment_quantity: -1, adjustment_reason: 'Damaged', sold_quantity: 1 }],
      purchases: [{ product_id: 'fanta', quantity: 2 }], previousClosings: { fanta: 9 }, isCurrentDate: true,
    });
    expect(again).toEqual(rows);
  });

  it('preserves historical snapshots even when the calculated opening differs', () => {
    const rows = buildEditableClosingStockRows({
      products: [product({ id: 'fanta', current_stock: 100 })],
      counts: [{ product_id: 'fanta', previous_stock: 3, added_today: 0, closing_stock: 3, sold_quantity: 0 }],
      purchases: [], previousClosings: { fanta: 9 }, isCurrentDate: false,
    });
    expect(rows[0]).toMatchObject({ previousStock: '3', addedToday: '0', closingStock: '3', soldQuantity: '0' });
  });
});

describe('stock number parsing', () => {
  it.each([
    ['1,000,000', 1_000_000],
    ['1.000.000', 1_000_000],
    ['1.000', 1_000],
    ['1,000', 1_000],
    ['1 000', 1_000],
    ['1.000,5', 1_000],
    ['1,000.5', 1_000],
    ['1,5', 1],
    ['12', 12],
    ['1,00,0', 0],
  ])('reads %s as %d', (input, expected) => {
    expect(normalizeStockCount(input)).toBe(expected);
  });

  it('keeps signed thousands for adjustments', () => {
    expect(normalizeStockAdjustment('-1,000')).toBe(-1_000);
  });
});

describe('saved row prices and inactive products', () => {
  it('uses the saved row prices for an existing count of an active product', () => {
    const rows = buildEditableClosingStockRows({
      products: [product({ id: 'cola', current_stock: 5, sale_price: 20_000, cost_price: 12_000 })],
      counts: [{ product_id: 'cola', previous_stock: 5, added_today: 0, closing_stock: 4, sold_quantity: 1, sale_price: 15_000, cost_price: 9_000 }],
      purchases: [], previousClosings: { cola: 5 }, isCurrentDate: true,
    });
    expect(rows[0].product).toMatchObject({ sale_price: 15_000, cost_price: 9_000 });
    const { upserts } = buildClosingStockUpserts({ date: '2026-09-01', rows, createdBy: null });
    expect(upserts[0]).toMatchObject({ sale_price: 15_000, cost_price: 9_000, bar_income: 15_000, bar_profit: 6_000 });
  });

  it('keeps an inactive product read-only and out of the save payload', () => {
    const inactive = product({ id: 'old', is_active: false, current_stock: 3 });
    const active = product({ id: 'cola', current_stock: 5 });
    expect(isReadOnlyClosingStockProduct(inactive)).toBe(true);
    expect(isReadOnlyClosingStockProduct(active)).toBe(false);
    const rows = buildEditableClosingStockRows({
      products: [active, inactive],
      counts: [{ product_id: 'old', previous_stock: 3, added_today: 0, closing_stock: 3, sold_quantity: 0 }],
      purchases: [], previousClosings: {}, isCurrentDate: false,
    });
    const { upserts } = buildClosingStockUpserts({ date: '2026-09-01', rows, createdBy: null });
    expect(upserts.map((upsert) => upsert.product_id)).toEqual(['cola']);
    expect(applyBulkStockOrder(rows, [{ productId: 'old', quantity: 1 }])[1]).toBe(rows[1]);
  });
});

describe('usesSoldQuantityEntry', () => {
  it('selects sold-quantity entry only for the Pixel club', () => {
    expect(usesSoldQuantityEntry({ name: 'PIXEL Game Club' })).toBe(true);
    expect(usesSoldQuantityEntry({ name: 'Arena' })).toBe(false);
    expect(usesSoldQuantityEntry(null)).toBe(false);
  });
});
