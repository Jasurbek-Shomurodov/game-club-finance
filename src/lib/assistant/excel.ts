import type { ExcelColumn, ExcelSheet, WorkbookOptions } from 'hoggish-assistant/excel';
import type { DataTable } from './datasets';

/** Translates a dotted message path; returns null when the key is missing. */
export type Translate = (path: string) => string | null;

/** Column values that are stored keys and should be shown with a translated label. */
const VALUE_LABELS: Record<string, (value: string) => string> = {
  category: (value) => `expenses.categories.${value}`,
  paymentMethod: (value) => `common.paymentMethods.${value}`,
  paymentSource: (value) => `assistant.paymentSources.${value}`,
  debtStatus: (value) => `debts.${value}`,
  stockLevel: (value) => `assistant.stockLevels.${value}`,
  metric: (value) => `assistant.metrics.${value}`,
  line: (value) => `assistant.moneyLines.${value}`,
  side: (value) => `assistant.paymentSources.${value}`,
  checkKind: (value) => `assistant.checkKinds.${value}`,
  severity: (value) => `assistant.severities.${value}`,
  dueStatus: (value) => `assistant.dueStatuses.${value}`,
};

/**
 * Excel needs one number format per column, so a metric table's mixed value
 * column (summary, outlook) is split into a money column, a percent column
 * and, when a row counts something else (days), a plain number column.
 */
function excelTable(table: DataTable): Pick<ExcelSheet, 'columns' | 'rows'> {
  if (table.dataset !== 'summary' && table.dataset !== 'outlook') {
    return { columns: table.columns.map(({ key, type }) => ({ key, type })), rows: table.rows };
  }
  const kind = (unit: unknown) => (unit === '%' ? 'percent' : unit === 'UZS' || unit === undefined ? 'money' : 'number');
  const hasNumbers = table.rows.some((row) => kind(row.unit) === 'number');
  return {
    columns: [
      { key: 'metric', type: 'text' },
      { key: 'value', type: 'money' },
      { key: 'percentValue', type: 'percent' },
      ...(hasNumbers ? [{ key: 'numberValue', type: 'number' as const }] : []),
    ],
    rows: table.rows.map((row) => {
      const unit = kind(row.unit);
      return {
        metric: row.metric,
        value: unit === 'money' ? row.value : null,
        percentValue: unit === 'percent' ? row.value : null,
        ...(hasNumbers ? { numberValue: unit === 'number' ? row.value : null } : {}),
      };
    }),
  };
}

/** One translated sheet for a dataset table, ready for the shared Excel builder. */
export function datasetSheet(table: DataTable, translate: Translate, period?: string): ExcelSheet {
  const name = translate(`assistant.datasets.${table.dataset}`) ?? table.dataset;
  const { columns, rows } = excelTable(table);
  return {
    name,
    title: period ? `${name} · ${period}` : undefined,
    columns: columns.map((column): ExcelColumn => {
      const labelPath = VALUE_LABELS[column.key];
      return {
        ...column,
        headerKey: `assistant.columns.${column.key}`,
        label: labelPath ? (value) => translate(labelPath(value)) : undefined,
      };
    }),
    rows,
  };
}

export function workbookOptions(translate: Translate): WorkbookOptions {
  return { translate, creator: 'Game Club Finance', moneyDecimals: 0, percentScale: 'whole' };
}
