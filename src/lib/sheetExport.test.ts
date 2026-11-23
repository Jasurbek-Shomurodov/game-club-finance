import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildSheetWorkbook, sheetFileName, type SheetSpec } from './sheetExport';

async function load(sheets: SheetSpec[]) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await buildSheetWorkbook(sheets)) as unknown as ArrayBuffer);
  return workbook;
}

const debts: SheetSpec = {
  name: 'Debts',
  title: 'Debts',
  subtitle: 'Pixel Gaming · 24 November 2026',
  note: 'Exported 24 November 2026 · 2 rows',
  totalLabel: 'Total',
  columns: [
    { header: 'Person' },
    { header: 'Date', type: 'date' },
    { header: 'Amount', type: 'money', total: true },
    { header: 'Left', type: 'money', total: true, signed: true },
    { header: 'Status' },
    { header: 'Comment', type: 'longText' },
  ],
  rows: [
    ['Alibek', '2026-11-02', 150_000, 50_000, { value: 'Partial', tone: 'warning' }, '=SUM(A1:A9)'],
    ['Bobur', '2026-11-05', 80_000, -20_000, { value: 'Paid', tone: 'success' }, null],
  ],
};

describe('buildSheetWorkbook', () => {
  it('writes the title block, then a frozen filtered header', async () => {
    const sheet = (await load([debts])).worksheets[0];
    expect(sheet.name).toBe('Debts');
    expect(sheet.getCell('A1').value).toBe('Debts');
    expect(sheet.getCell('A2').value).toBe('Pixel Gaming · 24 November 2026');
    expect(sheet.getCell('A3').value).toBe('Exported 24 November 2026 · 2 rows');
    expect((sheet.getRow(5).values as unknown[]).slice(1)).toEqual(['Person', 'Date', 'Amount', 'Left', 'Status', 'Comment']);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 5, xSplit: 1 });
    expect(sheet.autoFilter).toBe('A5:F7');
    expect(sheet.pageSetup.printTitlesRow).toBe('5:5');
  });

  it('keeps amounts as numbers and dates as dates, and typed text as text', async () => {
    const sheet = (await load([debts])).worksheets[0];
    const row = sheet.getRow(6);
    expect(row.getCell(2).value).toEqual(new Date('2026-11-02T00:00:00Z'));
    expect(row.getCell(2).numFmt).toBe('dd.mm.yyyy');
    expect(row.getCell(3).value).toBe(150_000);
    expect(row.getCell(3).numFmt).toBe('#,##0;-#,##0;"–"');
    // A string cell is never run as a formula.
    expect(row.getCell(6).value).toBe('=SUM(A1:A9)');
    expect(row.getCell(6).alignment?.wrapText).toBe(true);
  });

  it('colours tones and the sign of signed figures', async () => {
    const sheet = (await load([debts])).worksheets[0];
    expect(sheet.getRow(6).getCell(5).font?.color?.argb).toBe('FFB45309');
    expect(sheet.getRow(6).getCell(4).font?.color?.argb).toBe('FF15803D');
    expect(sheet.getRow(7).getCell(4).font?.color?.argb).toBe('FFDC2626');
  });

  it('adds a totals row that follows the filter and stays outside it', async () => {
    const sheet = (await load([debts])).worksheets[0];
    const totals = sheet.getRow(8);
    expect(totals.getCell(1).value).toBe('Total');
    expect(totals.getCell(3).value).toEqual({ formula: 'SUBTOTAL(109,C6:C7)', result: 230_000 });
    expect(totals.getCell(4).value).toEqual({ formula: 'SUBTOTAL(109,D6:D7)', result: 30_000 });
    expect(totals.getCell(2).value).toBeNull();
    expect(totals.getCell(3).font?.bold).toBe(true);
  });

  it('shows two decimals only in a column that holds fractions', async () => {
    const sheet = (await load([{
      name: 'Month', title: 'Month',
      columns: [{ header: 'Date', type: 'date' }, { header: 'Sales', type: 'money' }, { header: 'Cost', type: 'money' }, { header: 'Stock', type: 'number' }],
      rows: [['2026-11-01', 1_000, 412.57, 0]],
    }])).worksheets[0];
    // No subtitle or note: the header is the third row.
    const row = sheet.getRow(4);
    expect(row.getCell(2).numFmt).toBe('#,##0;-#,##0;"–"');
    expect(row.getCell(3).numFmt).toBe('#,##0.00;-#,##0.00;"–"');
    expect(row.getCell(4).numFmt).toBe('#,##0');
    expect(sheet.rowCount).toBe(4);
  });

  it('merges a band over neighbouring columns of one group', async () => {
    const sheet = (await load([{
      name: 'Month', title: 'Month',
      columns: [
        { header: 'Date', type: 'date' },
        { header: 'Income', type: 'money', group: 'Game Club' },
        { header: 'Profit', type: 'money', group: 'Game Club' },
        { header: 'Sales', type: 'money', group: 'Bar' },
      ],
      rows: [['2026-11-01', 1, 2, 3]],
    }])).worksheets[0];
    expect(sheet.getCell('B3').value).toBe('Game Club');
    expect(sheet.getCell('C3').isMerged).toBe(true);
    expect(sheet.getCell('C3').master.address).toBe('B3');
    expect(sheet.getCell('D3').value).toBe('Bar');
    expect(sheet.getCell('D3').isMerged).toBe(false);
    expect(sheet.views[0]).toMatchObject({ ySplit: 4 });
  });

  it('gives each sheet a valid unique tab name', async () => {
    const workbook = await load([
      { name: 'Money: in/out', title: 'a', columns: [{ header: 'x' }], rows: [] },
      { name: 'Money: in/out', title: 'b', columns: [{ header: 'x' }], rows: [] },
    ]);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Money in out', 'Money in out (2)']);
    expect(workbook.worksheets[0].autoFilter).toBeUndefined();
  });
});

describe('sheetFileName', () => {
  it('names a day or a range', () => {
    expect(sheetFileName('debts', '2026-11-17')).toBe('debts-2026-11-17.xlsx');
    expect(sheetFileName('Reports', '2026-11-01', '2026-11-30')).toBe('reports-2026-11-01_2026-11-30.xlsx');
    expect(sheetFileName('reports', '2026-11-01', '2026-11-01')).toBe('reports-2026-11-01.xlsx');
    expect(sheetFileName('../', '2026-11-01')).toBe('export-2026-11-01.xlsx');
  });
});
