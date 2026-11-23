import type ExcelJS from 'exceljs';

/**
 * Formatted .xlsx exports, written in the browser from the rows already on
 * screen. The file is laid out to be read as it opens: a title block, a
 * frozen coloured header with filters, amounts as real numbers with thousands
 * separators, dates as real dates, a totals row that follows the filter, and
 * a print setup that fits the page width.
 */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type SheetTone = 'success' | 'danger' | 'warning' | 'muted';
export type SheetCellValue = string | number | null | undefined;
/** A bare value, or a value with the colour its text takes (a debt's status, an entry's type). */
export type SheetCell = SheetCellValue | { value: SheetCellValue; tone?: SheetTone };

/**
 * `date` takes ISO `YYYY-MM-DD` and becomes a real spreadsheet date; `money`
 * and `number` stay numbers; `longText` (comments) is wider and wraps.
 */
export type SheetColumnType = 'text' | 'longText' | 'date' | 'money' | 'number';

export interface SheetColumn {
  header: string;
  type?: SheetColumnType;
  /** Adds the column up in the totals row. */
  total?: boolean;
  /** A figure whose sign is the point (profit, change): green above zero, red below. */
  signed?: boolean;
  /** Neighbouring columns with the same group share one band above the header. */
  group?: string;
}

export interface SheetSpec {
  /** Tab name. */
  name: string;
  /** Large first line of the sheet. */
  title: string;
  /** Second line, e.g. "Pixel Gaming · November 2026". */
  subtitle?: string;
  /** Third, quieter line, e.g. "Exported 24 November 2026 · 14:05 · 31 rows". */
  note?: string;
  columns: SheetColumn[];
  rows: SheetCell[][];
  /** First cell of the totals row; the row is written when any column has `total`. */
  totalLabel?: string;
}

