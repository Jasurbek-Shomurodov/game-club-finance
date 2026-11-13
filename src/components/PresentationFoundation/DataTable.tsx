import { useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PresenceCell, presenceProps, useListPresence, type Presence } from './listPresence';
import { stickyOffsetBelow, useElementHeight } from './useElementHeight';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Applied to both header and body cells (widths, responsive hiding). */
  className?: string;
  /** Applied only to body cells. */
  cellClassName?: string;
  /**
   * With `mobileCards`, how the cell sits in a phone row: `title` heads the
   * card across its full width with no label (the first column by default),
   * `full` takes the full width under its label, `action` sits unlabelled in
   * the card's top corner (the default for a column keyed `actions`), and
   * `hidden` is left out.
   */
  mobile?: 'title' | 'full' | 'action' | 'hidden';
}

export interface DataTableGroup<T> {
  key: string;
  /** Content of the full-width section header row. */
  header: ReactNode;
  rows: T[];
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  /** Optional footer/totals row: cell content per column key. */
  footer?: Partial<Record<string, ReactNode>>;
  emptyState?: ReactNode;
  stickyHeader?: boolean;
  /** Min table width before horizontal scrolling kicks in. */
  minWidth?: number | string;
  rowClassName?: (row: T, index: number) => string | undefined;
  onRowClick?: (row: T) => void;
  className?: string;
  /** Accessible name for the scroll region (lets keyboard users scroll wide tables). */
  label?: string;
  /** Removes the outer border/shadow when the table sits inside a Card. */
  bare?: boolean;
  dense?: boolean;
  /** Renders rows in titled sections; `data` still drives the empty state.
   *  With `stickyHeader`, each section title sticks below the column headers. */
  groups?: DataTableGroup<T>[];
  /**
   * On phones, show each row as a small card (title, then labelled values two
   * to a line) instead of a wide table that scrolls sideways. The markup stays
   * one table, so nothing changes from `sm` up.
   */
  mobileCards?: boolean;
}

type MobileMode = NonNullable<DataTableColumn<unknown>['mobile']> | 'value';

function mobileMode<T>(column: DataTableColumn<T>, index: number): MobileMode {
  return column.mobile ?? (index === 0 ? 'title' : column.key === 'actions' ? 'action' : 'value');
}

/** Phone layout of one cell when the table is shown as cards. */
function mobileCellClassName(mode: MobileMode, hasAction: boolean) {
  if (mode === 'hidden') return 'max-sm:hidden';
  if (mode === 'action') return 'max-sm:absolute max-sm:right-2 max-sm:top-2 max-sm:block max-sm:!w-auto max-sm:!p-0';
  return cn(
    'max-sm:block max-sm:!w-auto max-sm:!min-w-0 max-sm:!max-w-none max-sm:!p-0 max-sm:!text-left',
    (mode === 'title' || mode === 'full') && 'max-sm:col-span-2',
    // Keep the title clear of the actions in the corner.
    mode === 'title' && hasAction && 'max-sm:!pr-12',
  );
}

const MOBILE_ROW = 'max-sm:relative max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-2.5 max-sm:px-4 max-sm:py-3.5';
const MOBILE_LABEL = 'mb-0.5 block text-[11px] font-medium leading-4 text-gray-500 sm:hidden';

/** Pairs each shown row with its index among the rows still in the data, so a row folding away does not shift numbering. */
function withLiveIndex<E extends { presence?: Presence }>(entries: E[]) {
  let live = 0;
  return entries.map((entry) => ({ entry, index: entry.presence === 'exit' ? live : live++ }));
}

const alignClass = { left: 'text-left', right: 'text-right tabular-nums', center: 'text-center' };

