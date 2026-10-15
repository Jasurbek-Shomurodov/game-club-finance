import ExcelJS from 'exceljs';
import { buildWorkbook } from 'hoggish-assistant/excel';
import { describe, expect, it } from 'vitest';
import { datasetSheet, workbookOptions } from './excel';
import { createTranslator } from './i18n';

async function load(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  return workbook.worksheets[0];
}

function rowValues(sheet: ExcelJS.Worksheet, rowNumber: number) {
  return (sheet.getRow(rowNumber).values as unknown[]).slice(1);
}

describe('datasetSheet', () => {
  const translate = createTranslator('ru');

  it('writes translated headers, labels and typed money/date cells', async () => {
    const sheet = await load(await buildWorkbook([datasetSheet({
      dataset: 'expenses',
      columns: [
        { key: 'date', type: 'date' },
        { key: 'category', type: 'text' },
        { key: 'amount', type: 'money' },
        { key: 'paymentMethod', type: 'text' },
      ],
      rows: [{ date: '2026-10-02', category: 'rent', amount: 1_500_000, paymentMethod: 'cash' }],
    }, translate, '01.10.2026 – 15.10.2026')], workbookOptions(translate)));

    expect(sheet.name).toBe('Расходы');
    expect(sheet.getRow(1).getCell(1).value).toBe('Расходы · 01.10.2026 – 15.10.2026');
    const headerRow = [...Array(sheet.rowCount).keys()].map((index) => index + 1)
      .find((number) => sheet.getRow(number).getCell(1).value === 'Дата')!;
    expect(rowValues(sheet, headerRow)).toEqual(['Дата', 'Категория', 'Сумма', 'Способ оплаты']);
    const row = sheet.getRow(headerRow + 1);
    expect(row.getCell(1).value).toEqual(new Date('2026-10-02T00:00:00Z'));
    expect(row.getCell(2).value).toBe('Аренда');
    expect(row.getCell(3).value).toBe(1_500_000);
    expect(row.getCell(3).numFmt).toContain('#,##0');
    expect(row.getCell(4).value).toBe('Наличные');
  });

  it('splits summary values into money and percent columns', () => {
    const sheet = datasetSheet({
      dataset: 'summary',
      columns: [{ key: 'metric', type: 'text' }, { key: 'value', type: 'number' }, { key: 'unit', type: 'text' }],
      rows: [
        { metric: 'income', value: 2_000_000, unit: 'UZS' },
        { metric: 'profitMarginPct', value: 23.5, unit: '%' },
      ],
    }, translate);

    expect(sheet.columns.map(({ key, type }) => [key, type])).toEqual([
      ['metric', 'text'], ['value', 'money'], ['percentValue', 'percent'],
    ]);
    expect(sheet.rows).toEqual([
      { metric: 'income', value: 2_000_000, percentValue: null },
      { metric: 'profitMarginPct', value: null, percentValue: 23.5 },
    ]);
    expect(sheet.columns[0].label?.('profitMarginPct')).toBe(translate('assistant.metrics.profitMarginPct'));
  });
});
