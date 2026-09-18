import type {
  Column,
  ReactTable,
  Row,
  RowData,
  TableFeatures,
  TableState,
} from '@tanstack/react-table';
import type {ComponentProps, CSSProperties, ReactNode} from 'react';
import {Panel, PanelHeader} from '#components/panel/index.js';
import {Skeleton} from '#components/skeleton/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/table/index.js';
import {cn} from '#utils/cn.js';

export type DataTableDensity = 'default' | 'compact';

export interface DataTableRowProps {
  'aria-describedby'?: string;
  'aria-label'?: string;
  className?: string;
  'data-selected'?: boolean;
  title?: string;
}

type DataTableAccessibleName =
  | {'aria-label': string; 'aria-labelledby'?: string}
  | {'aria-label'?: string; 'aria-labelledby': string};

export interface DataTableBaseProps<
  TFeatures extends TableFeatures,
  TData extends RowData,
  TSelected = TableState<TFeatures>,
> {
  className?: string;
  density?: DataTableDensity;
  emptyContent?: ReactNode;
  footer?: ReactNode;
  getRowProps?: (row: Row<TFeatures, TData>) => DataTableRowProps | undefined;
  isLoading?: boolean;
  isRefreshing?: boolean;
  loadingLabel?: string;
  loadingRowCount?: number;
  minimumWidth?: CSSProperties['minWidth'];
  stickyHeader?: boolean;
  table: ReactTable<TFeatures, TData, TSelected>;
  tableClassName?: string;
  toolbar?: ReactNode;
}

export type DataTableProps<
  TFeatures extends TableFeatures,
  TData extends RowData,
  TSelected = TableState<TFeatures>,
> = DataTableBaseProps<TFeatures, TData, TSelected> & DataTableAccessibleName;

export interface DataTableLoadingProps extends Omit<ComponentProps<typeof TableBody>, 'children'> {
  columnCount: number;
  density?: DataTableDensity;
  label?: string;
  rowCount?: number;
}