const COLOR = {
  headerFill: 'FF2F52E0',
  headerText: 'FFFFFFFF',
  groupFill: 'FFE4EAFD',
  groupText: 'FF1E3A8A',
  zebraFill: 'FFF7F9FC',
  totalFill: 'FFEEF2FF',
  line: 'FFE5E7EB',
  text: 'FF111827',
  muted: 'FF6B7280',
  success: 'FF15803D',
  danger: 'FFDC2626',
  warning: 'FFB45309',
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHEET_NAME_MAX = 31;
const WIDTH = { min: 10, text: 36, longText: 56 } as const;

function isNumeric(type: SheetColumnType | undefined): boolean {
  return type === 'money' || type === 'number';
}

function rawValue(cell: SheetCell): SheetCellValue {
  return cell !== null && typeof cell === 'object' ? cell.value : cell;
}

function cellTone(cell: SheetCell): SheetTone | undefined {
  return cell !== null && typeof cell === 'object' ? cell.tone : undefined;
}

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** Excel forbids : \ / ? * [ ] in tab names, caps them at 31 characters and needs them unique. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, SHEET_NAME_MAX).trim() || 'Sheet';
  let candidate = base;
  for (let index = 2; used.has(candidate.toLowerCase()); index += 1) {
    const suffix = ` (${index})`;
    candidate = `${base.slice(0, SHEET_NAME_MAX - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** A1-style column letters: 1 → A, 27 → AA. */
function columnLetter(index: number): string {
  let letters = '';
  for (let rest = index; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

/**
 * Two decimals only where the column holds fractions (weighted bar costs);
 * whole-sum columns stay clean. A zero amount reads as a dash, like in a ledger.
 */
function numberFormat(type: SheetColumnType | undefined, fractional: boolean): string | undefined {
  if (type === 'date') return 'dd.mm.yyyy';
  if (!isNumeric(type)) return undefined;
  const digits = fractional ? '#,##0.00' : '#,##0';
  return type === 'money' ? `${digits};-${digits};"–"` : digits;
}

function displayLength(value: ExcelJS.CellValue, fractional: boolean): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return 10;
  if (typeof value === 'number') {
    return value.toLocaleString('en-US', { minimumFractionDigits: fractional ? 2 : 0, maximumFractionDigits: fractional ? 2 : 0 }).length;
  }
  // A wrapped comment is as wide as its longest line.
  return Math.max(...String(value).split('\n').map((line) => line.length));
}

function toCellValue(column: SheetColumn, value: SheetCellValue): ExcelJS.CellValue {
  if (value === null || value === undefined || value === '') return null;
  if (column.type === 'date' && typeof value === 'string' && ISO_DATE.test(value)) return new Date(`${value}T00:00:00Z`);
  if (isNumeric(column.type) && typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value;
}

function signColor(value: number): string {
  if (value > 0) return COLOR.success;
  return value < 0 ? COLOR.danger : COLOR.text;
}

function fontColor(column: SheetColumn, value: ExcelJS.CellValue, tone: SheetTone | undefined): string | undefined {
  if (tone) return COLOR[tone];
  if (typeof value !== 'number') return undefined;
  if (column.signed) return signColor(value);
  return value < 0 ? COLOR.danger : undefined;
}

function alignment(column: SheetColumn): Partial<ExcelJS.Alignment> {
  if (isNumeric(column.type)) return { horizontal: 'right', vertical: 'top' };
  if (column.type === 'longText') return { horizontal: 'left', vertical: 'top', wrapText: true };
  return { horizontal: 'left', vertical: 'top' };
}

function addSheet(workbook: ExcelJS.Workbook, spec: SheetSpec, usedNames: Set<string>): void {
  const sheet = workbook.addWorksheet(sheetName(spec.name, usedNames));
  const { columns, rows } = spec;
  const columnCount = columns.length;

  sheet.addRow([spec.title]).font = { bold: true, size: 16, color: { argb: COLOR.text } };
  if (spec.subtitle) sheet.addRow([spec.subtitle]).font = { size: 11, color: { argb: COLOR.text } };
  if (spec.note) sheet.addRow([spec.note]).font = { size: 9, color: { argb: COLOR.muted } };
  sheet.addRow([]);
  if (columnCount === 0) return;

  if (columns.some((column) => column.group)) {
    const band = sheet.addRow(columns.map((column) => column.group ?? null));
    band.height = 20;
    for (let start = 0; start < columnCount;) {
      const group = columns[start].group;
      let end = start;
      while (end + 1 < columnCount && columns[end + 1].group === group) end += 1;
      if (group) {
        if (end > start) sheet.mergeCells(band.number, start + 1, band.number, end + 1);
        const cell = band.getCell(start + 1);
        cell.fill = solid(COLOR.groupFill);
        cell.font = { bold: true, color: { argb: COLOR.groupText } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      start = end + 1;
    }
  }

  const header = sheet.addRow(columns.map((column) => column.header));
  header.height = 30;
  header.eachCell((cell, columnNumber) => {
    cell.fill = solid(COLOR.headerFill);
    cell.font = { bold: true, color: { argb: COLOR.headerText } };
    cell.alignment = { horizontal: isNumeric(columns[columnNumber - 1].type) ? 'right' : 'left', vertical: 'middle', wrapText: true };
  });

  const fractional = columns.map((column, index) => isNumeric(column.type)
    && rows.some((row) => { const value = rawValue(row[index]); return typeof value === 'number' && !Number.isInteger(value); }));
  const formats = columns.map((column, index) => numberFormat(column.type, fractional[index]));
  const widths = columns.map((column) => column.header.length);

  rows.forEach((row, rowIndex) => {
    const values = columns.map((column, index) => toCellValue(column, rawValue(row[index])));
    const added = sheet.addRow(values);
    columns.forEach((column, index) => {
      const cell = added.getCell(index + 1);
      const format = formats[index];
      if (format && (typeof values[index] === 'number' || values[index] instanceof Date)) cell.numFmt = format;
      cell.alignment = alignment(column);
      cell.border = { bottom: { style: 'thin', color: { argb: COLOR.line } } };
      if (rowIndex % 2 === 1) cell.fill = solid(COLOR.zebraFill);
      const color = fontColor(column, values[index], cellTone(row[index]));
      if (color) cell.font = { color: { argb: color } };
      widths[index] = Math.max(widths[index], displayLength(values[index], fractional[index]));
    });
  });

  const firstDataRow = header.number + 1;
  const lastDataRow = header.number + rows.length;

  if (rows.length > 0 && columns.some((column) => column.total)) {
    const totals = columns.map((column, index) => (column.total
      ? rows.reduce((sum, row) => { const value = rawValue(row[index]); return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0); }, 0)
      : null));
    const added = sheet.addRow(columns.map((column, index) => {
      if (index === 0 && !column.total) return spec.totalLabel ?? null;
      if (totals[index] === null) return null;
      const letter = columnLetter(index + 1);
      // SUBTOTAL(109) adds up only the rows a filter leaves visible; the stored result shows where formulas are not recalculated.
      return { formula: `SUBTOTAL(109,${letter}${firstDataRow}:${letter}${lastDataRow})`, result: totals[index] ?? 0 };
    }));
    columns.forEach((column, index) => {
      const cell = added.getCell(index + 1);
      const total = totals[index];
      cell.fill = solid(COLOR.totalFill);
      cell.border = { top: { style: 'medium', color: { argb: COLOR.headerFill } } };
      cell.font = { bold: true, color: { argb: total !== null && column.signed ? signColor(total) : COLOR.text } };
      cell.alignment = { horizontal: isNumeric(column.type) ? 'right' : 'left', vertical: 'middle' };
      if (total !== null) {
        if (formats[index]) cell.numFmt = formats[index];
        widths[index] = Math.max(widths[index], displayLength(total, fractional[index]));
      }
    });
    added.height = 22;
  }

  columns.forEach((column, index) => {
    const cap = column.type === 'longText' ? WIDTH.longText : WIDTH.text;
    sheet.getColumn(index + 1).width = Math.min(cap, Math.max(WIDTH.min, widths[index] + 3));
  });

  // The header and the first column (the date or the name) stay put while scrolling.
  sheet.views = [{ state: 'frozen', ySplit: header.number, xSplit: 1, showGridLines: false }];
  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: lastDataRow, column: columnCount } };
  }
  const totalWidth = columns.reduce((sum, _column, index) => sum + (sheet.getColumn(index + 1).width ?? WIDTH.min), 0);
  sheet.pageSetup = {
    paperSize: 9,
    orientation: totalWidth > 95 ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${header.number}:${header.number}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
  };
  sheet.headerFooter.oddFooter = '&C&P / &N';
}

/** Builds an .xlsx with one formatted sheet per entry. */
export async function buildSheetWorkbook(sheets: SheetSpec[], creator = 'Game Club Finance'): Promise<Uint8Array> {
  // Loaded on demand: the spreadsheet writer is large and only needed once Export is pressed.
  const imported = await import('exceljs');
  const Excel = (imported.default ?? imported) as typeof ExcelJS;
  const workbook = new Excel.Workbook();
  workbook.creator = creator;
  workbook.created = new Date();
  const usedNames = new Set<string>();
  for (const sheet of sheets) addSheet(workbook, sheet, usedNames);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** `debts-2026-11-17.xlsx`, or `reports-2026-11-01_2026-11-30.xlsx` for a range; unsafe characters in `base` are dropped. */
export function sheetFileName(base: string, from: string, to?: string): string {
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
  return `${safe}-${to && to !== from ? `${from}_${to}` : from}.xlsx`;
}

/** Saves the workbook as a file from the browser. */
export function downloadSheet(fileName: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a tick later: some browsers start the download asynchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
