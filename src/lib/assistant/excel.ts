import ExcelJS from 'exceljs';
import type { CellValue, DataTable, TableColumn } from './datasets';

/** Translates a dotted message path; returns null when the key is missing. */
export type Translate = (path: string) => string | null;

const EXCEL_SHEET_NAME_MAX = 31;

/** Column values that are stored keys and should be shown with a translated label. */
const VALUE_LABELS: Record<string, (value: string) => string> = {
  category: (value) => `expenses.categories.${value}`,
  paymentMethod: (value) => `common.paymentMethods.${value}`,
  paymentSource: (value) => `assistant.paymentSources.${value}`,
  debtStatus: (value) => `debts.${value}`,
  stockLevel: (value) => `assistant.stockLevels.${value}`,
  metric: (value) => `assistant.metrics.${value}`,
};

function displayValue(column: TableColumn, value: CellValue, translate: Translate): ExcelJS.CellValue {
  if (value === null || value === '') return null;
  if (typeof value === 'string') {
    if (column.type === 'date') return new Date(`${value}T00:00:00Z`);
    if (column.type === 'month') return new Date(`${value}-01T00:00:00Z`);
    const labelPath = VALUE_LABELS[column.key]?.(value);
    return (labelPath && translate(labelPath)) || value;
  }
  return value;
}

function numberFormat(column: TableColumn, row?: Record<string, CellValue>): string | undefined {
  switch (column.type) {
    case 'money':
      return '#,##0';
    case 'number':
      // Summary rows mix money and percentages in one value column.
      return row?.unit === '%' ? '0.0' : '#,##0';
    case 'percent':
      return '0.0';
    case 'date':
      return 'dd.mm.yyyy';
    case 'month':
      return 'mm.yyyy';
    default:
      return undefined;
  }
}

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 characters. */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, EXCEL_SHEET_NAME_MAX) || 'Sheet';
  let candidate = base;
  for (let index = 2; used.has(candidate.toLowerCase()); index += 1) {
    const suffix = ` (${index})`;
    candidate = `${base.slice(0, EXCEL_SHEET_NAME_MAX - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export interface WorkbookSheet {
  table: DataTable;
  /** Shown above the header, e.g. the period the rows cover. */
  subtitle?: string;
}

/** Builds an .xlsx with one formatted sheet per table. */
export async function buildWorkbook(sheets: WorkbookSheet[], translate: Translate): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Game Club Finance';
  workbook.created = new Date();
  const usedNames = new Set<string>();

  for (const { table, subtitle } of sheets) {
    const title = translate(`assistant.datasets.${table.dataset}`) ?? table.dataset;
    const sheet = workbook.addWorksheet(safeSheetName(title, usedNames));
    let headerRowNumber = 1;
    if (subtitle) {
      sheet.addRow([`${title} · ${subtitle}`]).font = { bold: true, size: 13 };
      sheet.addRow([]);
      headerRowNumber = 3;
    }

    const header = sheet.addRow(table.columns.map((column) => translate(`assistant.columns.${column.key}`) ?? column.key));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF9AA9BF' } } };
    });

    for (const row of table.rows) {
      const added = sheet.addRow(table.columns.map((column) => displayValue(column, row[column.key] ?? null, translate)));
      table.columns.forEach((column, index) => {
        const format = numberFormat(column, row);
        if (format) added.getCell(index + 1).numFmt = format;
      });
    }

    table.columns.forEach((column, index) => {
      const widest = Math.max(
        String(header.getCell(index + 1).value ?? '').length,
        ...table.rows.slice(0, 500).map((row) => String(row[column.key] ?? '').length),
      );
      sheet.getColumn(index + 1).width = Math.min(48, Math.max(10, widest + 4));
    });
    sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
    if (table.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: headerRowNumber, column: 1 },
        to: { row: headerRowNumber, column: table.columns.length },
      };
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
