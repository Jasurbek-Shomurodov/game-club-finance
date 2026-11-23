import { ToolError } from 'hoggish-assistant/server';
import { describe, expect, it, vi } from 'vitest';
import type { DataTable } from './datasets';
import { createTranslator } from './i18n';
import { DatasetQueryError } from './loaders';
import { assistantTools } from './tools';

const stockTable: DataTable = {
  dataset: 'stock',
  columns: [{ key: 'product', type: 'text' }, { key: 'currentStock', type: 'number' }],
  rows: [{ product: 'Cola', currentStock: 2 }],
};

function setup(datasets: Parameters<typeof assistantTools>[0]['datasets'] = ['summary', 'stock']) {
  const load = vi.fn().mockResolvedValue({ table: stockTable, links: [{ label: 'Products and stock', href: '/products' }] });
  const tools = assistantTools({ datasets, loader: { load }, translate: createTranslator('en'), locale: 'en' });
  const attachFile = vi.fn();
  const options = { signal: new AbortController().signal, toolCallId: 'call-1', attachFile };
  return { tools, load, attachFile, options };
}

async function validate(schema: unknown, input: unknown) {
  return (schema as { '~standard': { validate: (value: unknown) => Promise<{ issues?: unknown[] }> } })['~standard'].validate(input);
}

describe('assistantTools', () => {
  it('offers no tools to a member without data access', () => {
    expect(setup([]).tools).toEqual({});
  });

  it('only accepts datasets the member may read', async () => {
    const { tools } = setup(['stock']);
    expect((await validate(tools.get_data.inputSchema, { dataset: 'stock' })).issues).toBeUndefined();
    expect((await validate(tools.get_data.inputSchema, { dataset: 'debts' })).issues).toBeDefined();
    expect((await validate(tools.export_excel.inputSchema, { datasets: ['debts'] })).issues).toBeDefined();
  });

  it('is read-only: no tool asks for confirmation', () => {
    const { tools } = setup();
    expect(Object.values(tools).every((tool) => !tool.needsConfirmation)).toBe(true);
  });

  it('reads a dataset and maps query fields for the loader', async () => {
    const { tools, load, options } = setup();
    const result = await tools.get_data.execute(
      { dataset: 'stock', from: '2026-10-01', to: '2026-10-15', debt_status: 'all' },
      options,
    );
    expect(load).toHaveBeenCalledWith(expect.objectContaining({
      dataset: 'stock', from: '2026-10-01', to: '2026-10-15', debtStatus: 'all',
    }));
    expect(result).toMatchObject({
      dataset: 'stock',
      rowCount: 1,
      truncated: false,
      rows: [{ product: 'Cola' }],
      links: [{ label: 'Products and stock', href: '/products' }],
    });
  });

  it('tells the model which parts of a dataset were left out and why', async () => {
    const { tools, load, options } = setup();
    const unavailable = [{ part: 'ownerWithdrawals', reason: 'read_failed' }, { part: 'reserve', reason: 'no_access' }];
    load.mockResolvedValueOnce({ table: stockTable, links: [], unavailable });
    expect(await tools.get_data.execute({ dataset: 'stock' }, options)).toMatchObject({ unavailable });
    expect(await tools.get_data.execute({ dataset: 'stock' }, options)).not.toHaveProperty('unavailable');
  });

  it('marks an exported sheet with missing parts as incomplete', async () => {
    const { tools, load, options } = setup();
    const unavailable = [{ part: 'forecast', reason: 'read_failed' }];
    load.mockResolvedValueOnce({ table: { ...stockTable, dataset: 'outlook' }, links: [], unavailable });
    const result = await tools.export_excel.execute({ datasets: ['stock'] }, options);
    expect(result).toMatchObject({ sheets: [{ dataset: 'outlook', rows: 1, period: null, unavailable }] });
  });

  it('turns bad periods into a ToolError the model can act on', async () => {
    const { tools, load, options } = setup();
    load.mockRejectedValueOnce(new DatasetQueryError('The period starts after its end.'));
    await expect(tools.get_data.execute({ dataset: 'summary' }, options)).rejects.toBeInstanceOf(ToolError);
  });

  it('does not hide database failures as tool errors', async () => {
    const { tools, load, options } = setup();
    load.mockRejectedValueOnce(new Error('permission denied'));
    await expect(tools.get_data.execute({ dataset: 'summary' }, options)).rejects.not.toBeInstanceOf(ToolError);
  });

  it('exports each dataset once and attaches an xlsx file', async () => {
    const { tools, load, attachFile, options } = setup();
    const result = await tools.export_excel.execute({ datasets: ['stock', 'stock'], file_title: 'Stock: Oct' }, options);

    expect(load).toHaveBeenCalledTimes(1);
    expect(attachFile).toHaveBeenCalledTimes(1);
    const file = attachFile.mock.calls[0][0];
    expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(file.fileName).toMatch(/\.xlsx$/);
    expect(file.fileName).not.toContain(':');
    expect(file.data.byteLength).toBeGreaterThan(0);
    expect(result).toEqual({ fileName: file.fileName, sheets: [{ dataset: 'stock', rows: 1, period: null }] });
  });
});
