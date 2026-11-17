export type CsvCell = string | number | boolean | null | undefined;

/**
 * The field separator a spreadsheet expects for the app language. Excel splits
 * a file by the system list separator, which is ";" where the decimal mark is
 * a comma (Russian, Uzbek) and "," in English.
 */
export function csvSeparatorForLocale(locale: string): ',' | ';' {
  return locale.toLowerCase().startsWith('en') ? ',' : ';';
}

/** A string starting with one of these is run as a formula by spreadsheets. */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvField(value: CsvCell, separator: string): string {
  if (value === null || value === undefined) return '';
  // Numbers stay bare (no thousands separators) so a spreadsheet can add them up.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  // Text typed by people (names, comments) must never execute: a leading
  // "=", "+", "-" or "@" gets an apostrophe, which spreadsheets show as text.
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return text.includes(separator) || /["\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 rows joined with CRLF, header first. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly CsvCell[]>, separator: ',' | ';' = ','): string {
  return [headers, ...rows].map((row) => row.map((cell) => csvField(cell, separator)).join(separator)).join('\r\n');
}

/** `debts-2026-11-17.csv`, or `reports-2026-11-01_2026-11-30.csv` for a range; unsafe characters in `base` are dropped. */
export function csvFileName(base: string, from: string, to?: string): string {
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
  return `${safe}-${to && to !== from ? `${from}_${to}` : from}.csv`;
}

/**
 * Saves `csv` as a file from the browser. The byte-order mark makes Excel read
 * the UTF-8 Cyrillic and Uzbek text correctly.
 */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a tick later: some browsers start the download asynchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
