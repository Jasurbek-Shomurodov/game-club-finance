import { describe, expect, it } from 'vitest';
import { csvFileName, csvSeparatorForLocale, toCsv } from './csv';

describe('toCsv', () => {
  it('writes the header and rows with CRLF line ends', () => {
    expect(toCsv(['Name', 'Amount'], [['Cola', 5000], ['Chips', 3000]])).toBe('Name,Amount\r\nCola,5000\r\nChips,3000');
  });

  it('keeps numbers bare and leaves empty cells empty', () => {
    expect(toCsv(['a', 'b', 'c', 'd'], [[1_000_000.5, null, undefined, Number.NaN]])).toBe('a,b,c,d\r\n1000000.5,,,');
    expect(toCsv(['n'], [[-250]])).toBe('n\r\n-250');
    expect(toCsv(['x', 'y'], [[true, false]])).toBe('x,y\r\n1,0');
  });

  it('quotes fields holding the separator, a quote or a line break', () => {
    expect(toCsv(['c'], [['water, bread'], ['said "ok"'], ['two\nlines']])).toBe('c\r\n"water, bread"\r\n"said ""ok"""\r\n"two\nlines"');
    // A comma is ordinary text when the separator is a semicolon.
    expect(toCsv(['c', 'd'], [['water, bread', 'a;b']], ';')).toBe('c;d\r\nwater, bread;"a;b"');
  });

  it('never lets typed text run as a formula', () => {
    expect(toCsv(['c'], [['=SUM(A1:A9)'], ['+998 90 123'], ['-discount'], ['@home']])).toBe("c\r\n'=SUM(A1:A9)\r\n'+998 90 123\r\n'-discount\r\n'@home");
    expect(toCsv(['c'], [['=1,2']])).toBe('c\r\n"\'=1,2"');
  });
});

describe('csvSeparatorForLocale', () => {
  it('uses a comma for English and a semicolon elsewhere', () => {
    expect(csvSeparatorForLocale('en')).toBe(',');
    expect(csvSeparatorForLocale('en-US')).toBe(',');
    expect(csvSeparatorForLocale('ru')).toBe(';');
    expect(csvSeparatorForLocale('uz')).toBe(';');
  });
});

describe('csvFileName', () => {
  it('names a single day and a range', () => {
    expect(csvFileName('debts', '2026-11-17')).toBe('debts-2026-11-17.csv');
    expect(csvFileName('reports', '2026-11-01', '2026-11-30')).toBe('reports-2026-11-01_2026-11-30.csv');
    expect(csvFileName('reports', '2026-11-17', '2026-11-17')).toBe('reports-2026-11-17.csv');
  });

  it('drops characters that do not belong in a file name', () => {
    expect(csvFileName('Bar / Products!', '2026-11-17')).toBe('bar-products-2026-11-17.csv');
    expect(csvFileName('***', '2026-11-17')).toBe('export-2026-11-17.csv');
  });
});
