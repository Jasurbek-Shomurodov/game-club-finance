import { z } from 'zod';
import { defineTool, ToolError, type AssistantTools } from 'hoggish-assistant/server';
import { excelFile, safeFileName } from 'hoggish-assistant/excel';
import { formatDateOnly } from '@/lib/formatters';
import { tableForModel, type AssistantDataset } from './datasets';
import { datasetSheet, workbookOptions, type Translate } from './excel';
import { DatasetQueryError, type DatasetQuery, type createDatasetLoader } from './loaders';
import type { AssistantLocale } from './locales';

const MAX_EXPORT_DATASETS = 6;

const DATASET_HELP: Record<AssistantDataset, string> = {
  summary: 'headline totals for the period: income by source, bar cost, expenses, accounting profit, margins, daily averages',
  daily: 'one row per day: income, bar cost, game-club and bar expenses, total spent, profit',
  monthly: 'one row per month for the last N months (use `months`, max 24): income, spent, profit; use it for month-over-month comparisons',
  categories: 'expenses grouped by category with share of all expenses',
  expenses: 'every expense row (date, category, amount, payment method, paid from game club or bar, comment); optional `category` filter',
  product_sales: 'bar sales per product: sold quantity, promo giveaways, sales, cost, profit; best sellers first',
  stock: 'current stock of every active product with low-stock level; ignores dates',
  debts: 'customer debts with paid and remaining amounts; `debt_status` open (default), paid or all; ignores dates',
};

const queryShape = {
  from: z.string().optional()
    .describe('Period start, YYYY-MM-DD. Defaults to the first day of the current business month.'),
  to: z.string().optional()
    .describe('Period end, YYYY-MM-DD, inclusive. Defaults to the current business date.'),
  months: z.number().int().min(1).max(24).optional()
    .describe('Only for the monthly dataset. Defaults to 12.'),
  category: z.string().max(64).optional()
    .describe('Only for the expenses dataset: an expense category key such as rent or salary.'),
  debt_status: z.enum(['open', 'paid', 'all']).optional()
    .describe('Only for the debts dataset.'),
};

type QueryInput = z.infer<z.ZodObject<typeof queryShape>>;

function toQuery(dataset: AssistantDataset, input: QueryInput): DatasetQuery {
  return {
    dataset,
    from: input.from,
    to: input.to,
    months: input.months,
    category: input.category,
    debtStatus: input.debt_status,
  };
}

/** Shows the model a safe message for bad periods; anything else is a real failure. */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DatasetQueryError) throw new ToolError(error.message);
    throw error;
  }
}

/**
 * Read-only tools for the datasets this member may read: the assistant cannot
 * record, edit or delete anything. Every read goes through the member's own
 * Supabase client in `loader`, so RLS still authorizes each row.
 */
export function assistantTools({
  datasets,
  loader,
  translate,
  locale,
}: {
  datasets: AssistantDataset[];
  loader: Pick<ReturnType<typeof createDatasetLoader>, 'load'>;
  translate: Translate;
  locale: AssistantLocale;
}): AssistantTools {
  if (datasets.length === 0) return {};
  const datasetSchema = z.enum(datasets as [AssistantDataset, ...AssistantDataset[]]);
  const datasetList = datasets.map((dataset) => `- ${dataset}: ${DATASET_HELP[dataset]}`).join('\n');
  const periodLabel = (period?: { from: string; to: string }) => (
    period ? `${formatDateOnly(period.from, locale)} – ${formatDateOnly(period.to, locale)}` : undefined
  );

  return {
    get_data: defineTool({
      description: [
        'Read one dataset for the selected game club. All money is whole UZS.',
        'Call it several times (in parallel when independent) to compare periods or combine datasets.',
        `Datasets:\n${datasetList}`,
      ].join('\n'),
      inputSchema: z.object({ dataset: datasetSchema, ...queryShape }),
      execute: (input) => guard(async () => {
        const { table, period } = await loader.load(toQuery(input.dataset, input));
        return { period: period ?? null, ...tableForModel(table) };
      }),
    }),
    export_excel: defineTool({
      description: [
        'Create a downloadable Excel (.xlsx) file for the user, one sheet per dataset, with every row',
        '(not only the rows you saw). Use it whenever the user asks for Excel, a spreadsheet, a table file or a download.',
        'All datasets in one call share the same period. Tell the user the file is attached below your message.',
      ].join(' '),
      inputSchema: z.object({
        datasets: z.array(datasetSchema).min(1).max(MAX_EXPORT_DATASETS),
        file_title: z.string().max(80).optional()
          .describe('Short file name without extension, in the user\'s language.'),
        ...queryShape,
      }),
      execute: (input, { attachFile }) => guard(async () => {
        const unique = [...new Set(input.datasets)];
        const loaded = await Promise.all(unique.map((dataset) => loader.load(toQuery(dataset, input))));
        const fileName = safeFileName(input.file_title || translate('assistant.defaultFileName') || 'report', 'xlsx');
        attachFile(await excelFile(
          fileName,
          loaded.map(({ table, period }) => datasetSheet(table, translate, periodLabel(period))),
          workbookOptions(translate),
        ));
        return {
          fileName,
          sheets: loaded.map(({ table, period }) => ({ dataset: table.dataset, rows: table.rows.length, period: period ?? null })),
        };
      }),
    }),
  };
}
