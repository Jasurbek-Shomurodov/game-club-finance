import { z } from 'zod';
import { formatDateOnly } from '@/lib/formatters';
import { tableForModel, type AssistantDataset } from './datasets';
import { buildWorkbook, type Translate } from './excel';
import { DatasetQueryError, type DatasetQuery, type createDatasetLoader } from './loaders';
import type { AssistantLocale } from './locales';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_EXPORT_DATASETS = 6;

export interface AssistantFile {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

/** Provider-neutral tool definition; each provider adapts it to its own API shape. */
export interface AssistantToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the input object. */
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] };
}

export interface ToolOutcome {
  /** JSON-serialisable result handed back to the model. */
  result: unknown;
  isError?: boolean;
  file?: AssistantFile;
}

const DATASET_HELP: Record<AssistantDataset, string> = {
  summary: 'headline totals for the period: income by source, bar cost, expenses, accounting profit, margins, daily averages',
  daily: 'one row per day: income, bar cost, game-club and bar expenses, total spent, profit',
  monthly: 'one row per month for the last N months (use `months`, max 24): income, spent, profit',
  categories: 'expenses grouped by category with share of all expenses',
  expenses: 'every expense row (date, category, amount, payment method, paid from game club or bar, comment); optional `category` filter',
  product_sales: 'bar sales per product: sold quantity, promo giveaways, sales, cost, profit; best sellers first',
  stock: 'current stock of every active product with low-stock level; ignores dates',
  debts: 'customer debts with paid and remaining amounts; `debt_status` open (default), paid or all; ignores dates',
};

const QUERY_PROPERTIES = {
  from: { type: 'string', description: 'Period start, YYYY-MM-DD. Defaults to the first day of the current business month.' },
  to: { type: 'string', description: 'Period end, YYYY-MM-DD, inclusive. Defaults to the current business date.' },
  months: { type: 'integer', minimum: 1, maximum: 24, description: 'Only for the monthly dataset. Defaults to 12.' },
  category: { type: 'string', description: 'Only for the expenses dataset: an expense category key such as rent or salary.' },
  debt_status: { type: 'string', enum: ['open', 'paid', 'all'], description: 'Only for the debts dataset.' },
};

const queryShape = {
  from: z.string().optional(),
  to: z.string().optional(),
  months: z.number().int().min(1).max(24).optional(),
  category: z.string().max(64).optional(),
  debt_status: z.enum(['open', 'paid', 'all']).optional(),
};

/**
 * Tool definitions for the datasets this member may read. Tools are read-only:
 * the assistant cannot record, edit or delete anything.
 */
export function assistantToolDefinitions(datasets: AssistantDataset[]): AssistantToolSpec[] {
  if (datasets.length === 0) return [];
  const datasetList = datasets.map((dataset) => `- ${dataset}: ${DATASET_HELP[dataset]}`).join('\n');
  return [
    {
      name: 'get_data',
      description: [
        'Read one dataset for the selected game club. All money is whole UZS.',
        'Call it several times (in parallel when independent) to compare periods or combine datasets.',
        `Datasets:\n${datasetList}`,
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          dataset: { type: 'string', enum: datasets },
          ...QUERY_PROPERTIES,
        },
        required: ['dataset'],
      },
    },
    {
      name: 'export_excel',
      description: [
        'Create a downloadable Excel (.xlsx) file for the user, one sheet per dataset, with every row',
        '(not only the rows you saw). Use it whenever the user asks for Excel, a spreadsheet, a table file or a download.',
        'All datasets in one call share the same period. Tell the user the file is attached below your message.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          datasets: {
            type: 'array',
            items: { type: 'string', enum: datasets },
            minItems: 1,
            maxItems: MAX_EXPORT_DATASETS,
          },
          file_title: { type: 'string', description: 'Short file name without extension, in the user\'s language.' },
          ...QUERY_PROPERTIES,
        },
        required: ['datasets'],
      },
    },
  ];
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'report';
}

function errorOutcome(message: string): ToolOutcome {
  return { result: { error: message }, isError: true };
}

export function createToolExecutor({
  datasets,
  loader,
  translate,
  locale,
}: {
  datasets: AssistantDataset[];
  loader: ReturnType<typeof createDatasetLoader>;
  translate: Translate;
  locale: AssistantLocale;
}) {
  const datasetSchema = z.enum(datasets as [AssistantDataset, ...AssistantDataset[]]);
  const getDataInput = z.object({ dataset: datasetSchema, ...queryShape });
  const exportInput = z.object({
    datasets: z.array(datasetSchema).min(1).max(MAX_EXPORT_DATASETS),
    file_title: z.string().max(80).optional(),
    ...queryShape,
  });

  const toQuery = (dataset: AssistantDataset, input: z.infer<typeof getDataInput> | z.infer<typeof exportInput>): DatasetQuery => ({
    dataset,
    from: input.from,
    to: input.to,
    months: input.months,
    category: input.category,
    debtStatus: input.debt_status,
  });

  const periodLabel = (period?: { from: string; to: string }) => (
    period ? `${formatDateOnly(period.from, locale)} – ${formatDateOnly(period.to, locale)}` : undefined
  );

  async function run(name: string, rawInput: unknown): Promise<ToolOutcome> {
    if (datasets.length === 0) return errorOutcome('This member has no data access in this club.');
    try {
      if (name === 'get_data') {
        const input = getDataInput.safeParse(rawInput);
        if (!input.success) return errorOutcome(`Invalid input: ${input.error.issues.map((issue) => issue.message).join('; ')}`);
        const { table, period } = await loader.load(toQuery(input.data.dataset, input.data));
        return { result: { period: period ?? null, ...tableForModel(table) } };
      }

      if (name === 'export_excel') {
        const input = exportInput.safeParse(rawInput);
        if (!input.success) return errorOutcome(`Invalid input: ${input.error.issues.map((issue) => issue.message).join('; ')}`);
        const unique = [...new Set(input.data.datasets)];
        const loaded = await Promise.all(unique.map((dataset) => loader.load(toQuery(dataset, input.data))));
        const data = await buildWorkbook(
          loaded.map(({ table, period }) => ({ table, subtitle: periodLabel(period) })),
          translate,
        );
        const fileName = `${slug(input.data.file_title || translate('assistant.defaultFileName') || 'report')}.xlsx`;
        return {
          result: {
            fileName,
            sheets: loaded.map(({ table, period }) => ({ dataset: table.dataset, rows: table.rows.length, period: period ?? null })),
          },
          file: { fileName, mimeType: XLSX_MIME, data },
        };
      }

      return errorOutcome(`Unknown tool ${name}`);
    } catch (error) {
      if (error instanceof DatasetQueryError) return errorOutcome(error.message);
      throw error;
    }
  }

  return { run };
}