/** Standard data table: uppercase header, zebra hover, optional totals row. */
export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  footer,
  emptyState,
  stickyHeader = false,
  minWidth = 720,
  rowClassName,
  onRowClick,
  className,
  bare = false,
  dense = false,
  label,
  groups,
  mobileCards = false,
}: DataTableProps<T>) {
  const cellPadding = dense ? 'px-3 py-2.5' : 'px-4 py-3';
  const hasAction = columns.some((column, index) => mobileMode(column, index) === 'action');
  const [theadRef, theadHeight] = useElementHeight<HTMLTableSectionElement>();
  // One presence list across every section, tagged with its section, so a row
  // added or removed in place grows in or folds away wherever it sits.
  const tagged = useMemo(
    () => (groups ? groups.flatMap((group) => group.rows.map((row) => ({ group: group.key, row }))) : data.map((row) => ({ group: '', row }))),
    [data, groups],
  );
  const shown = useListPresence(tagged, (entry) => `${entry.group}\u0000${keyExtractor(entry.row)}`);

  const renderRow = (row: T, index: number, presence?: Presence) => (
    <tr
      key={keyExtractor(row)}
      {...presenceProps(presence)}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
      onKeyDown={onRowClick ? (event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onRowClick(row);
        }
      } : undefined}
      tabIndex={onRowClick ? 0 : undefined}
      className={cn('transition-colors hover:bg-gray-50/80', mobileCards && MOBILE_ROW, onRowClick && 'cursor-pointer focus-visible:bg-primary-50 focus-visible:outline-none', rowClassName?.(row, index))}
    >
      {columns.map((column, columnIndex) => {
        const content = column.render ? column.render(row, index) : String((row as Record<string, unknown>)[column.key] ?? '');
        // A cell with nothing in it would be a bare label on a phone card: leave it out there.
        const blank = content == null || content === false || content === '';
        const mode = mobileMode(column, columnIndex);
        const labelled = mobileCards && !blank && Boolean(column.header) && (mode === 'value' || mode === 'full');
        return (
        <td
          key={column.key}
          className={cn(cellPadding, 'text-gray-800', alignClass[column.align ?? 'left'], column.className, column.cellClassName, mobileCards && (blank ? 'max-sm:hidden' : mobileCellClassName(mode, hasAction)))}
        >
          <PresenceCell>
            {labelled && <span className={MOBILE_LABEL}>{column.header}</span>}
            {content}
          </PresenceCell>
        </td>
        );
      })}
    </tr>
  );

  // No rows: show the empty state on its own, not inside a min-width table
  // where it would be off-centre and scroll sideways on phones.
  const showEmptyOnly = data.length === 0 && emptyState != null;

  return (
    <div
      role={label ? 'region' : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
      className={cn(
        'max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        !bare && 'rounded-2xl border border-gray-200 bg-surface shadow-card',
        stickyHeader ? 'max-h-[calc(100dvh-12rem)] overflow-auto' : 'overflow-x-auto',
        // Cards flow with the page: no inner scroll box on phones.
        mobileCards && 'max-sm:max-h-none max-sm:overflow-visible',
        'scrollbar-thin',
        className,
      )}
    >
      {showEmptyOnly ? emptyState : (
        <table className={cn('w-full text-sm', mobileCards && 'max-sm:block max-sm:!min-w-0')} style={{ minWidth: typeof minWidth === 'number' ? `${minWidth}px` : minWidth }}>
          <thead ref={theadRef} className={cn(mobileCards && 'max-sm:sr-only')}>
            <tr className="border-b border-gray-200 bg-surface">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    cellPadding,
                    'text-xs font-medium text-gray-500',
                    alignClass[column.align ?? 'left'],
                    stickyHeader && 'sticky top-0 z-20 border-b border-gray-200 bg-surface',
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          {groups && data.length > 0 ? (
            groups.map((group) => ({ group, entries: shown.filter((entry) => entry.item.group === group.key) })).filter(({ entries }) => entries.length > 0).map(({ group, entries }) => (
              <tbody key={group.key} className={cn('divide-y divide-gray-100 bg-surface', mobileCards && 'max-sm:block')}>
                <tr className={cn('bg-gray-50', mobileCards && 'max-sm:block')}>
                  <th
                    scope="colgroup"
                    colSpan={columns.length}
                    style={stickyHeader ? { top: stickyOffsetBelow(theadHeight) } : undefined}
                    className={cn(
                      dense ? 'px-3 py-2' : 'px-4 py-2.5',
                      'bg-gray-50 text-left shadow-[inset_0_1px_0_rgb(var(--c-gray-200)),inset_0_-1px_0_rgb(var(--c-gray-200))] text-sm font-semibold text-gray-900',
                      stickyHeader && 'sticky z-10',
                      mobileCards && 'max-sm:static max-sm:block',
                    )}
                  >
                    {group.header}
                  </th>
                </tr>
                {withLiveIndex(entries).map(({ entry, index }) => renderRow(entry.item.row, index, entry.presence))}
              </tbody>
            ))
          ) : (
            <tbody className={cn('divide-y divide-gray-100 bg-surface', mobileCards && 'max-sm:block')}>
              {withLiveIndex(shown).map(({ entry, index }) => renderRow(entry.item.row, index, entry.presence))}
            </tbody>
          )}
          {footer && data.length > 0 && (
            <tfoot className={cn(mobileCards && 'max-sm:block')}>
              <tr className={cn('border-t border-gray-200 bg-gray-50 font-semibold text-gray-900', mobileCards && MOBILE_ROW)}>
                {columns.map((column, columnIndex) => {
                  const content = footer[column.key] ?? null;
                  const mode = columnIndex === 0 ? 'title' : mobileMode(column, columnIndex) === 'full' ? 'full' : 'value';
                  const labelled = mobileCards && Boolean(column.header) && columnIndex > 0;
                  return (
                  <td
                    key={column.key}
                    className={cn(
                      cellPadding, alignClass[column.align ?? 'left'], column.className,
                      // A totals row has gaps under the columns it does not sum; on phones only the filled ones are shown.
                      mobileCards && (content == null ? 'max-sm:hidden' : mobileCellClassName(mode, false)),
                    )}
                  >
                    {labelled && content != null && <span className={MOBILE_LABEL}>{column.header}</span>}
                    {content}
                  </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </div>
  );
}
