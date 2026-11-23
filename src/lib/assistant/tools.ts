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
  summary: 'headline totals for the period: income by source (computers, playstation, debts), bar cost, expenses, accounting profit, margins, daily averages including PlayStation average per day and its share of game-club income',
  money: 'the Reports page figures: money collected, expenses and money left per payment method (cash, terminal, card, playstation), then gameClub, bar and total rows; collected excludes bar sales; use it for cash/terminal/card questions and for how much money came in',
  daily: 'one row per day: game-club income with its PlayStation money, bar cost, game-club and bar expenses, total spent, profit; use it for day-over-day PlayStation growth',
  monthly: 'one row per month for the last N months (use `months`, max 24): game-club income with its PlayStation money, profit, bar sales; use it for month-over-month comparisons, PlayStation included',
  categories: 'expenses grouped by category with share of all expenses',
  expenses: 'every expense row (date, category, amount, payment method, paid from game club or bar, comment); optional `category` filter',
  product_sales: 'bar sales per product: sold quantity, promo giveaways, sales, cost, profit; best sellers first',
  checks: 'money checks for the calendar month that `from` falls in (default: the current month): things that look off and are worth a second look, worst and newest first. checkKind is duplicate_expense (count rows with the same date, category, amount, side and method; amount is the repeated amount), category_spike (amount is the category spent so far this month, usual is what the three earlier months had spent by the same day), low_income_day (amount is that day\'s game-club income or bar sales by side, usual is the average of the same weekday over the previous eight weeks) or repeated_shortage (count cash shortages in periodFrom..periodTo, amount their total). severity danger or warning; side game_club or bar, never added together',
  upcoming: 'what is still due on each expense plan this month: side, plan name, category, remainingAmount (planned minus paid, never below 0), dueDate (the plan\'s usual pay day), dueStatus paid, overdue or due, and one dueStatus total row per side. Only the current business month has rows; any other month returns none',
  outlook: 'the current business month at a glance, for "can we afford it" questions; ignores dates and always covers the current month. One metric row each, per side (game club and bar never added together): income or bar sales and profit so far, the month-end profit forecast (Projected…) and the forecast profit for the rest of the month (ProjectedProfitRest), an accounting-profit projection from this month\'s pace, null until the side has an entry this month; what is still due on expense plans (StillDue); money left this month (gameClubMoneyLeftCash, gameClubMoneyLeftTerminal, gameClubMoneyLeftCard, gameClubMoneyLeftPlaystation, gameClubMoneyLeft, barMoneyLeft), which is this month\'s money in minus money out as the money dataset shows it, before owner withdrawals and without money carried from earlier months, not cash on hand; the payment-method rows are the game club\'s only, the bar has only its side total; from Owner profit, what the owner withdrew this month (OwnerWithdrawn) and what Owner profit shows as left to take this month (LeftAfterWithdrawals), which already includes profit carried in from earlier months and is after reserve deposits and returns, so it is never adjusted again for either; daysLeft; and reserveSums (what the owner reserve holds, set aside, not part of money left). `unavailable` lists the parts left out of the rows (forecast, stillDue, moneyLeft, ownerWithdrawals, reserve), each with reason no_access (the member may not see it), read_failed (it could not be read just now) or not_set_up (the club does not have that feature yet)',
  stock: 'current stock of every active product with low-stock level; ignores dates',
  debts: 'customer debts with paid and remaining amounts; `debt_status` open (default), paid or all; ignores dates',
};

const queryShape = {
  from: z.string().optional()
    .describe('Period start, YYYY-MM-DD. Defaults to the first day of the current business month. For checks and upcoming, any day of the month wanted.'),
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
        const { table, period, links, unavailable } = await loader.load(toQuery(input.dataset, input));
        return { period: period ?? null, ...tableForModel(table), links, ...(unavailable ? { unavailable } : {}) };
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
          // A sheet with `unavailable` parts is incomplete; the model is told to say so.
          sheets: loaded.map(({ table, period, unavailable }) => ({
            dataset: table.dataset,
            rows: table.rows.length,
            period: period ?? null,
            ...(unavailable?.length ? { unavailable } : {}),
          })),
        };
      }),
    }),
  };
}