export function DataTableLoading({
  columnCount,
  density = 'default',
  label = 'Loading results',
  rowCount = 5,
  ...props
}: DataTableLoadingProps) {
  const safeColumnCount = Math.max(1, columnCount);
  const safeRowCount = Math.max(1, rowCount);
  const loadingRows = Array.from({length: safeRowCount}, (_, index) => `row-${index + 1}`);
  const loadingColumns = Array.from({length: safeColumnCount}, (_, index) => `column-${index + 1}`);

  return (
    <TableBody data-slot="data-table-loading" {...props}>
      {loadingRows.map((rowId, rowIndex) => (
        <TableRow key={rowId}>
          <TableCell
            colSpan={safeColumnCount}
            className={cn(density === 'compact' ? 'px-8 py-6' : 'px-12 py-10')}
          >
            {rowIndex === 0 ? <span className="sr-only">{label}</span> : null}
            <div
              aria-hidden="true"
              className="grid gap-cluster"
              style={{gridTemplateColumns: `repeat(${safeColumnCount}, minmax(0, 1fr))`}}
            >
              {loadingColumns.map((columnId, columnIndex) => (
                <Skeleton
                  key={columnId}
                  className={cn(
                    'h-16 max-w-full',
                    columnIndex % 3 === 0 && 'w-160',
                    columnIndex % 3 === 1 && 'w-120',
                    columnIndex % 3 === 2 && 'w-80',
                  )}
                />
              ))}
            </div>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

export interface DataTableEmptyProps extends Omit<ComponentProps<typeof TableBody>, 'children'> {
  children?: ReactNode;
  columnCount: number;
}

export function DataTableEmpty({
  children = 'No results.',
  columnCount,
  ...props
}: DataTableEmptyProps) {
  return (
    <TableBody data-slot="data-table-empty" {...props}>
      <TableRow>
        <TableCell colSpan={Math.max(1, columnCount)} className="h-120 px-12 py-24 text-center">
          <div className="flex min-h-72 items-center justify-center text-sm text-foreground-neutral-muted">
            {children}
          </div>
        </TableCell>
      </TableRow>
    </TableBody>
  );
}

function getVisibleColumnCount<TFeatures extends TableFeatures, TData extends RowData>(
  table: ReactTable<TFeatures, TData, unknown>,
) {
  const tableWithVisibility = table as typeof table & {
    getVisibleLeafColumns?: typeof table.getAllLeafColumns;
  };

  return tableWithVisibility.getVisibleLeafColumns?.().length ?? table.getAllLeafColumns().length;
}

function getRenderedCells<TFeatures extends TableFeatures, TData extends RowData>(
  row: Row<TFeatures, TData>,
) {
  const rowWithVisibility = row as typeof row & {
    getVisibleCells?: typeof row.getAllCells;
  };

  return rowWithVisibility.getVisibleCells?.() ?? row.getAllCells();
}

function getIsSelected<TFeatures extends TableFeatures, TData extends RowData>(
  row: Row<TFeatures, TData>,
) {
  const rowWithSelection = row as typeof row & {getIsSelected?: () => boolean};
  return rowWithSelection.getIsSelected?.() ?? false;
}

function getColumnAriaSort<TFeatures extends TableFeatures, TData extends RowData>(
  column: Column<TFeatures, TData, unknown>,
): ComponentProps<'th'>['aria-sort'] {
  const sortableColumn = column as typeof column & {
    getCanSort?: () => boolean;
    getIsSorted?: () => false | 'asc' | 'desc';
  };

  if (!sortableColumn.getCanSort?.()) return undefined;

  const direction = sortableColumn.getIsSorted?.();
  if (direction === 'asc') return 'ascending';
  if (direction === 'desc') return 'descending';
  return 'none';
}

export function DataTable<
  TFeatures extends TableFeatures,
  TData extends RowData,
  TSelected = TableState<TFeatures>,
>({
  className,
  density = 'default',
  emptyContent,
  footer,
  getRowProps,
  isLoading = false,
  isRefreshing = false,
  loadingLabel,
  loadingRowCount,
  minimumWidth,
  stickyHeader = false,
  table,
  tableClassName,
  toolbar,
  ...accessibleName
}: DataTableProps<TFeatures, TData, TSelected>) {
  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const visibleColumnCount = getVisibleColumnCount(table as ReactTable<TFeatures, TData, unknown>);
  const isCompact = density === 'compact';
  let tableBody: ReactNode;

  if (isLoading) {
    tableBody = (
      <DataTableLoading
        columnCount={visibleColumnCount}
        density={density}
        label={loadingLabel ?? 'Loading results'}
        rowCount={loadingRowCount ?? 5}
      />
    );
  } else if (rows.length === 0) {
    tableBody = <DataTableEmpty columnCount={visibleColumnCount}>{emptyContent}</DataTableEmpty>;
  } else {
    tableBody = (
      <TableBody>
        {rows.map((row) => {
          const rowProps = getRowProps?.(row);
          const selected = rowProps?.['data-selected'] ?? getIsSelected(row);

          return (
            <TableRow
              key={row.id}
              aria-describedby={rowProps?.['aria-describedby']}
              aria-label={rowProps?.['aria-label']}
              className={rowProps?.className}
              data-row-id={row.id}
              data-selected={selected ? 'true' : undefined}
              title={rowProps?.title}
            >
              {getRenderedCells(row).map((cell) => (
                <TableCell key={cell.id} className={cn(isCompact && 'px-8 py-6')}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    );
  }

  return (
    <Panel
      className={className}
      data-component="data-table"
      data-density={isCompact ? 'compact' : undefined}
    >
      {toolbar ? <PanelHeader data-slot="data-table-toolbar">{toolbar}</PanelHeader> : null}
      <Table
        {...accessibleName}
        aria-busy={isLoading || isRefreshing || undefined}
        className={tableClassName}
        style={{minWidth: minimumWidth}}
      >
        <TableHeader className={cn(stickyHeader && 'sticky top-0 z-10')}>
          {headerGroups.map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                if (header.rowSpan === 0) return null;

                return (
                  <TableHead
                    key={header.id}
                    aria-sort={getColumnAriaSort(header.column)}
                    colSpan={header.colSpan}
                    rowSpan={header.rowSpan > 1 ? header.rowSpan : undefined}
                    className={cn(isCompact && 'h-32 px-8')}
                  >
                    {header.isPlaceholder && header.rowSpan === 1 ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        {tableBody}
      </Table>
      {footer ? (
        <div
          data-slot="data-table-footer"
          className="flex min-h-44 items-center justify-between gap-group border-t border-border-neutral-base bg-background-neutral-base px-row py-row"
        >
          {footer}
        </div>
      ) : null}
    </Panel>
  );
}
