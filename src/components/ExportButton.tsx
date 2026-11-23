'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import { Button, useToast, type ButtonProps } from '@/components/PresentationFoundation';
import { formatDateTime } from '@/lib/formatters';
import { buildSheetWorkbook, downloadSheet, type SheetSpec } from '@/lib/sheetExport';

/** One sheet of an export. The club, the export time and the row count are added to its title block here. */
export interface ExportSheet extends Pick<SheetSpec, 'name' | 'columns' | 'rows'> {
  /** First line of the sheet; the tab name when left out. */
  title?: string;
  /** What the rows cover, already formatted: a date range, a month, or the filter in use. */
  period?: string;
  /** Label of the totals row; "Total" when left out. */
  totalLabel?: string;
}

export interface ExportFile {
  fileName: string;
  sheets: ExportSheet[];
}

export interface ExportButtonProps {
  /** Called on press, so the file holds the rows as filtered on screen at that moment. */
  build: () => ExportFile;
  disabled?: boolean;
  size?: ButtonProps['size'];
}

/** The Export action of a list: writes a formatted .xlsx in the browser, with no request. */
export function ExportButton({ build, disabled, size }: ExportButtonProps) {
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { selectedClub } = useClub();
  const { showToast, toastElement } = useToast();
  const [exporting, setExporting] = useState(false);

  async function exportFile() {
    setExporting(true);
    try {
      const { fileName, sheets } = build();
      const exportedAt = formatDateTime(new Date(), locale);
      const bytes = await buildSheetWorkbook(sheets.map((sheet): SheetSpec => ({
        name: sheet.name,
        title: sheet.title ?? sheet.name,
        subtitle: [selectedClub?.name, sheet.period].filter(Boolean).join(' · ') || undefined,
        note: tc('exportNote', { date: exportedAt, count: sheet.rows.length }),
        columns: sheet.columns,
        rows: sheet.rows,
        totalLabel: sheet.totalLabel ?? tc('total'),
      })));
      downloadSheet(fileName, bytes);
    } catch {
      showToast(tc('exportFailed'), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={exportFile}
        disabled={disabled}
        loading={exporting}
        loadingLabel={tc('exporting')}
        icon={<Download size={16} aria-hidden="true" />}
      >
        {tc('export')}
      </Button>
      {toastElement}
    </>
  );
}
