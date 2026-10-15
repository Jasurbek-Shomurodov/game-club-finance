import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWorkbook, safeSheetName } from './excel';
import { createTranslator } from './i18n';

describe('buildWorkbook', () => {
  it('writes translated headers, labels and typed money/date cells', async () => {
    const buffer = await buildWorkbook([{
      subtitle: '01.10.2026 – 15.10.2026',
      table: {
        dataset: 'expenses',
        columns: [
          { key: 'date', type: 'date' },
          { key: 'category', type: 'text' },
          { key: 'amount', type: 'money' },
          { key: 'paymentMethod', type: 'text' },
        ],
        rows: [{ date: '2026-10-02', category: 'rent', amount: 1_500_000, paymentMethod: 'cash' }],
      },
    }], createTranslator('ru'));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];

    expect(sheet.name).toBe('Расходы');
    expect(sheet.getRow(3).values).toEqual([undefined, 'Дата', 'Категория', 'Сумма', 'Способ оплаты']);
    const row = sheet.getRow(4);
    expect(row.getCell(1).value).toEqual(new Date('2026-10-02T00:00:00Z'));
    expect(row.getCell(2).value).toBe('Аренда');
    expect(row.getCell(3).value).toBe(1_500_000);
    expect(row.getCell(3).numFmt).toBe('#,##0');
    expect(row.getCell(4).value).toBe('Наличные');
  });
});

describe('safeSheetName', () => {
  it('strips forbidden characters, caps length and keeps names unique', () => {
    const used = new Set<string>();
    expect(safeSheetName('A/B: [x]', used)).toBe('A B   x');
    expect(safeSheetName('a/b: [x]', used)).toBe('a b   x (2)');
    expect(safeSheetName('x'.repeat(40), used)).toHaveLength(31);
  });
});
